import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
function loadFunctions(path, names, dependencies) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(declarations.length, names.length);
  const compiled = ts.transpileModule(declarations.map(node => node.getText(parsed)).join("\n"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  return new Function("require", "exports", ...Object.keys(dependencies), compiled + `\nreturn {${names.join(",")}};`)(require, {}, ...Object.values(dependencies));
}
const presentationSource = readFileSync(new URL("../src/lib/ticket-send-presentation.ts", import.meta.url), "utf8");
const presentation = {};
new Function("exports", ts.transpileModule(presentationSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(presentation);
const Badge = ({ children }) => createElement("span", null, children);
const dependencies = { ...presentation, Badge };
const { HistoryRow, buildTicketSendNotice } = loadFunctions("../src/components/mail-console.tsx", ["HistoryRow", "sendStatusMeta", "buildTicketSendNotice"], dependencies);
const { DetailContent } = loadFunctions("../src/components/admin-console.tsx", ["DetailContent"], {
  ...dependencies, formatSendStatus: status => status, formatDateTime: date => date,
  safeTicketUrl: () => false, CopyField: () => null,
});
const record = {
  id: "fixture-record", subject: "합성 이력", status: "success", auto_solved: true,
  created_at: "2026-10-21T01:00:00Z", createdAt: "2026-10-21T01:00:00Z",
  attachment_count: 0, attachmentCount: 0, error_summary: null, errorSummary: null,
  autoSolveRequested: true, autoSolveStatus: "solved", autoSolveError: null,
  autoSolveRecordedAt: "2026-10-21T01:02:03Z", autoSolveEvidence: "recorded",
};

test("recent and administrator details display the stored solve result and record time", () => {
  const recent = renderToStaticMarkup(createElement(HistoryRow, { row: record }));
  const admin = renderToStaticMarkup(createElement(DetailContent, { detail: { kind: "sends", row: record }, onCopy: async () => {} }));
  for (const html of [recent, admin]) {
    assert.match(html, /자동 해결 완료/);
    assert.match(html, /결과 저장 시각:.*10:02:03/);
    assert.match(html, /실제 해결 시각과 다를 수/);
    assert.doesNotMatch(html, /수신 완료|발송 완료/);
  }
});

test("recent history does not reinterpret old requested solves as completed", () => {
  const row = { ...record, autoSolveStatus: undefined, autoSolveEvidence: "legacy", autoSolveRecordedAt: null };
  const html = renderToStaticMarkup(createElement(HistoryRow, { row }));
  assert.match(html, /자동 해결 미확인/);
  assert.match(html, /이전 이력.*별도 저장되지/);
  assert.doesNotMatch(html, /자동 해결 완료|결과 저장 시각:/);
});

test("replayed solved notice retains its original save time without implying current ticket status", () => {
  const html = renderToStaticMarkup(buildTicketSendNotice({ ...record, dryRun: false, duplicate: true, ticketId: "synthetic", ticketUrl: null }));
  assert.match(html, /이미 처리된 요청/);
  assert.match(html, /자동 해결 완료/);
  assert.match(html, /결과 저장 시각:.*10:02:03/);
});

test("recent failed solve shows its separate error and preserves ticket success", () => {
  const html = renderToStaticMarkup(createElement(HistoryRow, { row: { ...record, autoSolveStatus: "failed", autoSolveError: "합성 해결 오류" } }));
  assert.match(html, /티켓 생성/);
  assert.match(html, /자동 해결 실패/);
  assert.match(html, /합성 해결 오류/);
  assert.doesNotMatch(html, /자동 해결 완료/);
});
