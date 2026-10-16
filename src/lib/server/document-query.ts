import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HistoryQueryError, historyFilterExpression, parseHistoryQuery, timestampMicros, type HistoryQuery } from "./history-query";

export class DocumentQueryError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export type DocumentExpiry = "all" | "available" | "expiring" | "expired";
export type DocumentPosition = { id: string; createdAt: string };
export type DocumentQuery = {
  history: HistoryQuery;
  status: string;
  attached: "all" | "true" | "false";
  expiry: DocumentExpiry;
  fingerprint: string;
};
type CursorPayload = { version: 1; purpose: "documents"; fingerprint: string; asOf: string; position: DocumentPosition | null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const columns = "id,created_by,company_name,serial,engineer_name,docx_path,pdf_path,pdf_status,pdf_error_summary,attached_to_mail,created_at,expires_at";

function invalid(code: string, message: string): never { throw new DocumentQueryError(code, message); }
function enumValue<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  if (value === null) return fallback;
  if (!allowed.includes(value as T)) invalid("INVALID_DOCUMENT_FILTER", "문서 검색 조건이 올바르지 않습니다.");
  return value as T;
}
function decodeCursor(raw: string, key: string): CursorPayload {
  if (raw.length > 2048) invalid("INVALID_DOCUMENT_CURSOR", "문서 페이지 정보가 너무 깁니다.");
  const parts = raw.split(".");
  if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) invalid("INVALID_DOCUMENT_CURSOR", "문서 페이지 정보가 올바르지 않습니다.");
  const actual = Buffer.from(parts[1], "base64url");
  const expected = createHmac("sha256", key).update(parts[0]).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) invalid("INVALID_DOCUMENT_CURSOR", "문서 페이지 정보가 변경되었습니다. 다시 검색하세요.");
  let cursor: CursorPayload;
  try { cursor = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as CursorPayload; }
  catch { return invalid("INVALID_DOCUMENT_CURSOR", "문서 페이지 정보를 읽을 수 없습니다."); }
  if (!cursor || cursor.version !== 1 || cursor.purpose !== "documents" || typeof cursor.fingerprint !== "string" || typeof cursor.asOf !== "string" ||
    (cursor.position !== null && (!cursor.position || typeof cursor.position.createdAt !== "string" || typeof cursor.position.id !== "string" || !UUID.test(cursor.position.id)))) {
    invalid("INVALID_DOCUMENT_CURSOR", "문서 페이지 정보가 올바르지 않습니다.");
  }
  timestampMicros(cursor.asOf);
  if (cursor.position) timestampMicros(cursor.position.createdAt);
  return cursor;
}

export function parseDocumentQuery(params: URLSearchParams, ownerId: string, key: string, now = new Date()): DocumentQuery {
  try {
    const attached = enumValue(params.get("attached"), ["all", "true", "false"] as const, "all");
    const expiry = enumValue(params.get("expiry"), ["all", "available", "expiring", "expired"] as const, "all");
    const rawStatus = enumValue(params.get("status"), ["all", "pdf_success", "success", "not_requested", "failed", "unavailable"] as const, "all");
    const status = rawStatus === "pdf_success" ? "success" : rawStatus;
    const rawCursor = params.get("cursor");
    const cursor = rawCursor ? decodeCursor(rawCursor, key) : null;
    if (cursor && timestampMicros(cursor.asOf) > timestampMicros(now.toISOString())) invalid("INVALID_DOCUMENT_CURSOR", "문서 조회 기준 시각이 올바르지 않습니다.");
    const historyParams = new URLSearchParams({ range: params.get("range") ?? "all", type: "document", limit: params.get("limit") ?? "50" });
    for (const name of ["q", "from", "to"] as const) if (params.has(name)) historyParams.set(name, params.get(name)!);
    const history = parseHistoryQuery(historyParams, ownerId, key, cursor ? new Date(cursor.asOf) : now);
    const fingerprint = createHash("sha256").update(JSON.stringify({ purpose: "documents", ownerId,
      range: historyParams.get("range"), from: params.get("from"), to: params.get("to"),
      q: history.filters.q, limit: history.filters.limit, status, attached, expiry,
    })).digest("hex");
    if (cursor && cursor.fingerprint !== fingerprint) invalid("DOCUMENT_CURSOR_FILTER_MISMATCH", "계정 또는 검색 조건이 변경되었습니다. 첫 페이지부터 다시 검색하세요.");
    if (cursor?.position) {
      const time = timestampMicros(cursor.position.createdAt);
      if (time > timestampMicros(history.filters.asOf) ||
        (history.fromInclusive && time < timestampMicros(history.fromInclusive)) ||
        (history.toExclusive && time >= timestampMicros(history.toExclusive))) {
        invalid("INVALID_DOCUMENT_CURSOR", "문서 페이지가 조회 기간에 속하지 않습니다.");
      }
      history.cursor = { ...cursor.position, type: "document" };
    }
    return { history, status, attached, expiry, fingerprint };
  } catch (error) {
    if (error instanceof HistoryQueryError) throw new DocumentQueryError(error.code.replace("HISTORY", "DOCUMENT"), error.message.replaceAll("이력", "문서"));
    throw error;
  }
}

export function createDocumentCursor(criteria: DocumentQuery, position: DocumentPosition | null, key: string) {
  const payload: CursorPayload = { version: 1, purpose: "documents", fingerprint: criteria.fingerprint, asOf: criteria.history.filters.asOf, position };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return encoded + "." + createHmac("sha256", key).update(encoded).digest("base64url");
}

export function buildDocumentsQuery(supabase: SupabaseClient, userId: string, criteria: DocumentQuery, countOnly = false) {
  const { history, attached, status, expiry } = criteria;
  const asOf = history.filters.asOf;
  let query = supabase.from("generated_documents")
    .select(columns, countOnly ? { count: "exact", head: true } : undefined)
    .eq("created_by", userId).lte("created_at", asOf);
  if (!countOnly) query = query.order("created_at", { ascending: false }).order("id", { ascending: false });
  if (attached !== "all") query = query.eq("attached_to_mail", attached === "true");
  if (status !== "all") query = query.eq("pdf_status", status);
  if (history.fromInclusive) query = query.gte("created_at", history.fromInclusive);
  if (history.toExclusive) query = query.lt("created_at", history.toExclusive);
  if (expiry === "expired") query = query.lte("expires_at", asOf);
  if (expiry === "available" || expiry === "expiring") query = query.gt("expires_at", asOf);
  if (expiry === "expiring") query = query.lte("expires_at", new Date(Date.parse(asOf) + 7 * 86_400_000).toISOString());
  const expression = historyFilterExpression("document", history, countOnly);
  if (expression) query = query.or(expression);
  return query;
}
