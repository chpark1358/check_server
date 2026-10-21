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
const { getAutoSolveWarning, getBatchSendOutcome, isBatchSendEligible, formatBatchSendResult } = exports;
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

test("successful creation does not claim inbox delivery", () => {
  for (const autoSolveStatus of ["solved", "not_requested"]) {
    const result = getBatchSendOutcome({ ...sent, autoSolveStatus });
    assert.equal(result.sendWarning, null);
    assert.equal(formatBatchSendResult(result), "티켓 생성");
  }
});
