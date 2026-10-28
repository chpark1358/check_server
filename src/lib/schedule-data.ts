import type { ScheduleCategory, ScheduleFilters, ScheduleItem } from "@/lib/schedule-types";

export class ScheduleDataError extends Error {}
const DAY = 86_400_000;
const value = (cell: unknown) => typeof cell === "string" || typeof cell === "number" ? String(cell).trim() : "";
const header = (cell: unknown) => value(cell).replace(/[\s'"“”‘’]/g, "");

export function scheduleDate(raw: string): string | null {
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\.?$/.exec(raw.trim());
  if (!match) return null;
  const normalized = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const timestamp = Date.parse(normalized + "T00:00:00Z");
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === normalized && match[1] >= "1970" ? normalized : null;
}

export function parseScheduleQuery(params: URLSearchParams, now = new Date()): ScheduleFilters {
  const range = params.get("range") ?? "30d";
  const category = params.get("category") ?? "review";
  if (!["7d", "30d", "all", "custom"].includes(range) || !["review", "hold", "partner", "completed", "all"].includes(category)) {
    throw new ScheduleDataError("예정 시기와 기록 분류를 확인해 주세요.");
  }
  const q = (params.get("q") ?? "").trim();
  if (q.length > 200) throw new ScheduleDataError("검색어는 200자 이내로 입력하세요.");
  const page = Number(params.get("page") ?? 1), pageSize = Number(params.get("pageSize") ?? 30);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new ScheduleDataError("페이지와 표시 개수를 확인해 주세요. 한 페이지는 최대 100건입니다.");
  }
  let from = "", to = "";
  if (range === "custom") {
    from = scheduleDate(params.get("from") ?? "") ?? "";
    to = scheduleDate(params.get("to") ?? "") ?? "";
    if (!from || !to || from > to) throw new ScheduleDataError("유효한 시작일과 종료일을 입력하세요. 종료일은 시작일보다 빠를 수 없습니다.");
  } else if (range !== "all") {
    from = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
    to = new Date(Date.parse(from + "T00:00:00Z") + (range === "7d" ? 6 : 29) * DAY).toISOString().slice(0, 10);
  }
  return { range: range as ScheduleFilters["range"], category: category as ScheduleFilters["category"], q, page, pageSize, from, to };
}

// Deterministic display identity, independent of row order. This is not an execution/idempotency key.
function rowHash(text: string) {
  let hash = BigInt("14695981039346656037");
  for (const char of text) hash = BigInt.asUintN(64, (hash ^ BigInt(char.codePointAt(0)!)) * BigInt("1099511628211"));
  return hash.toString(16).padStart(16, "0");
}

export function parseScheduleRows(rows: unknown[][]): ScheduleItem[] {
  const expected: Record<number, string> = {2:"시리얼번호",3:"고객사명",6:"유지보수계약시작일",7:"유지보수계약만료일",8:"특이사항",10:"점검예정시기",11:"점검회차",12:"완료여부",13:"점검일자",14:"점검주체",16:"비고"};
  if (rows.length < 4 || Object.entries(expected).some(([column, name]) => header(rows[3]?.[Number(column)]) !== name)) {
    throw new ScheduleDataError("원본 시트의 열 구조가 달라 일정을 읽지 못했습니다. 관리자에게 열 매핑 확인을 요청해 주세요.");
  }
  const ids = new Map<string, number>();
  const items: ScheduleItem[] = [];
  for (let index = 4; index < rows.length; index++) {
    const row = rows[index];
    if (!Array.isArray(row)) throw new ScheduleDataError("원본 시트의 행 형식을 확인할 수 없습니다.");
    if (![2,3,6,7,10,11,12,13,14].some(column => value(row[column]))) continue;
    const serialRaw = value(row[2]), canonical = serialRaw.toUpperCase();
    const serial = /^(?:LO)?\d{8}$/.test(canonical) ? (canonical.startsWith("LO") ? canonical : "LO" + canonical) : null;
    const plannedDateRaw = value(row[10]), plannedDate = scheduleDate(plannedDateRaw);
    const completionRaw = value(row[12]), executorRaw = value(row[14]);
    const category: ScheduleCategory = executorRaw === "고은" ? "partner" : /^[xX]$/.test(completionRaw) ? "hold" : /^[oO]$/.test(completionRaw) ? "completed" : "review";
    const issues: string[] = [];
    if (!serial) issues.push("시리얼 형식 확인");
    if (!plannedDate) issues.push("예정 시기 확인");
    if (completionRaw && !/^[oOxX]$/.test(completionRaw)) issues.push("완료 표기 확인");
    if (!value(row[11])) issues.push("점검 회차 확인");
    if (/^[oO]$/.test(completionRaw) && !value(row[13])) issues.push("완료 표기와 실제 점검일 확인");
    if (value(row[6]) && !scheduleDate(value(row[6]))) issues.push("계약 시작일 확인");
    if (value(row[7]) && !scheduleDate(value(row[7]))) issues.push("계약 만료일 확인");
    if (executorRaw && !["지란", "고은"].includes(executorRaw)) issues.push("수행 주체 표기 확인");
    const identity = rowHash(JSON.stringify([2,3,6,7,8,10,11,12,13,14,16].map(column => value(row[column]))));
    const duplicateOrdinal = ids.get(identity) ?? 0;
    ids.set(identity, duplicateOrdinal + 1);
    items.push({id: `schedule-${identity}-${duplicateOrdinal}`, sourceRow:index+1, companyName:value(row[3]), serialRaw, serial,
      plannedDateRaw, plannedDate, round:value(row[11]), completionRaw, completedDateRaw:value(row[13]), executorRaw,
      contractStartRaw:value(row[6]), contractEndRaw:value(row[7]), notes:[value(row[8]),value(row[16])].filter(Boolean).join("\n"), category, issues});
  }
  const occurrences = new Map<string, ScheduleItem[]>();
  for (const item of items) {
    if (!item.serial || !item.round) continue;
    const key = JSON.stringify([item.serial,item.contractStartRaw,item.contractEndRaw,item.round]);
    const group = occurrences.get(key) ?? []; group.push(item); occurrences.set(key,group);
  }
  for (const group of occurrences.values()) if (group.length > 1) for (const item of group) item.issues.push("동일 회차 후보 확인");
  return items;
}

export function filterScheduleItems(items: ScheduleItem[], filters: ScheduleFilters) {
  const q = filters.q.toLocaleLowerCase("ko-KR");
  const scoped = items.filter(item =>
    (!filters.from || Boolean(item.plannedDate && item.plannedDate >= filters.from && item.plannedDate <= filters.to)) &&
    (!q || `${item.companyName} ${item.serialRaw} ${item.serial ?? ""}`.toLocaleLowerCase("ko-KR").includes(q)));
  const counts = {review:0,hold:0,partner:0,completed:0,issues:0};
  for (const item of scoped) { counts[item.category]++; if (item.issues.length) counts.issues++; }
  const matching = scoped.filter(item => filters.category === "all" || item.category === filters.category)
    .sort((a,b)=>(a.plannedDate ?? "9999-99-99").localeCompare(b.plannedDate ?? "9999-99-99") || a.id.localeCompare(b.id));
  const page = Math.min(filters.page, Math.max(1, Math.ceil(matching.length / filters.pageSize)));
  return {items:matching.slice((page-1)*filters.pageSize,page*filters.pageSize), total:matching.length, counts, filters:{...filters,page}};
}
