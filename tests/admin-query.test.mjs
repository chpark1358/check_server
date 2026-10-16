import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)(name => name in mocks ? mocks[name] : name === "@/lib/server/request-timing" ? load("../src/lib/server/request-timing.ts", {}) : require(name), mod, mod.exports);
  return mod.exports;
}
const h = load("../src/lib/server/admin-query.ts");
const key = "admin-unit-test-signing-key";
const owner = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-10-16T00:00:00Z");
const id = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const parse = (params = {}, user = owner, clock = now) => h.parseAdminQuery(new URLSearchParams(params), user, key, clock);

test("admin filters reject unbounded, invalid and cross-section inputs", () => {
  for (const params of [{ section: "private" }, { limit: "0" }, { limit: "101" }, { limit: "1.5" }, { range: "20" }, { q: "q".repeat(201) }, { section: "users", actor: owner }, { section: "sends", action: "a" }, { role: "admin" }, { action: "a),id.neq.x" }]) assert.throws(() => parse(params), h.AdminQueryError);
  assert.equal(parse({ range: "30" }).from, "2026-09-16T00:00:00.000Z");
  assert.equal(parse({ range: "all" }).from, null);
});

test("admin cursor binds authenticated caller, every filter, and original query clock", () => {
  const criteria = parse({ section: "sends", q: "abc", range: "7", actor: owner, status: "failed", limit: "2" });
  const position = { id: id(2), createdAt: "2026-10-15T23:59:59.123456+00:00" };
  const cursor = h.createAdminCursor(criteria, position, key);
  const params = { section: "sends", q: "abc", range: "7", actor: owner, status: "failed", limit: "2", cursor };
  const next = parse(params, owner, new Date("2026-10-17T00:00:00Z"));
  assert.equal(next.asOf, criteria.asOf);
  assert.deepEqual(next.cursor, position);
  for (const changed of [{ q: "different" }, { range: "all" }, { limit: "3" }, { actor: id(1) }, { status: "success" }, { section: "documents" }]) assert.throws(() => parse({ ...params, ...changed }), h.AdminQueryError);
  assert.throws(() => parse(params, id(1)), h.AdminQueryError);
  const [encoded, signature] = cursor.split(".");
  const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(encoded, "base64url")), asOf: "2027-01-01T00:00:00Z" })).toString("base64url");
  assert.throws(() => parse({ ...params, cursor: changed + "." + signature }), h.AdminQueryError);
});

test("first-page anchor keeps the original snapshot when returning from later pages", () => {
  const first = parse({ section: "audit", range: "7", limit: "2" });
  const startCursor = h.createAdminCursor(first, null, key);
  const back = parse({ section: "audit", range: "7", limit: "2", cursor: startCursor }, owner, new Date("2026-10-20T00:00:00Z"));
  assert.equal(back.asOf, first.asOf);
  assert.equal(back.from, first.from);
  assert.equal(back.cursor, null);
  assert.equal(h.adminFilterExpression(back), null);
  // Subsequent navigation may reuse this signed first-page anchor, but another
  // caller or changed search must start a new snapshot.
  assert.equal(h.createAdminCursor(back, null, key), startCursor);
  assert.throws(() => parse({ section: "audit", range: "7", limit: "2", q: "new", cursor: startCursor }), h.AdminQueryError);
  assert.throws(() => parse({ section: "audit", range: "7", limit: "2", cursor: startCursor }, id(1)), h.AdminQueryError);
});

test("document PDF statuses match stored values and never accept send-only states", () => {
  for (const status of ["success", "failed", "unavailable", "not_requested"]) assert.equal(parse({ section: "documents", status }).status, status);
  for (const status of ["dry_run", "pending", "disabled"]) assert.throws(() => parse({ section: "documents", status }), h.AdminQueryError);
  for (const status of ["unavailable", "not_requested"]) assert.throws(() => parse({ section: "sends", status }), h.AdminQueryError);
});

test("keyset ties preserve microseconds and count expression excludes pagination", () => {
  const query = parse({ q: 'a%_"),id.neq.x', limit: "2" });
  query.cursor = { id: id(9), createdAt: "2026-10-15T23:59:59.123456+00:00" };
  const expression = h.adminFilterExpression(query);
  assert.ok(expression.includes("created_at.eq.2026-10-15T23:59:59.123456+00:00,id.lt." + id(9)));
  assert.ok(expression.includes('\\"'));
  assert.ok(expression.includes("\\\\%"));
  assert.ok(!h.adminFilterExpression(query, true).includes("created_at"));
  assert.ok(h.adminFilterExpression(query).includes("search_text.ilike"));
});

function harness(section, options = {}) {
  const calls = [];
  const records = Array.from({ length: 3 }, (_, index) => ({
    id: id(3 - index), created_at: "2026-10-15T23:59:59.123456Z", actor_id: owner, sent_by: owner, created_by: owner,
    action: "solution.checkup", status: "success", company_name: "Test", serial: "LO24123103", pdf_status: "success",
    metadata: { serial: "LO24123103", token: "do-not-return", nested: { password: "do-not-return" } },
    email: `person${index}@example.invalid`, role: "viewer",
  }));
  const supabase = createClient("https://example.invalid", "unused", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, method: init?.method, prefer: new Headers(init?.headers).get("prefer") });
      let data = [];
      if (url.pathname.includes("/auth/v1/admin/users/")) data = { id: url.pathname.split("/").at(-1), email: "person@example.invalid", created_at: "2026-01-01T00:00:00Z" };
      else if (!url.pathname.endsWith("/profiles") || section === "users") data = records;
      else data = [{ id: owner, email: "operator@example.invalid" }];
      return new Response(init?.method === "HEAD" ? null : JSON.stringify(data), { status: 200, headers: { "content-type": "application/json", "content-range": "0-2/1051" } });
    } },
  });
  class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
  const route = load("../src/app/api/admin/overview/route.ts", {
    "@/lib/server/admin-query": h,
    "@/lib/server/audit": { writeAuditLog: async () => { throw new Error("No audit writes in this test"); } },
    "@/lib/server/api": { ApiError, apiOk: (_, result) => result, withApiHandler: (_, handler) => handler("req"), requireRole: async (_, __, role) => { assert.equal(role, "admin"); if (options.forbidden) throw new ApiError(403, "FORBIDDEN", "admin required"); return { user: { id: owner }, supabase }; } },
  });
  return { calls, invoke: params => route.GET({ nextUrl: new URL("https://example.invalid/api/admin/overview?" + new URLSearchParams({ section, limit: "2", ...params })) }) };
}

test("all record sections query entire DB with server filters, exact counts and bounded page fetch", async () => {
  const previous = process.env.SUPABASE_SERVICE_ROLE_KEY; process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  try {
    for (const section of ["audit", "sends", "documents"]) {
      const { calls, invoke } = harness(section);
      const result = await invoke({ range: "30", actor: owner, q: "LO24123103", ...(section === "audit" ? { action: "solution.checkup" } : { status: "success" }) });
      assert.equal(result.pageInfo.total, 1051); assert.equal(result.pageInfo.hasMore, true);
      assert.ok(result.pageInfo.nextCursor);
      assert.ok(result.pageInfo.startCursor);
      assert.equal(calls.filter(c => c.url.pathname.includes("/auth/")).length, 0);
      const lists = calls.filter(c => c.method !== "HEAD" && !c.url.pathname.endsWith("/profiles"));
      assert.equal(lists.length, 1);
      assert.equal(lists[0].url.searchParams.get("order"), "created_at.desc,id.desc");
      assert.equal(lists[0].url.searchParams.get("limit"), "3");
      assert.ok(lists[0].url.searchParams.get("or").includes("ilike"));
      const column = section === "audit" ? "actor_id" : section === "sends" ? "sent_by" : "created_by";
      assert.equal(lists[0].url.searchParams.get(column), `in.(${owner})`);
      const counts = calls.filter(c => c.method === "HEAD");
      assert.equal(counts.length, 5);
      assert.ok(counts.every(c => c.prefer.includes("count=exact") && !c.url.searchParams.has("limit")));
      assert.equal(result.summary.auditEvents24h, 1051);
      if (section === "audit") {
        assert.equal(result.auditLogs[0].metadata.token, "[redacted]");
        assert.equal(result.auditLogs[0].metadata.nested.password, "[redacted]");
      }
      calls.length = 0;
      await invoke({ range: "30", actor: owner, q: "LO24123103", ...(section === "audit" ? { action: "solution.checkup" } : { status: "success" }), cursor: result.pageInfo.nextCursor });
      const nextList = calls.find(c => c.method !== "HEAD" && !c.url.pathname.endsWith("/profiles"));
      const nextCount = calls.find(c => c.method === "HEAD" && c.url.searchParams.has("or"));
      assert.ok(nextList.url.searchParams.get("or").includes("id.lt."));
      assert.ok(!nextCount.url.searchParams.get("or").includes("id.lt."));
      calls.length = 0;
      const returned = await invoke({ range: "30", actor: owner, q: "LO24123103", ...(section === "audit" ? { action: "solution.checkup" } : { status: "success" }), cursor: result.pageInfo.startCursor });
      assert.equal(returned.pageInfo.asOf, result.pageInfo.asOf);
      const firstAgain = calls.find(c => c.method !== "HEAD" && !c.url.pathname.endsWith("/profiles"));
      assert.ok(firstAgain.url.searchParams.getAll("created_at").includes("lte." + result.pageInfo.asOf));
      assert.ok(!firstAgain.url.searchParams.get("or").includes("id.lt."));
    }
  } finally { if (previous === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previous; }
});

test("users use profile search/role pagination and only enrich visible Auth records", async () => {
  const previous = process.env.SUPABASE_SERVICE_ROLE_KEY; process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  try {
    const { calls, invoke } = harness("users");
    const result = await invoke({ q: "person", role: "viewer" });
    assert.equal(result.users.length, 2); assert.equal(result.pageInfo.total, 1051);
    const authCalls = calls.filter(c => c.url.pathname.includes("/auth/"));
    assert.equal(authCalls.length, 2);
    assert.ok(authCalls.every(c => /\/admin\/users\/[\w-]+$/.test(c.url.pathname)));
    const profileList = calls.find(c => c.method !== "HEAD" && c.url.pathname.endsWith("profiles"));
    assert.equal(profileList.url.searchParams.get("role"), "eq.viewer");
    assert.equal(profileList.url.searchParams.get("limit"), "3");
  } finally { if (previous === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previous; }
});

test("non-admin access fails before DB or Auth lookup", async () => {
  const { calls, invoke } = harness("users", { forbidden: true });
  await assert.rejects(invoke({}), error => error.status === 403);
  assert.equal(calls.length, 0);
});
