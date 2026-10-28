import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import PizZip from "pizzip";

const require = createRequire(import.meta.url);
function load(path) {
  const compiledModule = { exports: {} };
  const output = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function("require", "module", "exports", output)(
    name => name === "@/lib/ticket-send-presentation" ? load("../src/lib/ticket-send-presentation.ts") : require(name),
    compiledModule, compiledModule.exports,
  );
  return compiledModule.exports;
}
const { createHistoryWorkbook, historyWorkbookFilename } = load("../src/lib/history-xlsx.ts");
const date = new Date("2026-10-27T15:02:03.000Z");
const filters = { range: "custom", from: "2026-10-01", to: "2026-10-28", type: "all", status: "all", q: "한글 검색", sort: "newest", asOf: date.toISOString() };
const base = { id: "event-1", type: "check", action: "solution.checkup", status: "success", actorEmail: null, companyName: "합성 고객사", serial: "00123456", title: "정기점검", summary: "정상", targetId: "LO00123456", createdAt: date.toISOString() };
const workbook = (items = [base], options = {}) => new PizZip(createHistoryWorkbook({ items, filters, scope: "page", pageNumber: 2, exportedAt: date, ...options }));
const sheet = (items, options) => workbook(items, options).file("xl/worksheets/sheet1.xml").asText();
function cellText(xml, ref) {
  const value = xml.match(new RegExp(`<c r="${ref}"[^>]*><is><t[^>]*>([\\s\\S]*?)<\\/t><\\/is><\\/c>`))?.[1];
  assert.notEqual(value, undefined, ref);
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

test("XLSX package has self-contained relationships, meaningful sheet name and repeated print headers", () => {
  const zip = workbook();
  const names = Object.keys(zip.files).filter(name => !zip.files[name].dir);
  assert.deepEqual(names.sort(), ["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"].sort());
  assert.match(zip.file("xl/workbook.xml").asText(), /name="작업 이력"/);
  assert.match(zip.file("xl/workbook.xml").asText(), /'작업 이력'!\$6:\$7/);
  assert.match(zip.file("[Content_Types].xml").asText(), /spreadsheetml\.sheet\.main\+xml/);
  for (const name of names) assert.doesNotMatch(zip.file(name).asText(), /TargetMode="External"|<hyperlink|<f[ >]/);
});

test("workbook has freeze panes, filtering, column widths, zebra fills and cell borders", () => {
  const zip = workbook([base, { ...base, id: "event-2" }]);
  const xml = zip.file("xl/worksheets/sheet1.xml").asText();
  assert.match(xml, /xSplit="2" ySplit="7" topLeftCell="C8"/);
  assert.match(xml, /<autoFilter ref="A7:M9"\/>/);
  assert.equal((xml.match(/<col /g) ?? []).length, 13);
  assert.match(xml, /<c r="A8" s="0"/);
  assert.match(xml, /<c r="A9" s="5"/);
  assert.match(xml, /orientation="landscape"/);
  const styles = zip.file("xl/styles.xml").asText();
  assert.match(styles, /<left style="thin">/);
  assert.match(styles, /<right style="thin">/);
  assert.match(styles, /<alignment vertical="top" wrapText="1"\/>/);
  assert.match(styles, /FF162C3E/);
  assert.match(styles, /FF087E8B/);
});

test("export metadata uses applied filters and KST rather than the host date or pending UI values", () => {
  const xml = sheet();
  assert.match(cellText(xml, "A2"), /현재 페이지 \(2페이지\) · 1건/);
  assert.match(cellText(xml, "A3"), /2026-10-01 ~ 2026-10-28/);
  assert.match(cellText(xml, "H4"), /한글 검색/);
  assert.equal(cellText(xml, "A8"), "2026-10-28 00:02:03");
  assert.match(cellText(xml, "H2"), /2026-10-28 00:02:03 KST/);
  assert.equal(historyWorkbookFilename(date), "작업이력_20261028_000203_KST.xlsx");
  assert.match(cellText(sheet([base], { scope: "filtered" }), "A2"), /조회 조건 전체 · 1건/);
  assert.equal(cellText(xml, "D8"), "00123456");
  assert.match(xml, /<c r="D8"[^>]*t="inlineStr"/);
});

test("formulas, URLs, XML metacharacters and OOXML escape-looking values remain literal text", () => {
  for (const title of ['=HYPERLINK("https://example.invalid", "click")', "+SUM(1,2)", "-2+3", "@SUM(1,2)", "https://example.invalid/path", '<xml> & "quoted" 한글']) {
    const xml = sheet([{ ...base, title }]);
    assert.equal(cellText(xml, "E8"), title);
    assert.doesNotMatch(xml, /<f[ >]|<hyperlink/);
  }
  assert.equal(cellText(sheet([{ ...base, title: "_x000D_ _x0041_" }]), "E8"), "_x005F_x000D_ _x005F_x0041_");
});

test("invalid XML characters and unpaired surrogates are removed while tabs, newline and emoji survive", () => {
  const xml = sheet([{ ...base, title: "가\0\u0001\u000b\ud800\u0001\udfff\ufffe\uffff나\t\n🙂" }]);
  assert.equal(cellText(xml, "E8"), "가나\t\n🙂");
});

test("Excel cell limit truncates visibly and never splits a surrogate pair", () => {
  const xml = sheet([{ ...base, summary: "🙂".repeat(20000) }]);
  const value = cellText(xml, "G8");
  assert.ok(value.length <= 32767);
  assert.match(value, /\[Excel 셀 길이 제한으로 이후 내용 생략\]$/);
  assert.doesNotMatch(value, /[\ud800-\udbff](?![\udc00-\udfff])/u);
});

test("requested CC distinguishes unrecorded history, explicit empty CC and recorded addresses", () => {
  const xml = sheet([
    { ...base, type: "mail", ccEmails: null, ccEvidence: "legacy" },
    { ...base, type: "mail", ccEmails: [], ccEvidence: "recorded" },
    { ...base, type: "mail", ccEmails: ["first@example.invalid", "second@example.invalid"], ccEvidence: "recorded" },
    base,
  ]);
  assert.equal(cellText(xml, "H8"), "CC 기록 없음 (이전 이력)");
  assert.equal(cellText(xml, "H9"), "참조 없음");
  assert.equal(cellText(xml, "H10"), "요청 CC: first@example.invalid, second@example.invalid");
  assert.equal(cellText(xml, "H11"), "해당 없음");
});

test("mail success means ticket creation, with saved solve results and uncertainty kept separate", () => {
  const xml = sheet([
    { ...base, type: "mail", autoSolveStatus: "solved", autoSolveRequested: true, autoSolveEvidence: "recorded", autoSolveRecordedAt: date.toISOString() },
    { ...base, type: "mail", autoSolveStatus: "failed", autoSolveError: "권한 부족", autoSolveEvidence: "recorded" },
    { ...base, type: "mail", autoSolveRequested: true, autoSolveEvidence: "legacy" },
    { ...base, type: "mail", autoSolveRequested: false, autoSolveStatus: "not_requested" },
  ]);
  assert.equal(cellText(xml, "F8"), "티켓 생성");
  assert.match(cellText(xml, "I8"), /자동 해결 완료/);
  assert.match(cellText(xml, "I8"), /Zendesk의 실제 해결 시각과 다를 수/);
  assert.match(cellText(xml, "I9"), /자동 해결 실패/);
  assert.equal(cellText(xml, "J9"), "권한 부족");
  assert.match(cellText(xml, "I10"), /자동 해결 미확인/);
  assert.match(cellText(xml, "I10"), /이전 이력에는 자동 해결 결과가 별도 저장되지/);
  assert.equal(cellText(xml, "I11"), "자동 해결 미요청");
  assert.match(cellText(xml, "A5"), /수신 완료 증거가 아닙니다/);
});

test("dry-run requested solve never appears as a real solve completion", () => {
  const xml = sheet([{ ...base, type: "mail", status: "dry_run", autoSolveRequested: true, autoSolveStatus: "solved" }]);
  assert.equal(cellText(xml, "F8"), "테스트");
  assert.equal(cellText(xml, "I8"), "테스트 · 실제 해결 미실행 (요청 기록 있음)");
});

test("empty results are explicit, malformed dates stay unknown, excessive export is rejected", () => {
  const xml = sheet([]);
  assert.match(xml, /dimension ref="A1:M8"/);
  assert.match(xml, /<autoFilter ref="A7:M7"/);
  assert.equal(cellText(xml, "A8"), "조회 조건에 해당하는 이력이 없습니다.");
  assert.equal(cellText(sheet([{ ...base, createdAt: "invalid" }]), "A8"), "시각 확인 불가");
  assert.throws(() => workbook(Array(5001).fill(base)), /최대 5,000건/);
});
