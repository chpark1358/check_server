import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/lib/ticket-send-presentation.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });
const { getAutoSolveWarning, getBatchSendOutcome, isBatchSendEligible, formatBatchSendResult, formatAutoSolveLabel, formatAutoSolveRecord } = exports;
const sent = { dryRun: false, duplicate: false, ticketId: "test-ticket", ticketUrl: null, autoSolveStatus: "solved" };

test("solve failure remains a created ticket, with a warning and no batch resend", () => {
  const result = getBatchSendOutcome({ ...sent, autoSolveStatus: "failed", autoSolveError: "required field" });
  assert.equal(result.status, "sent");
  assert.equal(result.error, null);
  assert.match(result.sendWarning, /required field/);
  assert.match(result.sendWarning, /다시 생성하지 말고/);
  assert.equal(isBatchSendEligible(result, "real"), false);
  assert.equal(isBatchSendEligible(result, "dry-run"), false);
  assert.equal(formatBatchSendResult(result), "티켓 생성 · 해결 확인 필요");
});

test("duplicate response retains the initial solve-failure warning", () => {
  const result = { ...sent, autoSolveStatus: "failed", autoSolveError: "permission denied" };
  assert.equal(getAutoSolveWarning(result), getAutoSolveWarning({ ...result, duplicate: true }));
});

test("legacy unknown does not claim solved or allow a new ticket", () => {
  const result = getBatchSendOutcome({ ...sent, duplicate: true, autoSolveStatus: "unknown" });
  assert.match(result.sendWarning, /확인할 수 없습니다/);
  assert.equal(isBatchSendEligible(result, "real"), false);
});

test("dry run does not claim ticket or solve completion, even with stale solve flags", () => {
  for (const autoSolveStatus of ["failed", "unknown", "solved"]) {
    const result = getBatchSendOutcome({ ...sent, dryRun: true, ticketId: null, autoSolveStatus });
    assert.equal(result.sendWarning, null);
    assert.equal(formatBatchSendResult(result), "테스트 완료");
    assert.equal(isBatchSendEligible(result, "dry-run"), false);
    assert.equal(isBatchSendEligible(result, "real"), true);
  }
});

test("successful creation distinguishes solved without claiming inbox delivery", () => {
  for (const autoSolveStatus of ["solved", "not_requested"]) {
    const result = getBatchSendOutcome({ ...sent, autoSolveStatus });
    assert.equal(result.sendWarning, null);
    assert.equal(formatBatchSendResult(result), autoSolveStatus === "solved" ? "티켓 생성 · 자동 해결 완료" : "티켓 생성");
    assert.doesNotMatch(formatBatchSendResult(result), /수신|발송 완료/);
  }
});

test("recorded solve metadata survives the batch response, including duplicate results", () => {
  const recorded = { ...sent, autoSolveRecordedAt: "2026-10-21T01:02:03Z", autoSolveEvidence: "recorded" };
  for (const duplicate of [false, true]) {
    const result = getBatchSendOutcome({ ...recorded, duplicate });
    assert.equal(result.sendAutoSolveStatus, "solved");
    assert.equal(result.sendAutoSolveRecordedAt, recorded.autoSolveRecordedAt);
    assert.equal(result.sendAutoSolveEvidence, "recorded");
    assert.equal(isBatchSendEligible(result, "real"), false);
  }
});

test("record time is labelled as storage time in KST, not the Zendesk solve time", () => {
  const note = formatAutoSolveRecord({ autoSolveRecordedAt: "2026-10-21T01:02:03Z", autoSolveEvidence: "recorded" });
  assert.match(note, /결과 저장 시각/);
  assert.match(note, /10:02:03.*KST/);
  assert.match(note, /실제 해결 시각과 다를 수 있습니다/);
  assert.doesNotMatch(formatAutoSolveRecord({ autoSolveRecordedAt: "bad-date", autoSolveEvidence: "recorded" }), /Invalid Date/);
  assert.equal(formatAutoSolveRecord({ autoSolveRecordedAt: null, autoSolveEvidence: "recorded" }), null);
});

test("legacy requests do not become proof of successful resolution", () => {
  assert.equal(formatAutoSolveLabel({ autoSolveRequested: true }), "자동 해결 미확인");
  assert.equal(formatAutoSolveLabel({ autoSolveRequested: false }), "자동 해결 미요청");
  assert.match(formatAutoSolveRecord({ autoSolveEvidence: "legacy", autoSolveRecordedAt: "2026-10-21T01:02:03Z" }), /이전 이력.*별도 저장되지/);
  assert.doesNotMatch(formatAutoSolveRecord({ autoSolveEvidence: "legacy" }), /완료|결과 저장 시각:/);
});

test("unknown recorded outcomes keep the provider reason and prohibit recreating the ticket", () => {
  const result = { ...sent, autoSolveStatus: "unknown", autoSolveError: "응답 상태가 확인되지 않았습니다.", autoSolveEvidence: "recorded" };
  assert.match(getAutoSolveWarning(result), /응답 상태가 확인되지 않았습니다/);
  assert.match(getAutoSolveWarning(result), /티켓을 다시 생성하지 말고/);
});
