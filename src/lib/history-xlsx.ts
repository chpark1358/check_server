import PizZip from "pizzip";
import type { HistoryAppliedFilters, HistoryItem } from "@/components/history-panel";
import { formatAutoSolveLabel, formatAutoSolveRecord, formatCcRecipients } from "@/lib/ticket-send-presentation";

export type HistoryWorkbookOptions = {
  items: HistoryItem[];
  filters: HistoryAppliedFilters;
  scope: "page" | "filtered";
  pageNumber?: number;
  exportedAt?: Date;
};

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const typeNames: Record<string, string> = { all: "모든 작업", check: "점검 조회", document: "문서 생성", mail: "메일 처리" };
const statusNames: Record<string, string> = { all: "모든 상태", success: "성공", failed: "실패", dry_run: "테스트", pending: "처리 대기", completed: "완료" };
const rangeNames: Record<string, string> = { today: "오늘", "7d": "최근 7일", "30d": "최근 30일", "90d": "최근 90일", "365d": "최근 1년", all: "전체 기간", custom: "기간 지정" };
const columns = [
  ["처리 시각 (KST)", 23], ["작업 유형", 14], ["고객사", 24], ["시리얼", 18], ["작업 제목", 32],
  ["처리 상태", 22], ["처리 요약", 44], ["요청 CC", 38], ["자동 해결 결과", 36], ["자동 해결 오류", 36],
  ["작업자", 27], ["대상 / 티켓 ID", 23], ["이벤트 ID", 39],
] as const;

// Text is always an inline string, never a formula or external link. XML 1.0
// excludes control characters and unpaired surrogates; Excel limits cell text.
function cleanText(value: unknown): string {
  let result = "";
  for (const character of String(value ?? "")) {
    const code = character.codePointAt(0)!;
    if (code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xd7ff) ||
        (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff)) result += character;
  }
  const note = "\n[Excel 셀 길이 제한으로 이후 내용 생략]";
  if (result.length > 32767) {
    result = result.slice(0, 32767 - note.length);
    const finalCode = result.charCodeAt(result.length - 1);
    if (finalCode >= 0xd800 && finalCode <= 0xdbff) result = result.slice(0, -1);
    result += note;
  }
  return result;
}

function escapeXml(value: string) {
  return value.replace(/_([xX][0-9a-fA-F]{4}_)/g, "_x005F_$1").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function cell(reference: string, value: unknown, style = 0) {
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cleanText(value))}</t></is></c>`;
}

function row(number: number, cells: string[], height?: number) {
  return `<row r="${number}"${height ? ` ht="${height}" customHeight="1"` : ""}>${cells.join("")}</row>`;
}

function dateLabel(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) return "시각 확인 불가";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

export function historyWorkbookFilename(date = new Date()) {
  const stamp = dateLabel(date).replace(/[-:]/g, "").replace(" ", "_");
  return `작업이력_${stamp === "시각 확인 불가" ? "내보내기" : stamp}_KST.xlsx`;
}

function valuesFor(item: HistoryItem): string[] {
  const mail = item.type === "mail";
  const status = mail && item.status === "success" ? "티켓 생성" : (statusNames[item.status] ?? item.status);
  const solveResult = !mail ? "해당 없음" : item.status === "dry_run"
    ? `테스트 · 실제 해결 미실행${item.autoSolveRequested ? " (요청 기록 있음)" : ""}`
    : [formatAutoSolveLabel(item), formatAutoSolveRecord(item)].filter(Boolean).join("\n");
  return [
    dateLabel(item.createdAt), typeNames[item.type] ?? item.type, item.companyName || "기록 없음", item.serial || "기록 없음",
    item.title, status, item.summary || "추가 내용 없음", mail ? formatCcRecipients(item) : "해당 없음",
    solveResult, mail ? (item.autoSolveError || "없음") : "해당 없음", item.actorEmail || "기록 없음",
    item.targetId || "기록 없음", item.id,
  ];
}

const styles = XML + `<styleSheet xmlns="${MAIN_NS}">
  <fonts count="6">
    <font><sz val="11"/><color rgb="FF243445"/><name val="맑은 고딕"/><family val="2"/></font>
    <font><b/><sz val="20"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font>
    <font><sz val="10"/><color rgb="FF52667A"/><name val="맑은 고딕"/></font>
    <font><b/><sz val="11"/><color rgb="FF087E8B"/><name val="맑은 고딕"/></font>
    <font><b/><sz val="11"/><color rgb="FFB42318"/><name val="맑은 고딕"/></font>
  </fonts>
  <fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF162C3E"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF087E8B"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F6F8"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD7E2E9"/></left><right style="thin"><color rgb="FFD7E2E9"/></right><top style="thin"><color rgb="FFD7E2E9"/></top><bottom style="thin"><color rgb="FFD7E2E9"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="12">
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" indent="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;

export function createHistoryWorkbook({ items, filters, scope, pageNumber = 1, exportedAt = new Date() }: HistoryWorkbookOptions): Uint8Array {
  if (items.length > 5000) throw new Error("XLSX는 한 번에 최대 5,000건까지 내보낼 수 있습니다. 조회 기간을 줄여 주세요.");
  const lastRow = Math.max(8, 7 + items.length);
  const exportScope = scope === "page" ? `현재 페이지 (${pageNumber}페이지)` : "조회 조건 전체";
  const period = filters.from && filters.to ? `${filters.from} ~ ${filters.to} (양 끝 날짜 포함)` : (rangeNames[filters.range] ?? filters.range);
  const rows = [
    row(1, Array.from({ length: 13 }, (_, i) => cell(`${String.fromCharCode(65 + i)}1`, i ? "" : "작업 이력", 1)), 40),
    row(2, [cell("A2", `내보내기: ${exportScope} · ${items.length.toLocaleString("ko-KR")}건`, 2), cell("H2", `내보낸 시각: ${dateLabel(exportedAt)} KST`, 2)], 25),
    row(3, [cell("A3", `조회 기간: ${period}`, 2), cell("H3", `조회 기준: ${filters.asOf ? dateLabel(filters.asOf) + " KST" : "기록 없음"}`, 2)], 25),
    row(4, [cell("A4", `유형: ${typeNames[filters.type] ?? filters.type} · 상태: ${statusNames[filters.status] ?? filters.status} · 정렬: ${filters.sort === "oldest" ? "과거순" : "최신순"}`, 2), cell("H4", `검색어: ${filters.q || "없음"}`, 2)], 30),
    row(5, [cell("A5", "메일 성공은 티켓 생성을 뜻하며 수신 완료 증거가 아닙니다. CC는 발송 요청 시점의 기록이고, 자동 해결은 저장 당시 결과입니다. 시각은 한국 표준시(KST)입니다.", 2)], 28),
    row(6, Array.from({ length: 13 }, (_, i) => cell(`${String.fromCharCode(65 + i)}6`, ({ 0: "처리 정보", 2: "고객 · 작업", 5: "처리 결과", 10: "추적 정보" } as Record<number, string>)[i] ?? "", 3)), 23),
    row(7, columns.map(([label], i) => cell(`${String.fromCharCode(65 + i)}7`, label, 4)), 30),
  ];
  items.forEach((item, index) => {
    const values = valuesFor(item);
    const alternate = index % 2 === 1;
    const cells = values.map((value, column) => {
      let style = alternate ? 5 : 0;
      if (column === 5) style = item.status === "failed" ? (alternate ? 9 : 8) : (alternate ? 7 : 6);
      if (column >= 10) style = alternate ? 10 : 11;
      return cell(`${String.fromCharCode(65 + column)}${index + 8}`, value, style);
    });
    const lines = Math.max(...values.map((value, column) => value.split("\n").reduce((count, part) => count + Math.max(1, Math.ceil(Array.from(part).length / Math.max(8, columns[column][1] / 1.8))), 0)));
    rows.push(row(index + 8, cells, Math.min(180, Math.max(36, lines * 16 + 8))));
  });
  if (!items.length) rows.push(row(8, columns.map((_, i) => cell(`${String.fromCharCode(65 + i)}8`, i ? "" : "조회 조건에 해당하는 이력이 없습니다.", 0)), 36));
  const merges = ["A1:M1", "A2:G2", "H2:M2", "A3:G3", "H3:M3", "A4:G4", "H4:M4", "A5:M5", "A6:B6", "C6:E6", "F6:J6", "K6:M6"];
  if (!items.length) merges.push("A8:M8");
  const sheet = XML + `<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">
    <sheetPr><tabColor rgb="FF087E8B"/><pageSetUpPr fitToPage="1"/></sheetPr>
    <dimension ref="A1:M${lastRow}"/>
    <sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane xSplit="2" ySplit="7" topLeftCell="C8" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="C8" sqref="C8"/></sheetView></sheetViews>
    <sheetFormatPr defaultRowHeight="18"/>
    <cols>${columns.map(([, width], i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join("")}</cols>
    <sheetData>${rows.join("")}</sheetData>
    <autoFilter ref="A7:M${items.length ? lastRow : 7}"/>
    <mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>
    <printOptions horizontalCentered="1"/>
    <pageMargins left="0.3" right="0.3" top="0.45" bottom="0.45" header="0.2" footer="0.2"/>
    <pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
    <headerFooter><oddFooter>&amp;L작업 이력 · KST&amp;R&amp;P / &amp;N</oddFooter></headerFooter>
  </worksheet>`;
  const zip = new PizZip();
  zip.file("[Content_Types].xml", XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
  zip.file("_rels/.rels", XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + REL_NS + '/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file("xl/workbook.xml", XML + `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><bookViews><workbookView/></bookViews><sheets><sheet name="작업 이력" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'작업 이력'!$6:$7</definedName><definedName name="_xlnm.Print_Area" localSheetId="0">'작업 이력'!$A$1:$M$${lastRow}</definedName></definedNames></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + REL_NS + '/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="' + REL_NS + '/styles" Target="styles.xml"/></Relationships>');
  zip.file("xl/styles.xml", styles);
  zip.file("xl/worksheets/sheet1.xml", sheet);
  return zip.generate({ type: "uint8array", compression: "DEFLATE" });
}
