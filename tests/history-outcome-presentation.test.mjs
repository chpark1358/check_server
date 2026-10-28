import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const loaded = new Map();
function load(file) {
  const path = resolve(root, file);
  if (loaded.has(path)) return loaded.get(path);
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const compiledModule = { exports: {} };
  loaded.set(path, compiledModule.exports);
  const testExports = file === "src/components/history-panel.tsx" ? "\nexports.MailOutcomeDetails = MailOutcomeDetails;" : "";
  new Function("require", "module", "exports", compiled + testExports)((name) => {
    if (!name.startsWith("@/")) return require(name);
    const relative = "src/" + name.slice(2);
    const candidate = [relative + ".tsx", relative + ".ts"].find((item) => existsSync(resolve(root, item)));
    assert.ok(candidate, "Expected a local component import: " + name);
    return load(candidate);
  }, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
const { HistoryPanel, MailOutcomeDetails } = load("src/components/history-panel.tsx");
const noop = () => {};
function item(overrides = {}) {
  return {
    id: "fixture-event", type: "mail", action: "zendesk.ticket.send", status: "success",
    actorEmail: null, companyName: "합성 이력", serial: null, title: "전달 검증",
    summary: "처리 기록", targetId: "123", createdAt: "2026-10-21T00:00:00Z",
    autoSolveRequested: false, autoSolveStatus: "not_requested", autoSolveError: null,
    ...overrides,
  };
}
function render(items, overrides = {}) {
  return renderToStaticMarkup(createElement(HistoryPanel, {
    overview: { summary: null, items }, range: "all", type: "mail", status: "success", query: "", busy: false,
    onRangeChange: noop, onTypeChange: noop, onStatusChange: noop, onQueryChange: noop, onSearch: noop,
    ...overrides,
  }));
}
function listText(html) {
  const table = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  const mobile = html.match(/<ul class="divide-y md:hidden"[\s\S]*?<\/ul>/)?.[0] ?? "";
  assert.ok(table && mobile, "Desktop and mobile history must both render");
  return [table, mobile].map((markup) => markup.replace(/<[^>]+>/g, ""));
}

test("successful mail describes confirmed ticket creation without implying delivery or auto-solve", () => {
  for (const status of ["not_requested", "solved"]) {
    for (const text of listText(render([item({ autoSolveStatus: status, autoSolveRequested: status === "solved" })]))) {
      assert.match(text, /티켓 생성/);
      assert.doesNotMatch(text, /해결 실패|해결 미확인|발송 완료|수신 완료/);
    }
  }
});

test("auto-solve failure and unknown outcomes remain visible in desktop and mobile success results", () => {
  const rows = [
    item({ id: "partial", autoSolveRequested: true, autoSolveStatus: "failed", autoSolveError: "해결 실패 사유" }),
    item({ id: "unknown", autoSolveRequested: true, autoSolveStatus: "unknown" }),
  ];
  const html = render(rows);
  for (const text of listText(html)) {
    assert.match(text, /티켓 생성 · 해결 실패/);
    assert.match(text, /티켓 생성 · 해결 미확인/);
  }
  assert.match(html, /성공<\/span><strong[^>]*>2건/);
  assert.match(html, /실패<\/span><strong[^>]*>0건/);
  assert.equal(rows[0].status, "success");
  assert.match(html, /자동 해결 실패·미확인 기록은 유형 ‘메일 처리’, 상태 ‘성공’으로 조회/);
  assert.match(html, /<option value="success" selected="">성공<\/option>/);
  assert.doesNotMatch(html, /<option value="(?:partial|auto_solve_failed)"/);
});

test("legacy mail without explicit solve evidence is shown as unconfirmed", () => {
  const legacy = item({ autoSolveStatus: undefined, autoSolveRequested: undefined });
  for (const text of listText(render([legacy]))) assert.match(text, /티켓 생성 · 해결 미확인/);
});

test("persisted solved results remain explicit on both history layouts and in details", () => {
  const recorded = item({ autoSolveRequested: true, autoSolveStatus: "solved", autoSolveEvidence: "recorded", autoSolveRecordedAt: "2026-10-21T01:02:03Z" });
  for (const text of listText(render([recorded]))) assert.match(text, /티켓 생성 · 자동 해결 완료/);
  const details = renderToStaticMarkup(createElement(MailOutcomeDetails, { item: recorded }));
  assert.match(details, /자동 해결 완료가 기록/);
  assert.match(details, /결과 저장 시각:.*10:02:03/);
  assert.match(details, /실제 해결 시각과 다를 수/);
  assert.match(details, /현재 상태와는 다를 수/);
});

test("legacy details preserve uncertainty without inventing a recorded time", () => {
  const legacy = item({ autoSolveRequested: true, autoSolveStatus: "unknown", autoSolveEvidence: "legacy", autoSolveRecordedAt: null });
  const details = renderToStaticMarkup(createElement(MailOutcomeDetails, { item: legacy }));
  assert.match(details, /자동 해결 결과를 확인할 수 없습니다/);
  assert.match(details, /이전 이력.*별도 저장되지/);
  assert.doesNotMatch(details, /자동 해결 완료|결과 저장 시각:/);
});

test("dry-run details record the test result without claiming a real solve", () => {
  const dryRun = item({ status: "dry_run", autoSolveRequested: true, autoSolveStatus: "not_requested", autoSolveEvidence: "recorded", autoSolveRecordedAt: "2026-10-21T01:02:03Z" });
  const details = renderToStaticMarkup(createElement(MailOutcomeDetails, { item: dryRun }));
  assert.match(details, /실제 자동 해결은 실행하지 않았습니다/);
  assert.match(details, /결과 저장 시각:/);
  assert.doesNotMatch(details, /자동 해결 완료/);
});

test("creation failure, dry run and pending retain their own status and do not imply ticket creation", () => {
  for (const [status, label] of [["failed", "실패"], ["dry_run", "테스트"], ["pending", "처리 대기"]]) {
    for (const text of listText(render([item({ status, autoSolveStatus: "failed" })], { status: "all" }))) {
      assert.ok(text.includes(label));
      assert.doesNotMatch(text, /티켓 생성/);
    }
  }
});

test("check and document outcomes are unchanged by mail-specific solve metadata", () => {
  for (const [type, status, label] of [["check", "success", "성공"], ["document", "completed", "완료"], ["document", "failed", "실패"]]) {
    for (const text of listText(render([item({ type, status, autoSolveStatus: "failed" })], { type, status: "all" }))) {
      assert.ok(text.includes(label));
      assert.doesNotMatch(text, /티켓 생성|해결 실패|해결 미확인/);
    }
  }
});

test("history page size choices and applied page offsets remain consistent", () => {
  const html=render([item()],{pageSize:30,pageNumber:2,onPageSizeChange:noop,overview:{summary:null,items:[item()],appliedFilters:{range:"all",type:"mail",status:"success",q:"",limit:30}}});
  assert.match(html.replace(/<[^>]+>/g,""),/31–31건 표시/);
  for(const count of [20,30,50,100])assert.match(html,new RegExp(`value="${count}"`));
  assert.match(html,/value="30" selected=""/);
});

test("download is blocked for empty, stale, loading and failed results", () => {
  const filters={range:"all",type:"mail",status:"success",q:"",limit:20};
  for(const overrides of [{query:"변경한 검색"},{loading:true},{error:"network"},{overview:{summary:null,items:[],appliedFilters:filters}}]){
    const html=render([item()],{overview:{summary:null,items:[item()],appliedFilters:filters},onExport:noop,...overrides});
    const button=html.match(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*XLSX 다운로드<\/button>/)?.[0];
    assert.ok(button); assert.match(button,/disabled=""/);
  }
});

test("download progress, cancel and errors are accessible and do not claim delivery", () => {
  const html=render([item()],{onExport:noop,onCancelExport:noop,exportBusy:true,exportCount:200});
  assert.match(html,/role="status"[^>]*>200건/); assert.match(html,/>취소<\/button>/);
  assert.match(html,/조회 조건 전체/); assert.match(html,/현재 페이지/);
  const failed=render([item()],{onExport:noop,exportError:"기간을 좁혀 주세요"});
  assert.match(failed,/role="alert"[^>]*>기간을 좁혀 주세요/);
});
