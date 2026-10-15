import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const historyTypes = ["check", "document", "mail"] as const;
export type HistoryType = (typeof historyTypes)[number];
export type HistorySort = "newest" | "oldest";
export type HistoryRange = "today" | "7d" | "30d" | "90d" | "365d" | "all" | "custom";
export type HistoryStatus = "all" | "success" | "failed" | "dry_run" | "pending";

export class HistoryQueryError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export type HistoryPosition = { createdAt: string; type: HistoryType; id: string };
export type HistoryFilters = {
  range: HistoryRange;
  from: string | null;
  to: string | null;
  type: HistoryType | "all";
  status: HistoryStatus;
  q: string;
  sort: HistorySort;
  limit: number;
  timezone: "Asia/Seoul";
  asOf: string;
};
type CursorPayload = {
  version: 1;
  fingerprint: string;
  asOf: string;
  position: HistoryPosition;
};
export type HistoryQuery = {
  filters: HistoryFilters;
  fromInclusive: string | null;
  toExclusive: string | null;
  includeSummary: boolean;
  fingerprint: string;
  cursor: HistoryPosition | null;
};
const DAY_MS = 86_400_000;
const KST_OFFSET = 9 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const typeRank: Record<HistoryType, number> = { check: 0, document: 1, mail: 2 };
const searchColumns: Record<HistoryType, string[]> = {
  check: ["target_id", "serial", "company_name", "search_text"],
  mail: ["zendesk_ticket_id", "organization_id", "requester_email", "subject", "error_summary"],
  document: ["company_name", "serial", "engineer_name", "pdf_error_summary"],
};

function invalid(code: string, message: string): never {
  throw new HistoryQueryError(code, message);
}

function enumValue<T extends string>(value: string | null, allowed: readonly T[], fallback: T, name: string): T {
  if (value === null) return fallback;
  if (!allowed.includes(value as T)) invalid("INVALID_HISTORY_FILTER", name + " 값이 올바르지 않습니다.");
  return value as T;
}

function dayStart(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) < "1970") {
    return invalid("INVALID_HISTORY_DATE", "날짜는 1970년 이후의 YYYY-MM-DD 형식이어야 합니다.");
  }
  const timestamp = Date.parse(value + "T00:00:00+09:00");
  if (!Number.isFinite(timestamp) || kstDate(timestamp) !== value) {
    return invalid("INVALID_HISTORY_DATE", "실제로 존재하는 날짜를 입력하세요.");
  }
  return timestamp;
}

function kstDate(timestamp: number) {
  return new Date(timestamp + KST_OFFSET).toISOString().slice(0, 10);
}

// Preserve PostgreSQL microseconds: Date.parse alone would collapse distinct
// timestamps to one millisecond and break the cursor ordering.
export function timestampMicros(value: string): bigint {
  const match = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  const milliseconds = Date.parse(value);
  if (!match || !Number.isFinite(milliseconds)) {
    return invalid("INVALID_HISTORY_CURSOR", "이력 페이지 정보가 올바르지 않습니다. 처음부터 다시 조회하세요.");
  }
  return BigInt(milliseconds) * BigInt(1000) + BigInt((match[2] ?? "").padEnd(6, "0").slice(3));
}

function decodeCursor(value: string, signingKey: string): CursorPayload {
  if (value.length > 2048) invalid("INVALID_HISTORY_CURSOR", "이력 페이지 정보가 너무 깁니다.");
  const parts = value.split(".");
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) {
    invalid("INVALID_HISTORY_CURSOR", "이력 페이지 정보가 올바르지 않습니다.");
  }
  const expected = createHmac("sha256", signingKey).update(parts[0]).digest();
  const signature = Buffer.from(parts[1], "base64url");
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
    invalid("INVALID_HISTORY_CURSOR", "이력 페이지 정보가 변경되었습니다. 처음부터 다시 조회하세요.");
  }
  let payload: CursorPayload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as CursorPayload;
  } catch {
    return invalid("INVALID_HISTORY_CURSOR", "이력 페이지 정보를 읽을 수 없습니다.");
  }
  if (!payload || payload.version !== 1 || typeof payload.fingerprint !== "string" ||
      typeof payload.asOf !== "string" || !payload.position ||
      typeof payload.position.createdAt !== "string" || typeof payload.position.id !== "string" ||
      !UUID.test(payload.position.id) || !historyTypes.includes(payload.position.type)) {
    invalid("INVALID_HISTORY_CURSOR", "이력 페이지 정보가 올바르지 않습니다.");
  }
  timestampMicros(payload.asOf);
  timestampMicros(payload.position.createdAt);
  return payload;
}

export function parseHistoryQuery(
  params: URLSearchParams,
  ownerId: string,
  signingKey: string,
  now = new Date(),
): HistoryQuery {
  const range = enumValue(params.get("range"), ["today", "7d", "30d", "90d", "365d", "all", "custom"] as const, "30d", "기간");
  const type = enumValue(params.get("type"), ["all", ...historyTypes] as const, "all", "작업 유형");
  const status = enumValue(params.get("status"), ["all", "success", "failed", "dry_run", "pending"] as const, "all", "상태");
  const sort = enumValue(params.get("sort"), ["newest", "oldest"] as const, "newest", "정렬");
  const summaryValue = enumValue(params.get("includeSummary"), ["true", "false"] as const, "true", "집계 포함");
  const rawLimit = Number(params.get("limit") ?? 100);
  if (!Number.isSafeInteger(rawLimit) || rawLimit < 1) invalid("INVALID_HISTORY_LIMIT", "표시 개수는 양의 정수여야 합니다.");
  const limit = Math.min(rawLimit, 200);
  const q = (params.get("q") ?? "").trim().toLowerCase();
  if (q.length > 200) invalid("HISTORY_QUERY_TOO_LONG", "검색어는 200자 이내로 입력하세요.");
  const requestedFrom = params.get("from");
  const requestedTo = params.get("to");
  if (range !== "custom" && (requestedFrom !== null || requestedTo !== null)) {
    invalid("INVALID_HISTORY_DATE_RANGE", "시작일과 종료일은 사용자 지정 기간에서만 사용할 수 있습니다.");
  }
  if (range === "custom" && (!requestedFrom || !requestedTo)) {
    invalid("INVALID_HISTORY_DATE_RANGE", "사용자 지정 기간의 시작일과 종료일을 모두 입력하세요.");
  }

  const fingerprint = createHash("sha256").update(JSON.stringify({
    ownerId, range, from: requestedFrom, to: requestedTo, type, status, q, sort, limit,
  })).digest("hex");
  const rawCursor = params.get("cursor");
  const payload = rawCursor ? decodeCursor(rawCursor, signingKey) : null;
  if (payload && payload.fingerprint !== fingerprint) {
    invalid("HISTORY_CURSOR_FILTER_MISMATCH", "검색 조건이 변경되었습니다. 첫 페이지부터 다시 조회하세요.");
  }
  const asOf = payload?.asOf ?? now.toISOString();
  if (timestampMicros(asOf) > timestampMicros(now.toISOString())) {
    invalid("INVALID_HISTORY_CURSOR", "이력 조회 기준 시각이 올바르지 않습니다.");
  }

  let from: string | null = null;
  let to: string | null = null;
  if (range === "custom") {
    const start = dayStart(requestedFrom!);
    const end = dayStart(requestedTo!);
    if (start > end) invalid("INVALID_HISTORY_DATE_RANGE", "시작일은 종료일보다 늦을 수 없습니다.");
    from = requestedFrom;
    to = requestedTo;
  } else if (range !== "all") {
    const days = range === "today" ? 1 : Number(range.slice(0, -1));
    to = kstDate(Date.parse(asOf));
    from = kstDate(dayStart(to) - (days - 1) * DAY_MS);
  }
  const fromInclusive = from ? new Date(dayStart(from)).toISOString() : null;
  const toExclusive = to ? new Date(dayStart(to) + DAY_MS).toISOString() : null;
  if (payload) {
    const positionTime = timestampMicros(payload.position.createdAt);
    if (positionTime > timestampMicros(asOf) ||
        (fromInclusive && positionTime < timestampMicros(fromInclusive)) ||
        (toExclusive && positionTime >= timestampMicros(toExclusive))) {
      invalid("INVALID_HISTORY_CURSOR", "이력 페이지가 조회 기간에 속하지 않습니다.");
    }
  }
  return {
    filters: { range, from, to, type, status, q, sort, limit, timezone: "Asia/Seoul", asOf },
    fromInclusive, toExclusive, includeSummary: summaryValue === "true",
    fingerprint, cursor: payload?.position ?? null,
  };
}

export function createHistoryCursor(query: HistoryQuery, position: HistoryPosition, signingKey: string) {
  const payload: CursorPayload = {
    version: 1, fingerprint: query.fingerprint, asOf: query.filters.asOf, position,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return encoded + "." + createHmac("sha256", signingKey).update(encoded).digest("base64url");
}

export function compareHistoryPositions(left: HistoryPosition, right: HistoryPosition, sort: HistorySort) {
  const leftTime = timestampMicros(left.createdAt);
  const rightTime = timestampMicros(right.createdAt);
  const chronological = leftTime < rightTime ? -1 : leftTime > rightTime ? 1 :
    typeRank[left.type] - typeRank[right.type] ||
    (left.id.toLowerCase() < right.id.toLowerCase() ? -1 : left.id.toLowerCase() > right.id.toLowerCase() ? 1 : 0);
  return sort === "oldest" ? chronological : -chronological;
}

export function paginateHistory<T extends HistoryPosition>(items: T[], query: HistoryQuery, signingKey: string) {
  const sorted = [...items].sort((left, right) => compareHistoryPositions(left, right, query.filters.sort));
  const hasMore = sorted.length > query.filters.limit;
  const page = sorted.slice(0, query.filters.limit);
  const last = page.at(-1);
  return {
    items: page,
    hasMore,
    nextCursor: hasMore && last ? createHistoryCursor(query, {
      id: last.id, type: last.type, createdAt: last.createdAt,
    }, signingKey) : null,
  };
}

function quoteFilter(value: string) {
  return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

// One .or() call combines text and keyset predicates. Each table has a constant
// type, so the type tie-break decides whether equal timestamps are included,
// excluded, or compared by UUID.
export function historyFilterExpression(source: HistoryType, query: HistoryQuery, countOnly = false) {
  const expressions: string[] = [];
  const search = query.filters.q.replace(/[%,]/g, " ").trim();
  if (search) {
    const pattern = quoteFilter("%" + search + "%");
    expressions.push("or(" + searchColumns[source].map((column) => column + ".ilike." + pattern).join(",") + ")");
  }
  if (!countOnly && query.cursor) {
    const cursor = query.cursor;
    const op = query.filters.sort === "newest" ? "lt" : "gt";
    const typeAfterCursor = query.filters.sort === "newest"
      ? typeRank[source] < typeRank[cursor.type]
      : typeRank[source] > typeRank[cursor.type];
    if (source === cursor.type) {
      expressions.push("or(created_at." + op + "." + cursor.createdAt +
        ",and(created_at.eq." + cursor.createdAt + ",id." + op + "." + cursor.id + "))");
    } else {
      expressions.push("created_at." + (typeAfterCursor ? op + "e" : op) + "." + cursor.createdAt);
    }
  }
  return expressions.length ? "and(" + expressions.join(",") + ")" : null;
}

