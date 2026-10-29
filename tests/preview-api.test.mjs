import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const fixedNow = Date.parse("2026-10-15T10:00:00+09:00");
class FixtureDate extends Date { static now() { return fixedNow; } }

function fixture() {
  const exports = {};
  const forbiddenCalls = [];
  const forbidden = name => () => { forbiddenCalls.push(name); throw new Error("Forbidden preview side effect: " + name); };
  const modules = new Map();
  const pureImport = name => {
    if (!['@/lib/preview/schedules','@/lib/schedule-data'].includes(name)) return forbidden("runtime import")();
    if (modules.has(name)) return modules.get(name);
    const exports = {}; modules.set(name,exports);
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/"+name.slice(2)+".ts", import.meta.url), "utf8"), {
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
    }).outputText,{exports,require:pureImport,Date:FixtureDate,URLSearchParams,Error});
    return exports;
  };
  const cc = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/lib/cc-recipients.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: cc, Error });
  const context = {
    exports, URL, DOMException, Date: FixtureDate,
    fetch: forbidden("fetch"), XMLHttpRequest: forbidden("XMLHttpRequest"), WebSocket: forbidden("WebSocket"),
    localStorage: { getItem: forbidden("storage read"), setItem: forbidden("storage write") },
    require: name => name === "@/lib/cc-recipients" ? cc : pureImport(name),
  };
  const source = readFileSync(new URL("../src/lib/preview/api.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return { ...exports, forbiddenCalls };
}
const json = value => JSON.parse(JSON.stringify(value));
const post = body => ({ method: "POST", body: JSON.stringify(body) });
const put = body => ({ method: "PUT", body: JSON.stringify(body) });

test("schedule preview is paged synthetic data and rejects every write method", async () => {
  const f=fixture(),api=f.createPreviewApi();
  const first=await api("/api/schedules?range=all&category=all&pageSize=30");
  assert.equal(first.items.length,30); assert.equal(first.total,84); assert.equal(first.source.spreadsheetId,"preview");
  const second=await api("/api/schedules?range=all&category=all&pageSize=30&page=2");
  const seen=new Set(first.items.map(x=>x.id)); assert.ok(second.items.every(x=>!seen.has(x.id)));
  const holds=await api("/api/schedules?range=all&category=hold"); assert.ok(holds.items.every(x=>x.completionRaw==="x"));
  for(const method of ["POST","PUT","PATCH","DELETE"])await assert.rejects(()=>api("/api/schedules",{method}),/실행하지/);
  assert.equal(f.forbiddenCalls.length,0);
});

test("Google preview metadata and disconnect are synthetic and cannot launch a real OAuth flow",async()=>{
  const f=fixture(),api=f.createPreviewApi();
  assert.equal((await api("/api/google/oauth/connection")).connection.status,"connected");
  assert.equal((await api("/api/google/oauth/connection",{method:"DELETE"})).connection.status,"disconnected");
  const result=await api("/api/schedules");assert.equal(result.items.length,0);assert.equal(result.status,"access_denied");
  await assert.rejects(()=>api("/api/google/oauth/start",{method:"POST"}),/실행하지/);
  assert.equal(f.forbiddenCalls.length,0);
});

test("PDF-only retry preserves source identity, reuses an existing PDF and refuses expired documents without network", async () => {
  const f = fixture(), api = f.createPreviewApi();
  const before = (await api("/api/documents?status=failed")).documents[0];
  const retry = await api(`/api/documents/${before.id}/retry-pdf`, post({}));
  assert.equal(retry.reusedExistingPdf, false);
  assert.ok(retry.document.pdf);
  for (const key of ["id", "createdAt", "expiresAt"]) assert.equal(retry.document[key], before[key]);
  assert.deepEqual(json(retry.document.docx), json(before.docx));
  const again = await api(`/api/documents/${before.id}/retry-pdf`, post({}));
  assert.equal(again.reusedExistingPdf, true);
  assert.deepEqual(json(again.document), json(retry.document));
  assert.equal((await api("/api/documents?status=failed")).summary.total, 0);
  const expired = (await api("/api/documents?expiry=expired")).documents[0];
  await assert.rejects(() => api(`/api/documents/${expired.id}/retry-pdf`, post({})), /만료/);
  await assert.rejects(() => api(`/api/documents/${before.id}/retry-pdf`, {method:"GET"}), /실행하지/);
  assert.equal(f.forbiddenCalls.length, 0);
});

test("partial check fixture identifies unknowns while ordinary zero and false remain distinct", async () => {
  const f = fixture();
  const partial = f.previewCheckResult("LO00009999");
  assert.ok(partial.quality.missingFields.includes("system.cpuUsagePercent"));
  assert.ok(partial.quality.missingFields.includes("flags.agent"));
  assert.ok(partial.quality.invalidFields.includes("disks.storage.usedPercent"));
  assert.equal(partial.license.unverified, 0);
  assert.ok(!partial.quality.missingFields.includes("license.unverified"));
  assert.equal(f.previewCheckResult("LO00001001").quality.missingFields.length, 0);
});

test("document fixture pages retain full counts, server-like expiry/range filters and first-page snapshots", async () => {
  const f = fixture(), api = f.createPreviewApi();
  const first = await api("/api/documents?limit=3");
  assert.equal(first.documents.length, 3);
  assert.equal(first.summary.total, 8);
  assert.equal(first.hasMore, true);
  const second = await api("/api/documents?limit=3&cursor=" + first.nextCursor);
  assert.equal(second.summary.total, 8);
  assert.equal(second.documents.length, 3);
  assert.equal(new Set([...first.documents, ...second.documents].map(row => row.id)).size, 6);
  await api("/api/documents/check-report", post({ checkResult: { companyName: "New fixture", serial: "LO99999999" }, output: { pdf: true } }));
  const back = await api("/api/documents?limit=3&cursor=" + first.startCursor);
  assert.deepEqual(json(back.documents), json(first.documents));
  assert.equal(back.summary.total, 8);
  const refreshed = await api("/api/documents?limit=3");
  assert.equal(refreshed.summary.total, 9);
  const expired = await api("/api/documents?expiry=expired");
  assert.ok(expired.documents.every(row => Date.parse(row.expiresAt) <= fixedNow));
  const recent = await api("/api/documents?range=7d");
  assert.equal(recent.summary.total, 2);
  const failed = await api("/api/documents?status=failed&attached=false");
  assert.equal(failed.summary.pdfReady, 0);
  assert.equal(failed.summary.attached, 0);
  const unavailable = await api("/api/documents?status=unavailable");
  assert.equal(unavailable.summary.pdfReady, 0);
  assert.ok(unavailable.documents.every(row => row.pdfStatus === "unavailable"));
  await assert.rejects(() => api("/api/documents?status=disabled"), /검색 조건/);
  await assert.rejects(() => api("/api/documents?status=pending"), /검색 조건/);
  await assert.rejects(() => api("/api/documents?limit=3&expiry=available&cursor=" + first.nextCursor), /검색 조건/);
  assert.equal(f.forbiddenCalls.length, 0);
});

test("serials resolve to matching A/B/C companies, organizations and separate recipients", async () => {
  const f = fixture(), api = f.createPreviewApi();
  const emails = new Set();
  for (let index = 0; index < 3; index++) {
    const serial = "LO0000100" + (index + 1), letter = String.fromCharCode(65 + index);
    const result = await api("/api/solution/checkup", post({ serial }));
    const org = await api("/api/zendesk/organizations?autoMatch=true&query=wrong-company&serial=" + serial);
    assert.equal(result.result.companyName, "샘플 고객 " + letter);
    assert.equal(org.matchedOrganization.name, result.result.companyName);
    assert.equal(org.matchedOrganization.id, String(101 + index));
    assert.equal(org.matchedOrganization.matched_serial, serial);
    const users = await api("/api/zendesk/users?organizationId=" + org.matchedOrganization.id);
    assert.equal(users.users[0].name, "담당자 " + letter);
    emails.add(users.users[0].email);
  }
  assert.equal(emails.size, 3);
  assert.equal(f.forbiddenCalls.length, 0);
});

test("organization GET search uses query parameters and unknown organization has no recipient fallback", async () => {
  const api = fixture().createPreviewApi();
  const result = await api("/api/zendesk/organizations?query=" + encodeURIComponent("샘플 고객 B"));
  assert.equal(result.organizations.length, 1);
  assert.equal(result.organizations[0].id, "102");
  assert.deepEqual(json((await api("/api/zendesk/users?organizationId=missing")).users), []);
});

test("preference PUT consumes only the nested payload without adding a preferences key", async () => {
  const api = fixture().createPreviewApi();
  const saved = await api("/api/user/preferences", put({
    preferences: { defaultEngineerName: "Fixture engineer", unexpected: true },
    defaultEngineerName: "Wrong top-level value",
  }));
  assert.equal(saved.preferences.defaultEngineerName, "Fixture engineer");
  assert.equal(Object.hasOwn(saved.preferences, "preferences"), false);
  assert.equal(Object.hasOwn(saved.preferences, "unexpected"), false);
  assert.equal((await api("/api/user/preferences")).preferences.defaultEngineerName, "Fixture engineer");
});

test("adapter instances and returned JSON snapshots do not share mutable preferences or mappings", async () => {
  const f = fixture(), first = f.createPreviewApi(), second = f.createPreviewApi();
  await first("/api/user/preferences", put({ preferences: { defaultEngineerName: "Changed" } }));
  const returned = await first("/api/user/preferences");
  returned.preferences.defaultEngineerName = "Mutated response";
  assert.equal((await first("/api/user/preferences")).preferences.defaultEngineerName, "Changed");
  assert.notEqual((await second("/api/user/preferences")).preferences.defaultEngineerName, "Changed");
  const initialMappings = await first("/api/user/customer-mappings");
  const firstMappings = await first("/api/user/customer-mappings", put({
    mappings: [], expectedRevision: initialMappings.revision, allowEmpty: true,
  }));
  firstMappings.mappings.push({ id: "caller-only" });
  assert.equal((await first("/api/user/customer-mappings")).mappings.length, 0);
  assert.equal((await second("/api/user/customer-mappings")).mappings.length, 1);
  assert.equal(f.forbiddenCalls.length, 0);
});

test("mapping preview rejects missing or stale revisions and unconfirmed clearing", async () => {
  const api = fixture().createPreviewApi();
  const before = await api("/api/user/customer-mappings");
  await assert.rejects(api("/api/user/customer-mappings", put({ mappings: [] })), (error) => error.status === 428);
  await assert.rejects(api("/api/user/customer-mappings", put({
    mappings: [], expectedRevision: before.revision,
  })));
  assert.equal((await api("/api/user/customer-mappings")).mappings.length, 1);
  const cleared = await api("/api/user/customer-mappings", put({
    mappings: [], expectedRevision: before.revision, allowEmpty: true,
  }));
  assert.notEqual(cleared.revision, before.revision);
  await assert.rejects(api("/api/user/customer-mappings", put({
    mappings: before.mappings, expectedRevision: before.revision,
  })), (error) => error.status === 409);
  assert.equal((await api("/api/user/customer-mappings")).mappings.length, 0);
});

test("ticket preview matches preview.dryRunOnly and preview.ticket API nesting", async () => {
  const api = fixture().createPreviewApi();
  const result = await api("/api/zendesk/tickets/preview", post({
    subject: "Preview subject", body: "Preview body", requesterName: "Fixture",
    requesterEmail: "person@demo.example", organizationId: "102", uploadTokens: ["sample-token"],
  }));
  assert.equal(result.preview.dryRunOnly, true);
  assert.equal(result.preview.ticket.subject, "Preview subject");
  assert.equal(result.preview.ticket.comment.body, "Preview body");
  assert.equal(result.preview.ticket.requester.email, "person@demo.example");
  assert.equal(Object.hasOwn(result, "previewPayload"), false);
});

test("local ticket preview and dry-run return normalized CC without external side effects", async () => {
  const f = fixture(), api = f.createPreviewApi();
  const body = { requesterEmail: "owner@example.invalid", ccEmails: "CC@example.invalid; owner@example.invalid; cc@example.invalid" };
  const preview = await api("/api/zendesk/tickets/preview", post(body));
  assert.deepEqual(json(preview.preview.ticket.email_ccs), [{ user_email: "cc@example.invalid", action: "put" }]);
  const response = await api("/api/zendesk/tickets", post({ ...body, dryRun: false }));
  assert.equal(response.dryRun, true);
  assert.equal(response.ccEvidence, "recorded");
  assert.deepEqual(json(response.ccEmails), ["cc@example.invalid"]);
  await assert.rejects(api("/api/zendesk/tickets/preview", post({ ...body, ccEmails: "invalid" })));
  assert.deepEqual(f.forbiddenCalls, []);
});

test("document creation uses object pdfStatus while the library retains stored string status", async () => {
  const f = fixture(), api = f.createPreviewApi();
  const generated = await api("/api/documents/check-report", post({ checkResult: f.previewCheckResult("LO00001002") }));
  assert.deepEqual(json(generated.document.pdfStatus), { ok: true });
  assert.equal(generated.document.companyName, "샘플 고객 B");
  const library = await api("/api/documents");
  assert.equal(library.documents.find(d => d.id === generated.document.id).pdfStatus, "success");
  const docxOnly = await api("/api/documents/check-report", post({ output: { pdf: false } }));
  assert.equal(docxOnly.document.pdf, null);
  assert.deepEqual(json(docxOnly.document.pdfStatus), { ok: true });
  const only = await api("/api/documents?status=not_requested");
  assert.equal(only.documents.length, 1);
  assert.equal(only.documents[0].id, docxOnly.document.id);
});

test("history returns normalized appliedFilters with KST calendar bounds and stable asOf", async () => {
  const api = fixture().createPreviewApi();
  const result = await api("/api/history/overview?range=30d&q=%20LO00001001%20&type=check&status=all&limit=5&includeSummary=false");
  assert.deepEqual(json(result.appliedFilters), {
    range: "30d", from: "2026-09-16", to: "2026-10-15", type: "check", status: "all",
    q: "lo00001001", sort: "newest", limit: 5, timezone: "Asia/Seoul", asOf: new Date(fixedNow).toISOString(),
  });
  assert.equal(result.summary, null);
  assert.ok(result.items.every(item => item.type === "check" && item.serial === "LO00001001"));
});

test("history pagination, custom date and oldest order match the reported filters", async () => {
  const api = fixture().createPreviewApi();
  const first = await api("/api/history/overview?range=all&limit=5");
  assert.equal(first.hasMore, true);
  const next = await api("/api/history/overview?range=all&limit=5&cursor=" + first.nextCursor);
  assert.ok(next.items.every(item => !first.items.some(previous => previous.id === item.id)));
  assert.equal(first.appliedFilters.asOf, next.appliedFilters.asOf);
  const oldest = await api("/api/history/overview?range=all&sort=oldest&limit=5");
  assert.equal(oldest.appliedFilters.sort, "oldest");
  assert.ok(Date.parse(oldest.items[0].createdAt) < Date.parse(oldest.items[1].createdAt));
  const custom = await api("/api/history/overview?range=custom&from=2026-10-15&to=2026-10-15");
  assert.equal(custom.items.length, 1);
  assert.equal(custom.appliedFilters.from, "2026-10-15");
  assert.equal(custom.appliedFilters.to, "2026-10-15");
});

test("admin fixture uses camelCase metadata consumed by the real table", async () => {
  const api = fixture().createPreviewApi(), result = await api("/api/admin/overview");
  assert.equal(result.auditLogs[0].metadata.companyName, result.auditLogs[0].companyName);
  assert.equal(result.auditLogs[0].metadata.errorSummary, result.auditLogs[0].summary);
  assert.equal(Object.hasOwn(result.auditLogs[0].metadata, "company_name"), false);
  assert.equal(result.users[0].invitedAt, null);
});

test("all supported preview paths are local; real-send flags cannot trigger external effects", async () => {
  const f = fixture(), api = f.createPreviewApi();
  const reads = [
    "/api/health", "/api/settings/zendesk", "/api/user/preferences", "/api/user/customer-mappings",
    "/api/engineer-signatures", "/api/documents", "/api/history/overview", "/api/history/ticket-sends",
    "/api/zendesk/organizations?query=sample", "/api/zendesk/users?organizationId=101", "/api/admin/overview",
  ];
  for (const path of reads) assert.equal((await api(path)).ok, true);
  for (const path of ["/api/solution/login", "/api/solution/logout", "/api/solution/checkup", "/api/documents/check-report", "/api/zendesk/uploads", "/api/zendesk/tickets/preview"]) {
    assert.equal((await api(path, post({}))).ok, true);
  }
  const upload = await api("/api/zendesk/uploads/generated", post({ types: ["docx", "pdf"], dryRun: false }));
  assert.ok(upload.uploads.every(file => file.dryRun));
  const sent = await api("/api/zendesk/tickets", post({ dryRun: false }));
  assert.equal(sent.dryRun, true);
  assert.equal(sent.ticketId, null);
  assert.equal(sent.ticketUrl, null);
  assert.equal(f.forbiddenCalls.length, 0);
});

test("unsupported routes/methods throw with no network fallback and aborted writes do not mutate", async () => {
  const f = fixture(), api = f.createPreviewApi();
  for (const [path, init] of [
    ["/api/admin/invitations", post({ email: "test@demo.example" })],
    ["/api/unknown", {}],
    ["/api/settings/zendesk", put({})],
    ["https://example.test/unknown", {}],
  ]) await assert.rejects(api(path, init));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api("/api/user/preferences", {
    ...put({ preferences: { defaultEngineerName: "Should not save" } }), signal: controller.signal,
  }), error => error.name === "AbortError");
  assert.notEqual((await api("/api/user/preferences")).preferences.defaultEngineerName, "Should not save");
  assert.equal(f.forbiddenCalls.length, 0);
});
