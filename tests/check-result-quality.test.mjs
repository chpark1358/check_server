import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import path from "node:path";

const require = createRequire(import.meta.url);
const ts = require("typescript"), PizZip = require("pizzip"), Docxtemplater = require("docxtemplater");
const isRecord = value => Boolean(value && typeof value === "object" && !Array.isArray(value));
class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
function loadTs(file, imports = {}, append = "") {
  const source = readFileSync(new URL(file, import.meta.url), "utf8") + append;
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText, {
    exports, Buffer, Date, process, console: { error() {} },
    require(name) { assert.ok(Object.hasOwn(imports, name), `Unexpected dependency ${name}`); return imports[name]; },
  });
  return exports;
}
const q = loadTs("../src/lib/check-result-quality.ts");
const model = loadTs("../src/lib/server-model.ts");
const normalize = loadTs("../src/lib/server/check-result.ts", {
  "server-only": {}, "@/lib/server/api": { isRecord }, "@/lib/server-model": model, "@/lib/check-result-quality": q,
}).normalizeCheckResult;
const report = loadTs("../src/app/api/documents/check-report/route.ts", {
  docxtemplater: Docxtemplater, pizzip: PizZip, "node:fs": { readFileSync, existsSync }, "node:path": path,
  "@/lib/server/api": { ApiError, isRecord }, "@/lib/server/audit": {}, "@/lib/server/rate-limit": {},
  "@/lib/server/document-converter": {}, "@/lib/server/document-storage": {},
  "@/lib/server/engineer-signatures": { loadEngineerSignatureBuffer: async () => null },
  "@/lib/server-model": model, "@/lib/engineer-roster": { isRetiredEngineerName: () => false },
  "@/lib/server/check-result": { normalizeCheckResult: normalize }, "@/lib/check-result-quality": q,
}, "\nexport const testOnly = { buildReportContext, buildTemplateData, buildDocx, buildResultCheckMap, applyChecksToTable }; ").testOnly;

const base = () => ({ serial: "LO1001", companyName: "검증 고객사", cpuUsage: 0 });
const body = (raw = base(), manual = {}) => ({ checkResult: normalize(raw), manual });
const text = xml => Array.from(xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g), match => match[1]).join("");
function rowCells(xml, label) {
  const row = Array.from(xml.matchAll(/<w:tr(?:\s|>)[\s\S]*?<\/w:tr>/g), match => match[0]).find(row => text(row).includes(label));
  assert.ok(row, `No row for ${label}`);
  return Array.from(row.matchAll(/<w:tc(?:\s|>)[\s\S]*?<\/w:tc>/g), match => text(match[0]));
}

test("partial results identify absent and invalid fields without losing actual zero or false", () => {
  const raw = { ...base(), memoryUsage: "", totalMemorySize: "NaN", loadAvg1Min: "0.00", agentStatus: false,
    webConnectionStatus: "maybe", rootDirectoryUsage: "0%", homeDirectoryUsage: "101%", useLicence: 0, totalLicence: "1,000" };
  const result = normalize(raw);
  assert.equal(result.system.cpuUsagePercent, 0);
  assert.equal(result.system.load1, 0);
  assert.equal(result.flags.agent, false);
  assert.equal(result.license.total, 1000);
  for (const key of ["system.cpuUsagePercent", "system.load1", "flags.agent", "license.used", "disks.root.usedPercent"]) assert.equal(q.checkFieldIssue(result, key), null, key);
  assert.equal(q.checkFieldIssue(result, "system.memUsagePercent"), "missing");
  for (const key of ["system.memTotalGb", "flags.web", "disks.home.usedPercent"]) assert.equal(q.checkFieldIssue(result, key), "invalid", key);
  assert.equal(result.raw, raw, "raw measurements must remain untouched");
});

test("garbage numeric strings, nonfinite values, negatives and impossible percentages are invalid", () => {
  for (const value of ["bad12", "12 apples", "1.2.3", "--1", "Infinity", "NaN", Infinity, -1, 101, {}, true]) {
    assert.equal(q.checkFieldIssue(normalize({ ...base(), cpuUsage: value }), "system.cpuUsagePercent"), "invalid", String(value));
  }
  for (const value of [undefined, null, "", "  ", "-", "N/A"]) {
    assert.equal(q.checkFieldIssue(normalize({ ...base(), cpuUsage: value }), "system.cpuUsagePercent"), "missing", String(value));
  }
  for (const value of [0, "0", "0.0%", "12.5%", "100%"])
    assert.equal(q.checkFieldIssue(normalize({ ...base(), cpuUsage: value }), "system.cpuUsagePercent"), null, String(value));
});

test("SMTP and firewall exceptions require collected evidence and unknown strings are not false measurements", () => {
  const empty = normalize(base());
  assert.equal(q.checkFieldIssue(empty, "flags.mail"), "missing");
  assert.equal(q.checkFieldIssue(empty, "flags.firewall"), "missing");
  for (const logData of [{ checkMailServer: "N", isFirewallActive: "file not found" }, JSON.stringify({ checkMailServer: "N", isFirewallActive: "inactive" })]) {
    const result = normalize({ ...base(), logData });
    assert.equal(result.flags.mail, true);
    assert.equal(result.flags.firewall, true);
    assert.equal(q.checkFieldIssue(result, "flags.mail"), null);
    assert.equal(q.checkFieldIssue(result, "flags.firewall"), null);
  }
  const explicit = normalize({ ...base(), mailServerStatus: false, firewallStatus: false });
  assert.equal(explicit.flags.mail, false);
  assert.equal(explicit.flags.firewall, false);
  assert.equal(q.checkFieldIssue(explicit, "flags.mail"), null);
  const error = normalize({ ...base(), mailServerStatus: "Y", logData: { checkMailServer: "connection failed" } });
  assert.equal(error.flags.mail, false);
  assert.equal(q.checkFieldIssue(error, "flags.mail"), null);
  const firewall = normalize({ ...base(), logData: { isFirewallActive: "active" } });
  assert.equal(firewall.flags.firewall, true);
  assert.equal(q.checkFieldIssue(firewall, "flags.firewall"), null);
  assert.equal(q.checkFieldIssue(normalize({ ...base(), agentStatus: "unreadable" }), "flags.agent"), "invalid");
});

test("formatted disks retain explicit zero and expose absent component values", () => {
  const result = normalize({ ...base(), root_disk_formatted: "0G / 0.5% (Total : 100G)", homeDirectoryUsage: 0 });
  assert.equal(result.disks.root.usedPercent, 0.5);
  assert.equal(q.checkFieldIssue(result, "disks.root.size"), null);
  assert.equal(q.checkFieldIssue(result, "disks.root.used"), null);
  assert.equal(q.checkFieldIssue(result, "disks.home.usedPercent"), null);
  assert.equal(q.checkFieldIssue(result, "disks.home.size"), "missing");
});

test("cached results without quality recompute raw availability instead of trusting fallback zeros", () => {
  const result = normalize(base());
  delete result.quality;
  assert.equal(q.checkFieldIssue(result, "system.cpuUsagePercent"), null);
  assert.equal(q.checkFieldIssue(result, "system.memUsagePercent"), "missing");
  assert.equal(q.checkFieldIssue(result, "flags.httpd"), "missing");
});

test("report context recomputes availability from raw, ignores forged known metadata and normalized values", () => {
  const input = body({ ...base(), memoryUsage: "broken" });
  input.checkResult.quality = { version: 1, missingFields: [], invalidFields: [] };
  input.checkResult.system.memUsagePercent = 0;
  input.checkResult.flags.httpd = true;
  const context = report.buildReportContext(input);
  assert.equal(context.cpuUsage, "0.0%");
  assert.equal(context.memTotalText, "미수집");
  assert.equal(context.memActualText, "확인불가");
  assert.equal(context.flags.httpd, null);
  assert.match(context.licenseSummary, /미수집/);
  assert.equal(context.checkDate, "미수집");
  const template = report.buildTemplateData(context, false);
  assert.match(template.httpd_status, /미수집.*원본 상태값 없음/);
  const map = report.buildResultCheckMap(context);
  assert.equal(map["CPU 점유율 확인"], true);
  assert.equal(map["Memory 사용량 확인"], null);
  assert.equal(map["Httpd 서비스 구동 확인"], null);
});

test("normalized-only or mismatching source identity is rejected before document rendering", () => {
  for (const input of [{ checkResult: { serial: "LO1001", system: { cpuUsagePercent: 0 } } },
    { checkResult: { ...normalize(base()), serial: "LO1002" } }, { checkResult: { ...normalize(base()), raw: {} } }]) {
    assert.throws(() => report.buildReportContext(input), error => error.code === "CHECK_REPORT_SOURCE_INVALID");
  }
});

test("actual DOCX displays partial missing data and puts no check mark in either column for unknowns", async () => {
  const context = report.buildReportContext(body({ ...base(), agentStatus: false, webConnectionStatus: "Y", memoryUsage: "invalid" }));
  const docx = await report.buildDocx(context, {});
  const xml = new PizZip(docx).file("word/document.xml").asText();
  assert.match(text(xml), /미수집/);
  assert.match(text(xml), /확인불가/);
  for (const label of ["Httpd 서비스 구동 확인", "Memory 사용량 확인", "디스크 사용량 확인"]) {
    const cells = rowCells(xml, label);
    assert.ok(!cells.join("").includes("✓"), `${label} unknown must not be marked normal or abnormal`);
  }
  assert.ok(rowCells(xml, "CPU 점유율 확인").join("").includes("✓"));
  const agent = rowCells(xml, "에이전트 통신 확인");
  assert.equal(agent[2], "", "known false must not be marked in normal column");
  assert.equal(agent[3], "✓", "known false belongs in abnormal column");
});

test("manual overrides are explicit, annotated, and can mark unknown service without modifying collected data", async () => {
  const raw = base();
  const input = body(raw, { flagOverrides: { httpd: true, mysqld: false } });
  const context = report.buildReportContext(input);
  assert.equal(context.flags.httpd, true);
  assert.equal(context.flags.mysqld, false);
  assert.equal(context.raw, raw);
  assert.equal(context.quality.missingFields.includes("flags.httpd"), true);
  assert.match(report.buildTemplateData(context, false).httpd_status, /수동 확인/);
  const xml = new PizZip(await report.buildDocx(context, {})).file("word/document.xml").asText();
  const httpd = rowCells(xml, "Httpd 서비스 구동 확인");
  assert.equal(httpd.filter(cell => cell === "✓").length, 1);
  assert.equal(httpd[2], "✓");
  assert.equal(httpd[3], "");
  const mysql = rowCells(xml, "MySQL 서비스 구동 확인");
  assert.equal(mysql.filter(cell => cell === "✓").length, 1);
  assert.equal(mysql[2], "");
  assert.equal(mysql[3], "✓");
  assert.throws(() => report.buildReportContext(body(raw, { flagOverrides: { httpd: "true" } })), error => error.code === "CHECK_REPORT_OVERRIDE_INVALID");
});

test("check mark rewrite clears both old template marks for unknown and checks only actual false column", () => {
  const cell = value => `<w:tc><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:tc>`;
  const table = `<w:tbl><w:tr>${["항목", "정상", "비정상"].map(cell).join("")}</w:tr><w:tr>${["HTTP", "✓", "✓"].map(cell).join("")}</w:tr></w:tbl>`;
  assert.deepEqual(rowCells(report.applyChecksToTable(table, { HTTP: null }), "HTTP"), ["HTTP", "", ""]);
  assert.deepEqual(rowCells(report.applyChecksToTable(table, { HTTP: false }), "HTTP"), ["HTTP", "", "✓"]);
});

test("zero CPU and load are not inflated in document text", () => {
  const context = report.buildReportContext(body({ ...base(), loadAvg1Min: 0, loadAvg5Min: "0", loadAvg15Min: 0, monthlyReportStatus: false, logData: { monthlyReportStatus: true } }));
  assert.equal(context.cpuUsage, "0.0%");
  assert.equal(context.loadSummary, "0.00 / 0.00 / 0.00");
  assert.equal(context.flags.monthlyReport, false, "explicit false takes priority over log fallback");
});

test("actual DOCX CPU cell includes one percent unit for collected values and preserves unknown labels", async () => {
  for (const [value, expected] of [
    [0, "0.0%"], [4, "4.0%"], [12.5, "12.5%"], ["4.0%", "4.0%"], ["100%", "100.0%"],
    [undefined, "미수집"], [null, "미수집"], ["", "미수집"], ["N/A", "미수집"],
    ["broken", "확인불가"], [101, "확인불가"], [-1, "확인불가"],
  ]) {
    const context = report.buildReportContext(body({ ...base(), cpuUsage: value }));
    assert.equal(context.cpuUsage, expected, `context for ${String(value)}`);
    const xml = new PizZip(await report.buildDocx(context, {})).file("word/document.xml").asText();
    const cells = rowCells(xml, "CPU 점유율 확인");
    assert.equal(cells.at(-1), expected, `DOCX CPU cell for ${String(value)}`);
    assert.equal(cells.join("").includes("✓"), expected.endsWith("%"), "unknown CPU must not receive a result check mark");
  }
});
