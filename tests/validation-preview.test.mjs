import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(path, mocks = {}) {
  const out = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "exports", "process", out)(name => { assert.ok(name in mocks, name); return mocks[name]; }, compiledModule.exports, { env: { VERCEL_ENV: "production" } });
  return compiledModule.exports;
}

test("production validation page stops before rendering authenticated tooling", () => {
  let renders = 0;
  const denied = new Error("not found");
  const page = load("../src/app/validation-preview/page.tsx", {
    "next/navigation": { notFound() { throw denied; } },
    "@/components/preview-validation-console": { PreviewValidationConsole() { renders++; } },
    "react/jsx-runtime": { jsx() { renders++; } },
  });
  assert.throws(page.default, error => error === denied);
  assert.equal(renders, 0);
});

const searchLoad = load("../src/lib/validation/search-load.ts");
const { readSearchResponse, parseSearchServerTiming } = load("../src/lib/validation/search-response.ts", { "./search-load": searchLoad });
test("search transport extracts each real response schema without exporting business data", async () => {
  const fixtures = [
    ["documents_search", { documents: [{ secret: "customer-document" }], summary: { total: 29 } }, 29],
    ["admin_audit_search", { auditLogs: [{ secret: "customer-audit" }], pageInfo: { total: 301 } }, 301],
    ["history_summary", { items: [{ secret: "customer-mail" }], summary: { checks: 2, documents: 3, mails: 4 } }, 9],
    ["history_without_summary", { items: [{ secret: "customer-mail" }], summary: null }, undefined],
  ];
  for (const [scenario, body, total] of fixtures) {
    const result = await readSearchResponse(Response.json({ ok: true, ...body }), scenario);
    assert.equal(result.ok, true); assert.equal(result.resultCount, 1); assert.equal(result.matchedTotal, total);
    assert.ok(!JSON.stringify(result).includes("customer-"));
  }
});
test("invalid JSON and missing result collection cannot be counted as a successful search", async () => {
  for (const response of [new Response("<html>Gateway</html>"), Response.json({ ok: true, rows: [] }), Response.json(null)]) {
    assert.equal((await readSearchResponse(response, "admin_audit_search")).ok, false);
  }
});
test("HTTP failure cancels its body immediately without waiting for error payload", async () => {
  let cancelled = false;
  const result = await readSearchResponse(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 429 }), "documents_search");
  assert.equal(result.status, 429); assert.equal(result.ok, false); assert.equal(result.decodedBytes, 0); assert.equal(cancelled, true);
});
test("oversized response is cancelled while streaming before complete body allocation", async () => {
  let cancelled = false, chunks = 0;
  const response = new Response(new ReadableStream({
    pull(controller) { chunks++; controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; },
  }));
  const result = await readSearchResponse(response, "documents_search");
  assert.equal(result.ok, false); assert.ok(result.decodedBytes > 2 * 1024 * 1024);
  assert.equal(cancelled, true); assert.ok(chunks <= 4);
});

test("browser timing separates response headers, body reading and JSON parse without leaking header text", async () => {
  const times = [105, 115, 118];
  const response = Response.json({ ok: true, documents: [{ secret: "private-row" }], summary: { total: 7 } }, { headers: {
    "server-timing": 'server;dur=80,handler;dur=79,auth;dur=20,profile;dur=10,db;dur=45,db_sum;dur=120,q_total;dur=35,serialize;dur=1, private;dur=12;desc="secret, auth;dur=500"',
    "x-search-revision": "A".repeat(40), "x-search-variant": "baseline", "x-search-region": "iad1",
  } });
  const result = await readSearchResponse(response, "documents_search", { fetchStartedAt: 0, responseReceivedAt: 100, now: () => times.shift() });
  assert.equal(result.timing.fetchToHeadersMs, 100); assert.equal(result.timing.bodyReadMs, 10);
  assert.equal(result.timing.jsonParseMs, 3); assert.equal(result.timing.responseTotalMs, 118);
  assert.equal(result.timing.serverTimingStatus, "valid"); assert.equal(result.timing.server.auth, 20);
  assert.equal(result.timing.server.db_sum, 120); assert.equal(result.timing.server.q_total, 35);
  assert.deepEqual(result.deployment, { revision: "a".repeat(40), variant: "baseline", region: "iad1" });
  assert.equal(JSON.stringify(result).includes("private-row"), false); assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("missing timing, malformed durations, duplicate fields and clock-inconsistent traces never become zero", async () => {
  assert.deepEqual(parseSearchServerTiming(null), { server: null, serverTimingStatus: "missing" });
  assert.deepEqual(parseSearchServerTiming('unrelated;dur=12;desc="private"'), { server: null, serverTimingStatus: "missing" });
  for (const header of ['server;dur=-1', 'server;dur=Infinity', 'server;dur=NaN', 'server;dur=60001', 'server;dur=1;dur=2',
    'server;dur=1,server;dur=2', 'server;dur=1,auth;dur=2,auth;dur=3', 'auth;dur=1', 'server;dur="12', 'x'.repeat(8193)]) {
    assert.deepEqual(parseSearchServerTiming(header), { server: null, serverTimingStatus: "invalid" });
  }
  const result = await readSearchResponse(Response.json({ ok: true, documents: [] }, { headers: {
    "server-timing": "server;dur=1000,auth;dur=200", "x-search-revision": "Bearer private", "x-search-variant": "private", "x-search-region": "Bearer private",
  } }), "documents_search", { fetchStartedAt: 0, responseReceivedAt: 100, now: () => 101 });
  assert.equal(result.ok, true, "bad diagnostics do not change the business request status");
  assert.equal(result.timing.serverTimingStatus, "invalid"); assert.equal(result.timing.server, null);
  assert.deepEqual(result.deployment, { revision: null, variant: null, region: null });
});

test("server traces can be retained without a client fetch timestamp but client timings remain unknown", async () => {
  const result = await readSearchResponse(Response.json({ ok: true, documents: [] }, { headers: { "server-timing": 'server;dur="80.25",auth;dur=20' } }), "documents_search");
  assert.equal(result.timing.server.server, 80.25); assert.equal(result.timing.fetchToHeadersMs, null);
  assert.equal(result.timing.responseTotalMs, null); assert.equal(result.timing.clientMinusServerMs, null);
});
