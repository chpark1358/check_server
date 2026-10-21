import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
const sourceRef = process.env.TICKET_HISTORY_TEST_REF;
if (sourceRef && !/^[a-f0-9]{40}$/i.test(sourceRef)) {
  throw new Error("TICKET_HISTORY_TEST_REF must be an explicit 40-character commit SHA");
}

// Optional immutable ref replay makes the same assertions reproduce the old-main
// defect without retaining a deliberately failing test or changing the checkout.
function load(path, mocks = {}) {
  const source = sourceRef
    ? execFileSync("git", ["show", `${sourceRef}:${path}`], { cwd: fileURLToPath(root), encoding: "utf8" })
    : readFileSync(new URL(path, root), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", output)(name => {
    if (name in mocks) return mocks[name];
    if (name === "@/lib/server/request-timing") return load("src/lib/server/request-timing.ts");
    return require(name);
  }, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const VIEWER = "44444444-4444-4444-8444-444444444444";
const EMPTY = "55555555-5555-4555-8555-555555555555";
const identities = {
  "operator-a": { id: A, role: "operator" },
  "operator-b": { id: B, role: "operator" },
  admin: { id: ADMIN, role: "admin" },
  viewer: { id: VIEWER, role: "viewer" },
  "operator-empty": { id: EMPTY, role: "operator" },
};
const fixtures = [
  { id: "b-older", sent_by: B, subject: "B private older", created_at: "2026-10-10T00:00:00Z" },
  { id: "a-older", sent_by: A, subject: "A private older", created_at: "2026-10-11T00:00:00Z" },
  { id: "b-newer", sent_by: B, subject: "B private newer", created_at: "2026-10-12T00:00:00Z" },
  { id: "a-newer", sent_by: A, subject: "A private newer", created_at: "2026-10-13T00:00:00Z" },
  { id: "unowned", sent_by: null, subject: "Unowned private", created_at: "2026-10-14T00:00:00Z" },
];

function harness(options = {}) {
  const calls = [];
  const rows = options.rows ?? fixtures;
  const database = createClient("https://fixture.example.invalid", "fixture-service-role", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init = {}) => {
      const url = new URL(String(input));
      const headers = new Headers(init.headers);
      calls.push({ url, authorization: headers.get("authorization") });
      if (url.pathname === "/auth/v1/user") {
        const token = headers.get("authorization")?.replace(/^Bearer /, "");
        const identity = identities[token];
        if (!identity) return Response.json({ message: "Fixture invalid token" }, { status: 401 });
        return Response.json({
          id: identity.id, aud: "authenticated", role: "authenticated",
          email: "fixture@example.invalid", created_at: "2026-01-01T00:00:00Z",
          app_metadata: options.appMetadata ?? {}, user_metadata: options.userMetadata ?? {},
        });
      }
      if (url.pathname === "/rest/v1/profiles") {
        if (options.profileError) return Response.json({ message: "Private profile database detail", code: "XX000" }, { status: 500 });
        const id = url.searchParams.get("id")?.replace(/^eq\./, "");
        const identity = Object.values(identities).find(value => value.id === id);
        assert.ok(identity, "profile query must use an authenticated fixture identity");
        return Response.json(options.missingProfile ? null : {
          id, role: options.profileRole ?? identity.role, email: "fixture@example.invalid", display_name: "Fixture",
        });
      }
      assert.equal(url.pathname, "/rest/v1/ticket_sends", "no unrelated or external request is allowed");
      // This simulates a service-role database: it deliberately applies NO RLS.
      // Ownership must arrive in the real Supabase SDK's serialized URL.
      assert.equal(headers.get("authorization"), "Bearer fixture-service-role");
      if (options.databaseError) return Response.json({
        message: "PRIVATE_DB_DETAIL requester=private@example.invalid owner=other-owner", code: "XX000",
      }, { status: 500 });
      const ownerFilter = url.searchParams.get("sent_by");
      let result = ownerFilter ? rows.filter(row => `eq.${row.sent_by}` === ownerFilter) : [...rows];
      assert.equal(url.searchParams.get("order"), "created_at.desc");
      result = [...result].sort((a, b) => b.created_at.localeCompare(a.created_at));
      result = result.slice(0, Number(url.searchParams.get("limit")));
      return Response.json(result);
    } },
  });
  const api = load("src/lib/server/api.ts", {
    "server-only": {}, "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/supabase/server": { createServiceRoleSupabaseClient: () => database },
  });
  const route = load("src/app/api/history/ticket-sends/route.ts", {
    "@/lib/server/api": api,
    "@/lib/server/ticket-send-state": load("src/lib/server/ticket-send-state.ts"),
  });
  return {
    calls,
    historyCalls: () => calls.filter(call => call.url.pathname === "/rest/v1/ticket_sends"),
    async get(token = "operator-a", query = "", extraHeaders = {}) {
      const url = new URL(`https://fixture.invalid/api/history/ticket-sends${query ? `?${query}` : ""}`);
      const request = {
        method: "GET", url: url.href, nextUrl: url,
        headers: new Headers({ "x-request-id": "fixture-history-isolation", ...extraHeaders, ...(token === null ? {} : { authorization: `Bearer ${token}` }) }),
      };
      const response = await route.GET(request);
      return { status: response.status, body: await response.json() };
    },
  };
}

function assertOwnerRequest(h, owner) {
  const requests = h.historyCalls();
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].url.searchParams.getAll("sent_by"), [`eq.${owner}`]);
  assert.equal(requests[0].url.searchParams.get("or"), null);
}

test("recent sends keep recorded solve results after a fresh read without exposing another owner", async () => {
  const stored = { status: "success", auto_solved: true, error_summary: null,
    auto_solve_status: "solved", auto_solve_error: null, auto_solve_recorded_at: "2026-10-14T00:01:00Z" };
  const rows = fixtures.map(row => ({ ...row, ...stored }));
  for (let read = 0; read < 2; read++) {
    const h = harness({ rows });
    const result = await h.get("operator-a");
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.sends.map(row => row.id), ["a-newer", "a-older"]);
    assert.ok(result.body.sends.every(row => row.autoSolveStatus === "solved" &&
      row.autoSolveEvidence === "recorded" && row.autoSolveRecordedAt === stored.auto_solve_recorded_at));
    assertOwnerRequest(h, A);
    const selected = h.historyCalls()[0].url.searchParams.get("select");
    for (const column of ["auto_solve_status", "auto_solve_error", "auto_solve_recorded_at"]) assert.ok(selected.includes(column));
  }
});

for (const [token, owner, expectedIds] of [
  ["operator-a", A, ["a-newer", "a-older"]],
  ["operator-b", B, ["b-newer", "b-older"]],
]) {
  test(`${token} reads only its own sends through the real auth guard and service-role query`, async () => {
    const h = harness(), result = await h.get(token);
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.deepEqual(result.body.sends.map(row => row.id), expectedIds);
    assertOwnerRequest(h, owner);
    const profileCall = h.calls.find(call => call.url.pathname === "/rest/v1/profiles");
    assert.equal(profileCall.url.searchParams.get("id"), `eq.${owner}`);
  });
}

test("admin retains full history including unowned legacy sends", async () => {
  const h = harness(), result = await h.get("admin");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.sends.map(row => row.id), ["unowned", "a-newer", "b-newer", "a-older", "b-older"]);
  assert.equal(h.historyCalls()[0].url.searchParams.get("sent_by"), null);
});

test("operator cannot see unowned sends and an owner with no records gets an empty list", async () => {
  const h = harness(), result = await h.get("operator-empty");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.sends, []);
  assertOwnerRequest(h, EMPTY);
});

test("caller owner, role, scope and PostgREST-like query parameters cannot widen operator access", async () => {
  const attempts = [
    `sent_by=${B}`, `user_id=${B}`, `userId=${B}`, `owner=${B}`,
    `sent_by=${A}&sent_by=${B}&user_id=${B}`, "sent_by=is.null", "sent_by=neq.null",
    `or=(sent_by.eq.${B},sent_by.is.null)`, "scope=all&role=admin&limit=100",
  ];
  for (const query of attempts) {
    const h = harness(), result = await h.get("operator-a", query, { "x-user-id": B, "x-role": "admin" });
    assert.equal(result.status, 200, query);
    assert.deepEqual(result.body.sends.map(row => row.id), ["a-newer", "a-older"], query);
    assertOwnerRequest(h, A);
  }
});

test("simultaneous operator A/B and admin requests cannot share a caller's ownership scope", async () => {
  const h = harness();
  const results = await Promise.all([h.get("operator-a"), h.get("operator-b"), h.get("admin")]);
  assert.deepEqual(results[0].body.sends.map(row => row.id), ["a-newer", "a-older"]);
  assert.deepEqual(results[1].body.sends.map(row => row.id), ["b-newer", "b-older"]);
  assert.equal(results[2].body.sends.length, fixtures.length);
});

test("viewer is rejected before any ticket history query even with forged admin metadata", async () => {
  const h = harness({ appMetadata: { role: "admin" }, userMetadata: { role: "admin" } });
  const result = await h.get("viewer", `sent_by=${A}&scope=all`);
  assert.equal(result.status, 403);
  assert.equal(result.body.code, "FORBIDDEN");
  assert.deepEqual(h.historyCalls(), []);
});

test("anonymous history request is rejected before creating any auth or database request", async () => {
  const h = harness(), result = await h.get(null);
  assert.equal(result.status, 401);
  assert.equal(result.body.code, "AUTH_REQUIRED");
  assert.deepEqual(h.calls, []);
});

test("invalid or expired token cannot reach profile or ticket queries", async () => {
  const h = harness(), result = await h.get("invalid-or-expired");
  assert.equal(result.status, 401);
  assert.equal(result.body.code, "AUTH_INVALID");
  assert.deepEqual(h.calls.map(call => call.url.pathname), ["/auth/v1/user"]);
});

test("profile lookup error fails closed despite an admin role claim", async () => {
  const h = harness({ profileError: true, appMetadata: { role: "admin" } });
  const result = await h.get("operator-a");
  assert.equal(result.status, 500);
  assert.equal(result.body.code, "PROFILE_LOOKUP_FAILED");
  assert.deepEqual(h.historyCalls(), []);
  assert.equal(JSON.stringify(result.body).includes("Private profile database detail"), false);
});

test("user-editable admin metadata does not elevate a profile-less caller", async () => {
  const h = harness({ missingProfile: true, userMetadata: { role: "admin" } });
  const result = await h.get("operator-a");
  assert.equal(result.status, 403);
  assert.equal(result.body.code, "FORBIDDEN");
  assert.deepEqual(h.historyCalls(), []);
});

test("invalid profile role does not fall back to an admin claim", async () => {
  const h = harness({ profileRole: "super-admin", appMetadata: { role: "admin" } });
  const result = await h.get("operator-a");
  assert.equal(result.status, 403);
  assert.equal(result.body.code, "FORBIDDEN");
  assert.deepEqual(h.historyCalls(), []);
});

test("database failure returns a generic error and no rows or private database details", async t => {
  const logs = [];
  t.mock.method(console, "error", message => logs.push(message));
  const h = harness({ databaseError: true }), result = await h.get("operator-a");
  assert.equal(result.status, 500);
  assert.equal(result.body.code, "INTERNAL_SERVER_ERROR");
  assert.equal(Object.hasOwn(result.body, "sends"), false);
  assert.equal(JSON.stringify(result.body).includes("PRIVATE_DB_DETAIL"), false);
  assert.equal(JSON.stringify(result.body).includes("private@example.invalid"), false);
  assert.equal(logs.length, 1);
  assertOwnerRequest(h, A);
});

test("default, capped and invalid limits apply after ownership filtering", async () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({
    id: `a-${i}`, sent_by: A, subject: "A fixture", created_at: `2026-10-16T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z`,
  })).concat(Array.from({ length: 120 }, (_, i) => ({
    id: `b-${i}`, sent_by: B, subject: "B fixture", created_at: "2026-10-17T00:00:00Z",
  })));
  for (const [query, expected] of [["", 50], ["limit=999999", 100], ["limit=NaN", 50], ["limit=-1", 50], ["limit=0", 50], ["limit=1", 1]]) {
    const h = harness({ rows }), result = await h.get("operator-a", query);
    assert.equal(result.status, 200, query);
    assert.equal(result.body.sends.length, expected, query);
    assert.equal(result.body.sends.every(row => row.sent_by === A), true, query);
    assertOwnerRequest(h, A);
    assert.equal(h.historyCalls()[0].url.searchParams.get("limit"), String(expected));
  }
});
