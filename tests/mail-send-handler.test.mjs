import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/components/mail-console.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("mail-console.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "MailConsole");
const readyDeclaration = component.body.statements
  .filter(ts.isVariableStatement)
  .flatMap(statement => [...statement.declarationList.declarations])
  .find(declaration => declaration.name.getText(parsed) === "isReady");

function handler(name, globals, withReadiness = false) {
  const declaration = component.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, "Expected the actual UI handler " + name);
  const extra = withReadiness ? "\ncomputeReady = () => (" + readyDeclaration.initializer.getText(parsed) + ");" : "";
  const context = vm.createContext({ ...globals, entry: null, computeReady: null, DOMException, Error });
  vm.runInContext(ts.transpileModule(declaration.getText(parsed) + "\nentry = " + name + ";" + extra, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  if (withReadiness) Object.defineProperty(context, "isReady", { get: () => context.computeReady() });
  return context;
}

const presentation = {};
vm.runInNewContext(ts.transpileModule(
  readFileSync(new URL("../src/lib/ticket-send-presentation.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, { exports: presentation });

const noop = () => {};
const cc = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/lib/cc-recipients.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: cc, Error });
const batchHelperNames = ["getBatchSendRecipients", "customerMappingStorageIdentity", "customerMappingSerialKey", "sameCcRecipients", "getLearnableMappingSource", "prepareLearnedMappingRetries"];
const recipientsNodes = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && batchHelperNames.includes(node.name?.text));
const recipientsContext = { ...cc, result: null, Error };
vm.runInNewContext(ts.transpileModule(recipientsNodes.map(node => node.getText(parsed)).join("\n") + "\nresult = {" + batchHelperNames.join(",") + "};", {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText, recipientsContext);
const realResult = {
  dryRun: false, duplicate: false, ticketId: "fixture-ticket", ticketUrl: null,
  autoSolveRequested: true, autoSolveStatus: "failed", autoSolveError: "Synthetic post-create failure",
};

function singleHarness(result = realResult, apiError = null) {
  const requests = [], notices = [];
  let nextKey = 0, context;
  context = handler("sendTicket", {
    busyLabel: null, targetVersion: { current: 1 }, recipientVersion: { current: 1 },
    session: { user: { id: "fixture-user" } }, latestCheckResult: null, generatedDocument: null, matchedSerial: null,
    idempotencyKey: "original-key", completedSendKey: null,
    sendRecipientSnapshot: null, ccInput: "cc@example.invalid", ccValidation: { error: null },
    mappingRevision: { current: "ready" }, mappingSyncBusy: false,
    parseCcEmails: cc.parseCcEmails,
    setSendRecipientSnapshot: value => { context.sendRecipientSnapshot = value; },
    settings: { defaultGroupId: "group", fixedAssigneeEmail: "staff@example.invalid", defaultValues: {} },
    selectedOrg: { id: "org" }, requesterName: "Fixture", requesterEmail: "fixture@example.invalid",
    subject: "same subject", body: "same body", engineerName: "Fixture", autoSolved: true, selectedSendMode: "real",
    attachments: [], generatedPdfToken: null, activeGeneratedAttachmentTokens: [],
    setError: noop, setNotice: value => notices.push(value),
    runBusy: async (_label, action) => action(),
    apiFetch: async (path, init) => {
      assert.equal(path, "/api/zendesk/tickets");
      requests.push(JSON.parse(init.body));
      if (apiError) throw apiError;
      return result;
    },
    crypto: { randomUUID: () => "new-key-" + (++nextKey) },
    setIdempotencyKey: value => { context.idempotencyKey = value; },
    setCompletedSendKey: value => { context.completedSendKey = value; },
    setGeneratedAttachmentTokens: noop, setIsConfirmOpen: noop, refreshRecords: noop,
    buildTicketSendNotice: presentation.getAutoSolveWarning,
  }, true);
  return { context, requests, notices };
}

test("single real creation and solve warnings keep the completed key locked against repeat confirmation", async () => {
  for (const [duplicate, autoSolveStatus] of [[false, "failed"], [true, "failed"], [true, "unknown"], [false, "solved"]]) {
    const h = singleHarness({ ...realResult, duplicate, autoSolveStatus });
    assert.equal(h.context.isReady, true);
    await h.context.entry();
    assert.equal(h.context.completedSendKey, "original-key");
    assert.equal(h.context.idempotencyKey, "original-key");
    assert.equal(h.context.isReady, false);
    await h.context.entry();
    assert.equal(h.requests.length, 1, "Same created ticket must not get a fresh key and another POST");
  }
});

test("a fresh document or target key allows the next single operation", async () => {
  const h = singleHarness();
  await h.context.entry();
  assert.equal(h.context.isReady, false);
  h.context.idempotencyKey = "new-document-key";
  assert.equal(h.context.isReady, true);
  await h.context.entry();
  assert.deepEqual(h.requests.map(request => request.idempotencyKey), ["original-key", "new-document-key"]);
  assert.equal(h.context.completedSendKey, "new-document-key");
});

test("an effective dry-run result does not lock real creation and still renews the test key", async () => {
  const h = singleHarness({ ...realResult, dryRun: true, ticketId: null, autoSolveStatus: "not_requested" });
  await h.context.entry();
  assert.notEqual(h.context.completedSendKey, "original-key");
  assert.equal(h.context.idempotencyKey, "new-key-1");
  assert.equal(h.context.isReady, true);
});

test("a result-unknown failure preserves the original key without claiming completion", async () => {
  const h = singleHarness(realResult, new Error("TICKET_SEND_RESULT_UNKNOWN"));
  await assert.rejects(h.context.entry(), /TICKET_SEND_RESULT_UNKNOWN/);
  assert.equal(h.context.idempotencyKey, "original-key");
  assert.equal(h.context.completedSendKey, null);
});

test("single retry retains the first organization, requester and normalized CC under the original key", async () => {
  const h = singleHarness(realResult, new Error("temporary failure"));
  h.context.ccInput = "CC@example.invalid; fixture@example.invalid; cc@example.invalid";
  await assert.rejects(h.context.entry(), /temporary failure/);
  h.context.ccInput = "changed@example.invalid";
  h.context.requesterEmail = "changed-requester@example.invalid";
  h.context.selectedOrg = { id: "changed-org" };
  await assert.rejects(h.context.entry(), /temporary failure/);
  for (const request of h.requests) {
    assert.equal(request.idempotencyKey, "original-key");
    assert.equal(request.organizationId, "org");
    assert.equal(request.requesterEmail, "fixture@example.invalid");
    assert.deepEqual(request.ccEmails, ["cc@example.invalid"]);
  }
});

test("single malformed CC is rejected before uploads or ticket requests and does not lock a snapshot", async () => {
  const h = singleHarness();
  h.context.ccInput = "invalid-address";
  await assert.rejects(h.context.entry());
  assert.equal(h.requests.length, 0);
  assert.equal(h.context.sendRecipientSnapshot, null);
});

function batchHarness(results, rowCount = results.length) {
  const rows = results.slice(0, rowCount).map((_result, index) => ({
    id: "row-" + index, result: { companyName: "Fixture " + index, serial: "LO100" + index },
    mapping: { id: "mapping-" + index, serial: "", companyName: "Fixture " + index, ccEmails: "", zendeskOrgId: "101", requesterName: "Fixture", requesterEmail: "fixture@example.invalid", defaultEngineerName: "Fixture" },
    document: { id: "doc-" + index, pdf: { fileName: "fixture.pdf", size: 1 } },
    sendMode: null, sendIdempotencyKey: null,
  }));
  let responseIndex = 0, notice = "";
  const requests = [], learned = [];
  const context = handler("sendBatchZendesk", {
    scopeVersion: { current: 1 }, batchSendMode: "real", canRealSend: true,
    resolveSafeSendMode: mode => mode, batchReadyForSend: rows,
    setIsBatchConfirmOpen: noop, setBatchSendMode: noop, setError: noop, setBatchProgress: noop,
    runBusy: async (_label, action) => action(),
    session: { user: { id: "fixture-user" } },
    buildBatchIdempotencyKey: ({ item }) => "stable-" + item.id,
    ...recipientsContext.result,
    confirmedMappings: { current: [] }, pendingMappingLearningProofs: { current: new Map() },
    updateBatchItem: (id, update) => {
      const index = rows.findIndex(row => row.id === id);
      rows[index] = update(rows[index]);
    },
    apiFetch: async (path, init) => {
      requests.push({ path, body: JSON.parse(init.body) });
      if (path === "/api/zendesk/uploads/generated") return {
        uploads: [{ token: "synthetic", type: "pdf", fileName: "fixture.pdf", size: 1, dryRun: true }],
      };
      assert.equal(path, "/api/zendesk/tickets");
      const result = results[responseIndex++];
      if (result instanceof Error) throw result;
      return result;
    },
    buildMailSubject: value => value, renderMailBodyTemplate: value => value,
    userPreferences: { mailBodyTemplate: "Fixture" }, normalizeActiveEngineerName: value => value,
    engineerName: "Fixture",
    settings: { defaultGroupId: "group", fixedAssigneeEmail: "staff@example.invalid", defaultValues: {} },
    getBatchSendOutcome: presentation.getBatchSendOutcome,
    getAutoSolveWarning: presentation.getAutoSolveWarning,
    upsertSerialBatchMapping: (...args) => { learned.push(args); return []; }, refreshRecords: noop, setNotice: value => { notice = value; },
  });
  return { context, rows, requests, learned, get notice() { return notice; } };
}

test("batch server downgrade to dry-run is summarized as test completion, not ticket creation", async () => {
  const h = batchHarness([{ ...realResult, dryRun: true, ticketId: null, autoSolveStatus: "not_requested" }]);
  await h.context.entry();
  assert.equal(h.rows[0].sendMode, "dry-run");
  assert.equal(h.rows[0].sendTicketId, null);
  assert.match(h.notice, /테스트(?: 완료)?\s*1건/);
  assert.doesNotMatch(h.notice, /티켓 생성\s*1건/);
});

test("mixed batch responses count actual test and ticket outcomes independently", async () => {
  const h = batchHarness([realResult, { ...realResult, dryRun: true, ticketId: null, autoSolveStatus: "not_requested" }]);
  await h.context.entry();
  assert.match(h.notice, /티켓 생성\s*1건/);
  assert.match(h.notice, /테스트(?: 완료)?\s*1건/);
  assert.match(h.notice, /자동 해결 확인 필요\s*1건/);
  assert.equal(presentation.isBatchSendEligible(h.rows[0], "real"), false);
  assert.equal(presentation.isBatchSendEligible(h.rows[1], "real"), true);
});

test("batch ticket request carries normalized mapped CC and records the requested snapshot", async () => {
  const h = batchHarness([{ ...realResult, ccEmails: ["team@example.invalid"], ccEvidence: "recorded" }]);
  h.rows[0].mapping.ccEmails = "TEAM@example.invalid; fixture@example.invalid; team@example.invalid";
  await h.context.entry();
  const request = h.requests.find(request => request.path === "/api/zendesk/tickets");
  assert.deepEqual(request.body.ccEmails, ["team@example.invalid"]);
  assert.deepEqual(Array.from(h.rows[0].sendRecipients.ccEmails), ["team@example.invalid"]);
  assert.deepEqual(Array.from(h.rows[0].sendCcEmails), ["team@example.invalid"]);
});

test("batch invalid mapped CC fails before attachment upload and does not allocate a send key", async () => {
  const h = batchHarness([realResult]);
  h.rows[0].mapping.ccEmails = "bad address";
  await h.context.entry();
  assert.equal(h.requests.length, 0);
  assert.equal(h.rows[0].sendIdempotencyKey, null);
  assert.equal(h.rows[0].status, "failed");
  assert.match(h.rows[0].error, /CC/);
});

test("batch actual send handler retries the same key and frozen recipients after a failure", async () => {
  const h = batchHarness([new Error("synthetic transport failure"), realResult], 1);
  h.rows[0].mapping.ccEmails = "first-cc@example.invalid";
  await h.context.entry();
  assert.equal(h.rows[0].status, "failed");
  const originalKey = h.rows[0].sendIdempotencyKey;
  h.rows[0].mapping = { ...h.rows[0].mapping, zendeskOrgId: "different-org", requesterEmail: "different@example.invalid", ccEmails: "changed-cc@example.invalid" };
  await h.context.entry();
  const tickets = h.requests.filter(request => request.path === "/api/zendesk/tickets");
  assert.equal(tickets.length, 2);
  for (const request of tickets) {
    assert.equal(request.body.idempotencyKey, originalKey);
    assert.equal(request.body.organizationId, "101");
    assert.equal(request.body.requesterEmail, "fixture@example.invalid");
    assert.deepEqual(request.body.ccEmails, ["first-cc@example.invalid"]);
  }
});

test("post-send handler never relearns deleted or changed mappings after a successful frozen retry", async () => {
  for (const variant of ["deleted", "changed-cc", "existing-serial", "response-mismatch", "unchanged"]) {
    const h = batchHarness([{ ...realResult, ccEmails: variant === "response-mismatch" ? ["other@example.invalid"] : [], ccEvidence: "recorded" }]);
    const source = { ...h.rows[0].mapping };
    h.context.confirmedMappings.current = variant === "deleted" ? [] : variant === "changed-cc" ? [{ ...source, ccEmails: "new@example.invalid" }] : variant === "existing-serial" ? [source, { ...source, serial: h.rows[0].result.serial, id: "already-recorded" }] : [source];
    await h.context.entry();
    assert.equal(h.rows[0].status, "sent", "Learning safeguards must not change ticket success");
    assert.equal(h.learned.length, variant === "unchanged" ? 1 : 0, variant);
  }
});
