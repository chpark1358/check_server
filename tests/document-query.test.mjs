import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const output = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", output)(name => name in mocks ? mocks[name] : require(name), compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
const history = load("../src/lib/server/history-query.ts");
const d = load("../src/lib/server/document-query.ts", { "./history-query": history });
const KEY = "document-query-test-key", OWNER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-15T15:30:00Z");
const id = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const parse = (params = {}, owner = OWNER, now = NOW) => d.parseDocumentQuery(new URLSearchParams(params), owner, KEY, now);
const expectCode = (fn, code) => assert.throws(fn, error => error instanceof d.DocumentQueryError && error.code === code);

test("document date ranges use KST calendar days and validate custom dates", () => {
  assert.equal(parse().history.fromInclusive, null);
  assert.equal(parse({ range: "7d" }).history.fromInclusive, "2026-10-09T15:00:00.000Z");
  assert.equal(parse({ range: "7d" }).history.toExclusive, "2026-10-16T15:00:00.000Z");
  const custom = parse({ range: "custom", from: "2026-10-01", to: "2026-10-02" });
  assert.equal(custom.history.fromInclusive, "2026-09-30T15:00:00.000Z");
  assert.equal(custom.history.toExclusive, "2026-10-02T15:00:00.000Z");
  expectCode(() => parse({ range: "custom", from: "2026-02-30", to: "2026-03-01" }), "INVALID_DOCUMENT_DATE");
  expectCode(() => parse({ range: "custom", from: "2026-10-02", to: "2026-10-01" }), "INVALID_DOCUMENT_DATE_RANGE");
});

test("document limits and enum values reject malformed input without broadening scope", () => {
  assert.equal(parse().history.filters.limit, 50);
  assert.equal(parse({ limit: "20000" }).history.filters.limit, 200);
  for (const limit of ["NaN", "0", "-1", "1.5"]) expectCode(() => parse({ limit }), "INVALID_DOCUMENT_LIMIT");
  for (const key of ["status", "attached", "expiry"]) expectCode(() => parse({ [key]: "wrong" }), "INVALID_DOCUMENT_FILTER");
  expectCode(() => parse({ q: "x".repeat(201) }), "DOCUMENT_QUERY_TOO_LONG");
});

test("signed document cursors bind owner and every filter and reject cross-route cursors", () => {
  const criteria = parse();
  const cursor = d.createDocumentCursor(criteria, { id: id(3), createdAt: "2026-10-10T10:00:00.000001Z" }, KEY);
  for (const changed of [{ q: "other" }, { expiry: "available" }, { range: "30d" }, { attached: "true" }, { status: "failed" }, { limit: "20" }]) {
    expectCode(() => parse({ ...changed, cursor }), "DOCUMENT_CURSOR_FILTER_MISMATCH");
  }
  expectCode(() => parse({ cursor }, "another-owner"), "DOCUMENT_CURSOR_FILTER_MISMATCH");
  const parts = cursor.split(".");
  expectCode(() => parse({ cursor: parts[0] + "." + "x".repeat(43) }), "INVALID_DOCUMENT_CURSOR");
  const h = history.parseHistoryQuery(new URLSearchParams({ range: "all" }), OWNER, KEY, NOW);
  const historyCursor = history.createHistoryCursor(h, { id: id(3), createdAt: "2026-10-10T10:00:00Z", type: "document" }, KEY);
  expectCode(() => parse({ cursor: historyCursor }), "INVALID_DOCUMENT_CURSOR");
});

test("start and next cursors retain the first lookup time, including expiry boundaries", () => {
  const criteria = parse({ range: "7d", expiry: "expiring" });
  const start = d.createDocumentCursor(criteria, null, KEY);
  const next = d.createDocumentCursor(criteria, { id: id(2), createdAt: "2026-10-15T10:00:00.000001Z" }, KEY);
  const tomorrow = new Date(NOW.getTime() + 86400000);
  for (const cursor of [start, next]) {
    const parsed = parse({ cursor, range: "7d", expiry: "expiring" }, OWNER, tomorrow);
    assert.equal(parsed.history.filters.asOf, NOW.toISOString());
    assert.equal(parsed.history.fromInclusive, criteria.history.fromInclusive);
  }
  assert.equal(parse({ cursor: start, range: "7d", expiry: "expiring" }).history.cursor, null);
  const future = d.createDocumentCursor(parse({}, OWNER, tomorrow), null, KEY);
  expectCode(() => parse({ cursor: future }), "INVALID_DOCUMENT_CURSOR");
});

function harness(rows = [], { omitCount = false } = {}) {
  const calls = [];
  const supabase = createClient("https://example.invalid", "test-only", { auth: { persistSession: false, autoRefreshToken: false }, global: {
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method;
      calls.push({ url, method, prefer: new Headers(init?.headers).get("prefer") });
      const count = url.searchParams.get("pdf_status") === "eq.success" ? 13 : url.searchParams.get("attached_to_mail") === "eq.true" ? 7 : 92;
      return new Response(method === "HEAD" ? null : JSON.stringify(rows), { status: 200,
        headers: { "content-type": "application/json", ...(omitCount ? {} : { "content-range": "0-0/" + count }) } });
    },
  } });
  class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
  const route = load("../src/app/api/documents/route.ts", {
    "@/lib/server/document-query": { ...d, parseDocumentQuery: (params, owner, key) => d.parseDocumentQuery(params, owner, key, NOW) },
    "@/lib/server/document-storage": { buildDocumentDisplayFileName: (_company, _date, type) => "report." + type },
    "@/lib/server/api": { ApiError, apiOk: (_id, response) => response, withApiHandler: (_request, action) => action("request-id"),
      requireRole: async (_request, _requestId, minimum) => { assert.equal(minimum, "operator"); return { user: { id: OWNER }, supabase }; } },
  });
  return { calls, supabase, invoke: params => route.GET({ nextUrl: new URL("https://example.invalid/api/documents?" + new URLSearchParams(params)) }) };
}
async function withKey(action) {
  const original = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
  try { return await action(); } finally { if (original === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = original; }
}

test("route pages make at most four owner-scoped requests and counts exclude only the cursor", async () => withKey(async () => {
  const rows = [3, 2, 1].map(n => ({ id: id(n), created_by: OWNER, company_name: "Fixture", serial: "LO1234", engineer_name: "Fixture",
    docx_path: "private/docx", pdf_path: null, pdf_status: "failed", pdf_error_summary: "Fixture failure", attached_to_mail: false,
    created_at: "2026-10-15T10:00:00.000001Z", expires_at: "2026-10-20T10:00:00Z" }));
  const h = harness(rows), criteria = parse({ limit: "2", q: "fixture", expiry: "expiring", range: "7d" });
  const cursor = d.createDocumentCursor(criteria, { id: id(4), createdAt: rows[0].created_at }, KEY);
  const result = await h.invoke({ limit: "2", q: "fixture", expiry: "expiring", range: "7d", cursor });
  assert.equal(result.documents.length, 2);
  assert.equal(result.hasMore, true);
  assert.equal(result.summary.total, 92);
  assert.equal(result.summary.pdfReady, 13);
  assert.equal(result.summary.attached, 7);
  assert.ok(result.startCursor);
  assert.equal(h.calls.length, 4);
  assert.equal(h.calls.filter(call => call.method === "HEAD").length, 3);
  for (const { url, method, prefer } of h.calls) {
    assert.equal(url.searchParams.get("created_by"), "eq." + OWNER);
    assert.deepEqual(url.searchParams.getAll("expires_at"), ["gt." + NOW.toISOString(), "lte.2026-10-22T15:30:00.000Z"]);
    assert.ok(url.searchParams.getAll("created_at").includes("gte.2026-10-09T15:00:00.000Z"));
    assert.ok(url.searchParams.get("or").includes("company_name.ilike"));
    if (method === "HEAD") {
      assert.equal(url.searchParams.has("limit"), false);
      assert.equal(url.searchParams.has("order"), false);
      assert.ok(!url.searchParams.get("or").includes("id.lt."));
      assert.ok(prefer.includes("count=exact"));
    } else {
      assert.equal(url.searchParams.get("limit"), "3");
      assert.equal(url.searchParams.get("order"), "created_at.desc,id.desc");
      assert.ok(url.searchParams.get("or").includes("created_at.eq." + rows[0].created_at + ",id.lt." + id(4)));
    }
  }
  const next = parse({ limit: "2", q: "fixture", expiry: "expiring", range: "7d", cursor: result.nextCursor });
  assert.equal(next.history.cursor.id, id(2));
  assert.equal(next.history.cursor.createdAt, rows[0].created_at);
}));

test("summary intersections never override selected failed/unattached filters", async () => withKey(async () => {
  const h = harness();
  const result = await h.invoke({ status: "failed", attached: "false" });
  assert.equal(result.summary.pdfReady, 0);
  assert.equal(result.summary.attached, 0);
  assert.equal(h.calls.length, 2);
  for (const { url } of h.calls) {
    assert.equal(url.searchParams.get("pdf_status"), "eq.failed");
    assert.equal(url.searchParams.get("attached_to_mail"), "eq.false");
  }
  assert.equal(result.nextCursor, null);
}));

test("invalid document queries return 400 before any document-table fetch", async () => withKey(async () => {
  const h = harness();
  for (const params of [{ cursor: "tampered" }, { expiry: "wrong" }, { limit: "-1" }, { range: "custom" }]) {
    await assert.rejects(() => h.invoke(params), error => error.status === 400);
  }
  assert.equal(h.calls.length, 0);
}));

test("PDF unavailable matches the persisted schema and unsupported pseudo-statuses are rejected", async () => withKey(async () => {
  const h = harness();
  const result = await h.invoke({ status: "unavailable" });
  assert.equal(result.summary.pdfReady, 0);
  assert.equal(h.calls.length, 3);
  for (const { url } of h.calls) assert.equal(url.searchParams.get("pdf_status"), "eq.unavailable");
  for (const status of ["disabled", "pending"]) expectCode(() => parse({ status }), "INVALID_DOCUMENT_FILTER");
  const schema = readFileSync(new URL("../supabase/migrations/202604290004_generated_documents.sql", import.meta.url), "utf8");
  const persisted = /pdf_status in \(([^)]+)\)/.exec(schema)[1].match(/'([^']+)'/g).map(value => value.slice(1, -1));
  for (const status of persisted) assert.equal(parse({ status }).status, status);
}));

test("missing exact-count response fails instead of reporting a successful zero count", async () => withKey(async () => {
  const h = harness([], { omitCount: true });
  await assert.rejects(() => h.invoke({}), error => error.status === 502 && error.code === "DOCUMENT_COUNT_UNAVAILABLE");
  assert.ok(h.calls.length > 0 && h.calls.length <= 4);
}));

test("search quoting retains literal quotes and parentheses inside a quoted PostgREST value", async () => {
  const h = harness();
  await d.buildDocumentsQuery(h.supabase, OWNER, parse({ q: 'name"),id.gt.0' }), false).limit(1);
  const expression = h.calls[0].url.searchParams.get("or");
  assert.ok(expression.includes('company_name.ilike."%name\\") id.gt.0%"'));
  assert.ok(!expression.includes('company_name.ilike.%name'));
});
