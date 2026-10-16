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
class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
class PdfConverterError extends Error { constructor(code, message) { super(message); this.code = code; this.publicMessage = message; } }
class PdfConverterUnavailable extends PdfConverterError {}
const ID = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const DOCX = Buffer.from("original-docx-bytes");
const PDF = Buffer.from("%PDF-1.7\nfixture-pdf");
const row = (changes = {}) => ({ id: ID, created_by: OWNER, company_name: "Fixture", serial: "LO24123103",
  docx_path: `${OWNER}/${ID}/document.docx`, pdf_path: null, pdf_status: "failed", pdf_error_summary: "Previous failure",
  created_at: "2026-10-10T00:00:00.000Z", expires_at: "2099-10-10T00:00:00.000Z", pdf_retry_token: null, pdf_retry_started_at: null, ...changes });

function harness(options = {}) {
  let current = options.row === null ? null : row(options.row);
  const requests = [], audits = [], downloads = [], uploads = [], removals = [], infos = [], conversions = [];
  const supabase = createClient("https://example.invalid", "test-only", { auth: { persistSession: false, autoRefreshToken: false }, global: {
    fetch: async (input, init = {}) => {
      const url = new URL(String(input)), method = init.method ?? "GET";
      const body = init.body ? JSON.parse(init.body) : null;
      requests.push({ url, method, body });
      if (options.schemaMissing) return new Response(JSON.stringify({ code: "42703", message: "missing claim column" }), { status: 400 });
      if (method === "GET") return new Response(JSON.stringify(current ? [current] : []), { headers: { "content-type": "application/json" } });
      assert.equal(method, "PATCH");
      const finalize = Boolean(body.pdf_path);
      const release = body.pdf_retry_token === null && !finalize;
      if ((finalize && options.failFinalize) || (release && options.failRelease)) {
        if (finalize && options.commitBeforeError) Object.assign(current, body);
        return new Response(JSON.stringify({ code: "XX000", message: "simulated database failure" }), { status: 500 });
      }
      const equal = (key, value) => !url.searchParams.has(key) || url.searchParams.get(key) === value;
      let matches = Boolean(current) && equal("id", `eq.${current?.id}`) && equal("created_by", `eq.${current?.created_by}`);
      if (current) {
        if (url.searchParams.get("pdf_path") === "is.null") matches &&= current.pdf_path === null;
        if (url.searchParams.has("pdf_status")) matches &&= current.pdf_status !== "success";
        if (url.searchParams.has("pdf_retry_token")) matches &&= url.searchParams.get("pdf_retry_token") === `eq.${current.pdf_retry_token}`;
        if (url.searchParams.has("expires_at")) matches &&= Date.parse(current.expires_at) > Date.parse(url.searchParams.get("expires_at").slice(3));
        if (url.searchParams.has("or")) {
          const stale = /pdf_retry_started_at.lt.([^)]*)/.exec(url.searchParams.get("or"))[1];
          matches &&= current.pdf_retry_token === null || Date.parse(current.pdf_retry_started_at) < Date.parse(stale);
        }
      }
      if (matches) Object.assign(current, body);
      return new Response(JSON.stringify(matches ? [current] : []), { headers: { "content-type": "application/json" } });
    },
  } });
  const originalStorageFrom = supabase.storage.from.bind(supabase.storage);
  supabase.storage.from = bucket => {
    assert.equal(bucket, "generated-documents");
    return { ...originalStorageFrom(bucket), info: async key => {
      infos.push(key);
      return options.infoFailure ? { data: null, error: { message: "missing" } } : { data: { size: key.endsWith("docx") ? DOCX.length : PDF.length }, error: null };
    } };
  };
  const service = load("../src/lib/server/document-pdf-retry.ts", {
    "server-only": {}, "@/lib/server/api": { ApiError },
    "@/lib/server/audit": { writeAuditLog: async (_db, _user, action, _type, id, meta) => audits.push({ action, id, meta }) },
    "@/lib/server/document-converter": { PdfConverterError, PdfConverterUnavailable, isPdfConverterEnabled: () => true,
      convertDocxToPdf: async (buffer, filename) => {
        conversions.push({ buffer, filename });
        if (options.convert) return options.convert({ get: () => current, set: value => { current = value; } });
        if (options.convertError) throw options.convertError;
        return PDF;
      } },
    "@/lib/server/document-storage": {
      GENERATED_DOCUMENTS_BUCKET: "generated-documents", buildDocumentDisplayFileName: (_company, at, kind) => `${at}.${kind}`,
      documentContentType: kind => `application/${kind}`,
      downloadDocumentObject: async (_db, key) => { downloads.push(key); if (options.downloadError) throw new ApiError(500, "DOWNLOAD_FAILED", "failure"); return DOCX; },
      uploadDocumentObject: async (_db, key, buffer) => { uploads.push({ key, buffer }); if (options.uploadError) throw new ApiError(500, "UPLOAD_FAILED", "failure"); },
      deleteDocumentObjects: async (_db, keys) => { removals.push(...keys); },
    },
  });
  const auth = { supabase, user: { id: options.user ?? OWNER }, role: options.role ?? "operator", requestId: "test-request" };
  return { invoke: () => service.retryDocumentPdf(auth, ID), get: () => current, requests, audits, downloads, uploads, removals, infos, conversions, auth, service };
}
const code = expected => error => error instanceof ApiError && error.code === expected;

test("PDF retry preserves document identity, DOCX, generation/expiry and commits only PDF metadata", async () => {
  const h = harness(); const before = { ...h.get() }; const result = await h.invoke();
  assert.equal(result.document.id, ID); assert.equal(result.document.createdAt, before.created_at); assert.equal(result.document.expiresAt, before.expires_at);
  assert.equal(result.document.pdfStatus.ok, true); assert.equal(result.document.pdf.size, PDF.length); assert.equal(result.reusedExistingPdf, false);
  assert.equal(h.get().docx_path, before.docx_path); assert.equal(h.downloads.length, 1); assert.deepEqual(h.conversions[0].buffer, DOCX);
  assert.equal(h.conversions[0].filename, `${before.created_at}.docx`); assert.match(h.uploads[0].key, /\/pdf-retries\/[0-9a-f-]+\.pdf$/);
  assert.equal(h.get().pdf_path, h.uploads[0].key); assert.equal(h.get().pdf_retry_token, null);
  for (const { body } of h.requests.filter(r => r.method === "PATCH")) {
    for (const preserved of ["created_at", "expires_at", "docx_path", "created_by", "attached_to_mail"]) assert.equal(preserved in body, false);
  }
  assert.deepEqual(h.audits.map(a => a.action.split(".").at(-1)), ["started", "success"]);
});

test("already-ready retry is idempotent and never converts, downloads, uploads or claims", async () => {
  const h = harness({ row: { pdf_path: `${OWNER}/${ID}/document.pdf`, pdf_status: "success" } });
  const result = await h.invoke();
  assert.equal(result.reusedExistingPdf, true); assert.equal(result.document.pdfStatus.ok, true); assert.equal(h.infos.length, 2);
  assert.equal(h.conversions.length + h.downloads.length + h.uploads.length, 0);
  assert.equal(h.requests.filter(r => r.method === "PATCH").length, 0);
});

test("owner/operator, expiry and missing checks precede every storage/provider side effect", async () => {
  for (const [options, expected] of [[{ user: "other" }, "FORBIDDEN"], [{ role: "viewer" }, "FORBIDDEN"],
    [{ row: { expires_at: "2000-01-01" } }, "GENERATED_DOCUMENT_EXPIRED"], [{ row: { expires_at: "invalid" } }, "GENERATED_DOCUMENT_EXPIRED"],
    [{ row: null }, "GENERATED_DOCUMENT_NOT_FOUND"]]) {
    const h = harness(options); await assert.rejects(h.invoke, code(expected));
    assert.equal(h.conversions.length + h.downloads.length + h.uploads.length + h.infos.length, 0);
    assert.equal(h.requests.filter(r => r.method === "PATCH").length, 0);
  }
  const admin = harness({ role: "admin", user: "admin-id" }); await admin.invoke(); assert.equal(admin.get().created_by, OWNER);
});

test("two concurrent workers compete through an atomic conditional DB claim; only one calls provider", async () => {
  let unblock; const pause = new Promise(resolve => { unblock = resolve; });
  let entered; const started = new Promise(resolve => { entered = resolve; });
  const h = harness({ convert: async () => { entered(); await pause; return PDF; } });
  const first = h.invoke(); await started;
  await assert.rejects(h.invoke, code("PDF_RETRY_IN_PROGRESS"));
  assert.equal(h.conversions.length, 1); unblock(); await first;
  assert.equal(h.uploads.length, 1);
  for (const claim of h.requests.filter(r => r.body?.pdf_retry_token)) {
    assert.equal(claim.url.searchParams.get("pdf_path"), "is.null");
    assert.equal(claim.url.searchParams.get("pdf_status"), "neq.success");
    assert.match(claim.url.searchParams.get("or"), /pdf_retry_token.is.null,pdf_retry_started_at.lt./);
  }
});

test("fresh leases block work while explicit retry reclaims stale lease and audits recovery", async () => {
  const fresh = harness({ row: { pdf_retry_token: "prior", pdf_retry_started_at: new Date().toISOString() } });
  await assert.rejects(fresh.invoke, code("PDF_RETRY_IN_PROGRESS")); assert.equal(fresh.conversions.length, 0);
  const stale = harness({ row: { pdf_retry_token: "prior", pdf_retry_started_at: new Date(Date.now() - 16 * 60_000).toISOString() } });
  await stale.invoke(); assert.equal(stale.audits[0].action, "document.check_report.pdf_retry.stale_reclaimed");
});

test("a stale worker cannot finalize or clear a newer claim, and its unique uploaded object is removed", async () => {
  const h = harness({ convert: async ({ get, set }) => { set({ ...get(), pdf_retry_token: "new-worker" }); return PDF; } });
  await assert.rejects(h.invoke, code("PDF_RETRY_CLAIM_LOST"));
  assert.equal(h.get().pdf_retry_token, "new-worker"); assert.equal(h.get().pdf_path, null);
  assert.deepEqual(h.removals, [h.uploads[0].key]);
  assert.equal(h.audits.some(a => a.action.endsWith(".success")), false);
});

test("provider failure/unavailability persist useful result, preserve DOCX and release only owned claim", async () => {
  for (const failure of [new PdfConverterError("PROVIDER_FAILED", "Conversion failed"), new PdfConverterUnavailable("NOT_CONFIGURED", "Unavailable")]) {
    const h = harness({ convertError: failure }); const before = { ...h.get() }; const result = await h.invoke();
    assert.equal(result.document.pdf, null); assert.equal(result.document.pdfStatus.code, failure.code);
    assert.equal(h.get().pdf_status, failure instanceof PdfConverterUnavailable ? "unavailable" : "failed");
    assert.equal(h.get().pdf_retry_token, null); assert.equal(h.get().docx_path, before.docx_path);
    assert.equal(h.get().expires_at, before.expires_at); assert.equal(h.uploads.length, 0);
  }
});

test("non-PDF provider response is rejected instead of saved as a successful PDF", async () => {
  const h = harness({ convert: async () => Buffer.from("<html>502 Bad Gateway</html>") }); const result = await h.invoke();
  assert.equal(result.document.pdfStatus.code, "PDF_CONVERTER_INVALID_RESPONSE"); assert.equal(h.uploads.length, 0); assert.equal(h.get().pdf_status, "failed");
});

test("download/upload failures release owned claim and preserve original document metadata", async () => {
  for (const [option, expected] of [["downloadError", "DOWNLOAD_FAILED"], ["uploadError", "UPLOAD_FAILED"]]) {
    const h = harness({ [option]: true }); await assert.rejects(h.invoke, code(expected));
    assert.equal(h.get().pdf_retry_token, null); assert.equal(h.get().pdf_path, null); assert.equal(h.get().pdf_error_summary, "Previous failure");
  }
});

test("failed final commit never returns success or deletes a potentially committed PDF", async () => {
  for (const commitBeforeError of [false, true]) {
    const h = harness({ failFinalize: true, commitBeforeError }); await assert.rejects(h.invoke, code("PDF_RETRY_SAVE_FAILED"));
    assert.equal(h.removals.length, 0); assert.equal(h.audits.some(a => a.action.endsWith(".success")), false);
    assert.ok(h.audits.some(a => a.action.endsWith(".recovery_needed") && a.meta.phase === "commit_reconciliation"));
    assert.equal(Boolean(h.get().pdf_path), commitBeforeError);
  }
});

test("DB expiry changed during conversion prevents final commit and does not extend document lifetime", async () => {
  const h = harness({ convert: async ({ get }) => { get().expires_at = "2000-01-01"; return PDF; } });
  // A separate DB expiry change is fenced again by the final conditional commit.
  await assert.rejects(h.invoke, code("PDF_RETRY_CLAIM_LOST"));
  assert.equal(h.get().expires_at, "2000-01-01"); assert.equal(h.get().pdf_path, null); assert.deepEqual(h.removals, [h.uploads[0].key]);
});

test("wall-clock expiry while provider is running prevents any PDF upload", async () => {
  const originalNow = Date.now;
  const started = originalNow();
  const h = harness({ row: { expires_at: new Date(started + 10_000).toISOString() }, convert: async () => {
    Date.now = () => started + 20_000;
    return PDF;
  } });
  try {
    await assert.rejects(h.invoke, code("GENERATED_DOCUMENT_EXPIRED"));
    assert.equal(h.uploads.length, 0); assert.equal(h.get().pdf_path, null); assert.equal(h.get().pdf_retry_token, null);
  } finally { Date.now = originalNow; }
});

test("late converter failure cannot overwrite a newer worker's completed PDF or release its claim", async () => {
  const h = harness({ convert: async ({ get, set }) => {
    set({ ...get(), pdf_retry_token: "new-worker", pdf_status: "success", pdf_path: "new-worker.pdf" });
    throw new PdfConverterError("LATE_FAILURE", "late failure");
  } });
  await assert.rejects(h.invoke, code("PDF_RETRY_CLAIM_LOST"));
  assert.equal(h.get().pdf_status, "success"); assert.equal(h.get().pdf_path, "new-worker.pdf"); assert.equal(h.get().pdf_retry_token, "new-worker");
});

test("missing migration fails closed before any claim or provider; inconsistent ready metadata is not overwritten", async () => {
  const missing = harness({ schemaMissing: true }); await assert.rejects(missing.invoke, code("PDF_RETRY_SCHEMA_REQUIRED")); assert.equal(missing.downloads.length, 0);
  const bad = harness({ row: { pdf_path: "existing.pdf", pdf_status: "failed" } }); await assert.rejects(bad.invoke, code("PDF_DOCUMENT_STATE_CONFLICT"));
  assert.equal(bad.conversions.length, 0);
});

test("failure-state persistence error is surfaced instead of reporting a completed retry", async () => {
  const h = harness({ failRelease: true, convertError: new PdfConverterError("FAILED", "failure") });
  await assert.rejects(h.invoke, code("PDF_RETRY_RELEASE_FAILED")); assert.ok(h.get().pdf_retry_token);
  assert.ok(h.audits.some(a => a.action.endsWith(".recovery_needed")));
});

test("ready metadata lookup failure does not fall back to another paid conversion", async () => {
  const h = harness({ row: { pdf_path: "existing.pdf", pdf_status: "success" }, infoFailure: true });
  await assert.rejects(h.invoke, code("DOCUMENT_STORAGE_METADATA_FAILED")); assert.equal(h.conversions.length, 0);
});

test("route requires operator, validates ID before service, and uses an explicit five-minute runtime cap", async () => {
  let calls = 0, minimum;
  const route = load("../src/app/api/documents/[id]/retry-pdf/route.ts", {
    "@/lib/server/api": { ApiError, apiOk: (_id, payload) => payload, withApiHandler: (_request, handler) => handler("test"),
      requireRole: async (_request, _id, role) => { minimum = role; return { user: { id: OWNER } }; } },
    "@/lib/server/rate-limit": { enforceRateLimit: async () => {} },
    "@/lib/server/document-pdf-retry": { retryDocumentPdf: async () => { calls++; return { ok: true }; } },
  });
  await assert.rejects(() => route.POST({}, { params: Promise.resolve({ id: "invalid" }) }), code("INVALID_DOCUMENT_ID"));
  assert.equal(calls, 0); assert.equal(minimum, "operator"); assert.equal(route.maxDuration, 300);
  await route.POST({}, { params: Promise.resolve({ id: ID }) }); assert.equal(calls, 1);
});
