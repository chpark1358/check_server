import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
function moduleExports(path) {
  const exports = {};
  new Function("exports", ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(exports);
  return exports;
}
const cc = moduleExports("../src/lib/cc-recipients.ts");
const presentation = moduleExports("../src/lib/ticket-send-presentation.ts");
const source = readFileSync(new URL("../src/components/mail-console.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("mail-console.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "MailConsole");
function functions(path, names, dependencies) {
  const text = path ? readFileSync(new URL(path, import.meta.url), "utf8") : source;
  const ast = path ? ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) : parsed;
  const candidates = [...ast.statements, ...(path ? [] : component.body.statements)];
  const declarations = candidates.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(declarations.length, names.length, "Extract real production functions");
  const compiled = ts.transpileModule(declarations.map(node => node.getText(ast)).join("\n"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  return new Function("require", "exports", ...Object.keys(dependencies), compiled + `\nreturn {${names.join(",")}};`)(require, {}, ...Object.values(dependencies));
}
const helpers = functions(null, ["validateCcInput", "findSingleRecipientMapping", "findBatchMapping", "customerMappingSerialKey", "customerMappingStorageIdentity", "reconcileBatchItemMappings", "sameCcRecipients", "getLearnableMappingSource", "prepareLearnedMappingRetries", "getBatchSendRecipients", "batchCcDescription", "normalizeMappingForm", "manualMappingIdentity", "uniqueManualMappingOptions"], {
  ...cc, ...presentation, normalizeActiveEngineerName: value => value,
});
const mapping = (overrides = {}) => ({
  id: "mapping", companyName: "Fixture company", serial: "LO24123103", zendeskOrgId: "org-1",
  requesterName: "Fixture", requesterEmail: "owner@example.invalid", ccEmails: "TEAM@example.invalid; team@example.invalid",
  defaultEngineerName: "", memo: "", ...overrides,
});
const target = { serial: "24123103", companyName: "Fixture company", organizationId: "org-1", requesterEmail: "OWNER@example.invalid" };

test("single CC mapping requires matching target, organization and requester", () => {
  const row = mapping();
  assert.equal(helpers.findSingleRecipientMapping([row], target), row);
  for (const changed of [{ serial: "LO99999999" }, { organizationId: "another-org" }, { requesterEmail: "another@example.invalid" }, { requesterEmail: "" }]) {
    assert.equal(helpers.findSingleRecipientMapping([row], { ...target, ...changed }), null);
  }
});

test("serial mapping precedence does not leak a company fallback's CC to another recipient", () => {
  const serial = mapping({ requesterEmail: "different@example.invalid" });
  const fallback = mapping({ id: "fallback", serial: "", ccEmails: "fallback@example.invalid" });
  assert.equal(helpers.findSingleRecipientMapping([serial, fallback], target), null);
  assert.equal(helpers.findSingleRecipientMapping([fallback], target), fallback);
});

test("mapping save normalizes only the submitted draft and does not mutate old malformed values", () => {
  const old = mapping({ ccEmails: "invalid old address" });
  assert.throws(() => helpers.normalizeMappingForm(old), /CC/);
  assert.equal(old.ccEmails, "invalid old address");
  const normalized = helpers.normalizeMappingForm(mapping({ ccEmails: "owner@example.invalid; TEAM@example.invalid; team@example.invalid" }));
  assert.equal(normalized.ccEmails, "team@example.invalid");
  assert.deepEqual(helpers.validateCcInput(old.ccEmails, old.requesterEmail).emails, []);
  assert.match(helpers.validateCcInput(old.ccEmails, old.requesterEmail).error, /CC/);
});

test("manual mapping choices do not collapse recipients with distinct CC lists", () => {
  const a = mapping(), b = mapping({ id: "second", ccEmails: "another@example.invalid" });
  assert.equal(helpers.uniqueManualMappingOptions([a, b]).length, 2);
});

test("batch retry uses the fixed recipient snapshot even after the source mapping changes", () => {
  const item = { serial: target.serial, mapping: mapping(), sendIdempotencyKey: null, sendMode: null };
  const recipients = helpers.getBatchSendRecipients(item, "dry-run");
  item.sendIdempotencyKey = "original-key"; item.sendMode = "dry-run"; item.sendRecipients = recipients;
  item.mapping = mapping({ zendeskOrgId: "changed", requesterEmail: "changed@example.invalid", ccEmails: "bad address" });
  assert.equal(helpers.getBatchSendRecipients(item, "dry-run"), recipients);
  assert.deepEqual(recipients.ccEmails, ["team@example.invalid"]);
  assert.equal(recipients.organizationId, "org-1");
  assert.throws(() => helpers.getBatchSendRecipients(item, "real"), /CC/);
});

test("batch recorded CC displays the server's stored response, with legacy and empty separate", () => {
  const item = { status: "sent", mapping: mapping(), sendRecipients: { ccEmails: ["draft@example.invalid"] } };
  assert.match(helpers.batchCcDescription({ ...item, sendCcEmails: ["stored@example.invalid"], sendCcEvidence: "recorded" }), /stored@example.invalid/);
  assert.doesNotMatch(helpers.batchCcDescription({ ...item, sendCcEmails: ["stored@example.invalid"], sendCcEvidence: "recorded" }), /draft@example.invalid/);
  assert.equal(helpers.batchCcDescription({ ...item, sendCcEmails: [], sendCcEvidence: "recorded" }), "참조 없음");
  assert.match(helpers.batchCcDescription({ ...item, sendCcEmails: null, sendCcEvidence: "legacy" }), /CC 기록 없음/);
});

test("requester selection invalidates pending confirmation and clears manual CC overrides", () => {
  const seen = {}, recipientVersion = { current: 4 };
  const { applyRequester } = functions(null, ["applyRequester"], {
    recipientVersion, selectedOrg: { name: "Fixture" }, latestCheckResult: null, generatedDocument: null,
    setIsConfirmOpen: value => { seen.confirm = value; }, setCcOverride: value => { seen.override = value; },
    setRequesterEmail: value => { seen.email = value; }, setRequesterName: value => { seen.name = value; },
    subjectDirty: true, bodyDirty: false, userPreferences: { mailBodyTemplate: "template" },
    renderMailBodyTemplate: (_template, name) => name, setBody: value => { seen.body = value; },
  });
  applyRequester({ name: "Changed", email: "changed@example.invalid" });
  assert.equal(recipientVersion.current, 5);
  assert.equal(seen.confirm, false);
  assert.equal(seen.override, null);
  assert.equal(seen.email, "changed@example.invalid");
});

test("manual batch mapping changes are refused after an attempt key exists", () => {
  let item = { mapping: mapping(), sendIdempotencyKey: "attempted-key" };
  const original = item;
  const { applyBatchItemMapping } = functions(null, ["applyBatchItemMapping"], {
    batchMappings: [mapping({ id: "replacement", ccEmails: "new@example.invalid" })],
    updateBatchItem: (_id, update) => { item = update(item); },
  });
  applyBatchItemMapping("item", "replacement");
  assert.equal(item, original);
  assert.equal(item.mapping.ccEmails, original.mapping.ccEmails);
});

test("pre-attempt reconciliation updates identity matches and removes deleted mappings without disturbing retries", () => {
  const old = mapping(), frozen = { serial: target.serial, mapping: old, sendIdempotencyKey: "sent-key", sendRecipients: { requesterEmail: old.requesterEmail, ccEmails: ["original@example.invalid"] } };
  const queued = { serial: target.serial, mapping: old, sendIdempotencyKey: null, result: { serial: target.serial, companyName: old.companyName } };
  const replacement = mapping({ id: "replacement-id", requesterEmail: "changed@example.invalid", ccEmails: "changed-cc@example.invalid" });
  const updated = helpers.reconcileBatchItemMappings([queued, frozen], [replacement]);
  assert.equal(updated[0].mapping, replacement);
  assert.equal(helpers.getBatchSendRecipients(updated[0], "dry-run").requesterEmail, replacement.requesterEmail);
  assert.deepEqual(helpers.getBatchSendRecipients(updated[0], "dry-run").ccEmails, ["changed-cc@example.invalid"]);
  assert.equal(updated[1], frozen);
  const deleted = helpers.reconcileBatchItemMappings(updated, []);
  assert.equal(deleted[0].mapping, null);
  assert.throws(() => helpers.getBatchSendRecipients(deleted[0], "dry-run"), /매핑/);
  assert.equal(deleted[1], frozen);
});

test("manual source identity survives unrelated target matches while deleted source is not substituted", () => {
  const manual = mapping({ id: "manual", serial: "", companyName: "Manually selected source" });
  const replacement = { ...manual, id: "new-id", ccEmails: "current@example.invalid" };
  const item = { serial: target.serial, result: { serial: target.serial, companyName: "Fixture company" }, mapping: manual, sendIdempotencyKey: null };
  const exactTarget = mapping({ ccEmails: "different@example.invalid" });
  assert.equal(helpers.reconcileBatchItemMappings([item], [exactTarget, replacement])[0].mapping, replacement);
  const deleted = helpers.reconcileBatchItemMappings([item], [exactTarget])[0];
  assert.equal(deleted.mapping, null);
  assert.equal(helpers.reconcileBatchItemMappings([deleted], [exactTarget])[0].mapping, null, "A later refresh must not silently replace the deleted manual choice");
  assert.equal(helpers.reconcileBatchItemMappings([{ ...item, mapping: null }], [exactTarget])[0].mapping, exactTarget);
});

test("post-send learning cannot revive deleted or changed source recipients or overwrite an existing serial", () => {
  const source = mapping({ serial: "", ccEmails: "original@example.invalid" });
  const recipients = { organizationId: source.zendeskOrgId, requesterEmail: source.requesterEmail, requesterName: source.requesterName, ccEmails: ["original@example.invalid"] };
  const identity = helpers.customerMappingStorageIdentity(source);
  assert.equal(helpers.getLearnableMappingSource(target.serial, identity, recipients, [source]), source);
  for (const confirmed of [[], [{ ...source, ccEmails: "changed@example.invalid" }], [{ ...source, requesterEmail: "changed@example.invalid" }], [{ ...source, zendeskOrgId: "changed" }], [source, mapping({ ccEmails: "original@example.invalid" })]]) {
    assert.equal(helpers.getLearnableMappingSource(target.serial, identity, recipients, confirmed), null);
  }
});

test("pending learning retry rechecks its proof and uses current source metadata", () => {
  const source = mapping({ serial: "", ccEmails: "original@example.invalid", memo: "old memo" });
  const learned = mapping({ id: "learned", ccEmails: "original@example.invalid", memo: "old memo" });
  const proof = { sourceIdentity: helpers.customerMappingStorageIdentity(source), recipients: { organizationId: source.zendeskOrgId, requesterEmail: source.requesterEmail, requesterName: source.requesterName, ccEmails: ["original@example.invalid"] } };
  const proofs = new Map([[learned.id, proof]]);
  assert.deepEqual(helpers.prepareLearnedMappingRetries([learned], proofs, []), []);
  assert.deepEqual(helpers.prepareLearnedMappingRetries([learned], proofs, [{ ...source, ccEmails: "new@example.invalid" }]), []);
  assert.deepEqual(helpers.prepareLearnedMappingRetries([learned], proofs, [source, { ...learned, memo: "user saved" }]), []);
  const retryable = helpers.prepareLearnedMappingRetries([learned], proofs, [{ ...source, memo: "current memo", requesterName: "Current name" }]);
  assert.equal(retryable[0].memo, "current memo");
  assert.equal(retryable[0].requesterName, "Current name");
  assert.equal(retryable[0].serial, learned.serial);
});

test("recent and admin history render stored CC without claiming historical absence or delivery", () => {
  const Badge = ({ children }) => createElement("span", null, children);
  const { HistoryRow } = functions(null, ["HistoryRow", "sendStatusMeta"], { ...presentation, Badge });
  const { DetailContent } = functions("../src/components/admin-console.tsx", ["DetailContent"], {
    ...presentation, Badge, formatSendStatus: status => status, formatDateTime: value => value, safeTicketUrl: () => false, CopyField: () => null,
  });
  for (const [ccEmails, ccEvidence, expected] of [[null, "legacy", "CC 기록 없음"], [[], "recorded", "참조 없음"], [["team@example.invalid"], "recorded", "요청 CC: team@example.invalid"]]) {
    const record = { id: "event", status: "dry_run", subject: "Fixture", created_at: "2026-10-21T00:00:00Z", createdAt: "2026-10-21T00:00:00Z", attachment_count: 0, attachmentCount: 0, ccEmails, ccEvidence };
    const recent = renderToStaticMarkup(createElement(HistoryRow, { row: record }));
    const admin = renderToStaticMarkup(createElement(DetailContent, { detail: { kind: "sends", row: record }, onCopy: async () => {} }));
    assert.ok(recent.includes(expected)); assert.ok(admin.includes(expected));
    assert.doesNotMatch(recent + admin, /수신 완료/);
  }
});
