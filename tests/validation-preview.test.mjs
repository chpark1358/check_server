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

const { readSearchResponse } = load("../src/lib/validation/search-response.ts", { "./search-load": { SEARCH_LOAD_PLAN: { maxDecodedBytes: 2 * 1024 * 1024 } } });
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
