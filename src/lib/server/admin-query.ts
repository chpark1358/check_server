import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type AdminSection = "audit" | "sends" | "documents" | "users";
export type AdminPosition = { id: string; createdAt: string };
export type AdminCriteria = {
  section: AdminSection; q: string; actor: string; action: string; status: string;
  role: string; range: string; limit: number; asOf: string; from: string | null;
  fingerprint: string; cursor: AdminPosition | null;
};
export class AdminQueryError extends Error {}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isAdminUserId(value: string) { return UUID.test(value); }
function fail(): never { throw new AdminQueryError("관리자 검색 조건이나 페이지 정보가 올바르지 않습니다. 처음부터 다시 조회하세요."); }
function timestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
}
export function parseAdminQuery(params: URLSearchParams, owner: string, key: string, now = new Date()): AdminCriteria {
  const section = params.get("section") ?? "audit";
  const range = params.get("range") ?? "all";
  const limit = Number(params.get("limit") ?? 25);
  const q = (params.get("q") ?? "").trim();
  const actor = (params.get("actor") ?? "").trim().toLowerCase();
  const action = (params.get("action") ?? "").trim();
  const status = params.get("status") ?? "";
  const role = params.get("role") ?? "";
  if (!["audit", "sends", "documents", "users"].includes(section) || !["all", "1", "7", "30", "90", "365"].includes(range) ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || q.length > 200 || actor.length > 254 || action.length > 100 ||
      (action && !/^[\w.-]+$/.test(action)) || !(section === "documents" ? ["", "success", "failed", "unavailable", "not_requested"] : ["", "success", "failed", "dry_run", "pending"]).includes(status) ||
      !["", "viewer", "operator", "admin"].includes(role)) fail();
  if ((action && section !== "audit") || (status && section !== "sends" && section !== "documents") ||
      (role && section !== "users") || (actor && section === "users")) fail();
  const fingerprint = createHash("sha256").update(JSON.stringify({ owner, section, range, limit, q, actor, action, status, role })).digest("hex");
  let asOf = now.toISOString();
  let cursor: AdminPosition | null = null;
  const raw = params.get("cursor");
  if (raw) {
    if (raw.length > 2048) fail();
    const parts = raw.split(".");
    if (parts.length !== 2 || !parts.every(p => /^[\w-]+$/.test(p))) fail();
    const expected = createHmac("sha256", key).update(parts[0]).digest();
    const actual = Buffer.from(parts[1], "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) fail();
    let payload;
    try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { fail(); }
    if (payload?.version !== 1 || payload.fingerprint !== fingerprint || !timestamp(payload.asOf) ||
        (payload.position !== null && (!timestamp(payload.position?.createdAt) || typeof payload.position?.id !== "string" || !UUID.test(payload.position.id) ||
          Date.parse(payload.position.createdAt) > Date.parse(payload.asOf))) || Date.parse(payload.asOf) > now.getTime()) fail();
    asOf = payload.asOf; cursor = payload.position;
  }
  const from = range === "all" ? null : new Date(Date.parse(asOf) - Number(range) * 86_400_000).toISOString();
  if (cursor && from && Date.parse(cursor.createdAt) < Date.parse(from)) fail();
  return { section: section as AdminSection, q, actor, action, status, role, range, limit, asOf, from, fingerprint, cursor };
}
export function createAdminCursor(criteria: AdminCriteria, position: AdminPosition | null, key: string) {
  const encoded = Buffer.from(JSON.stringify({ version: 1, fingerprint: criteria.fingerprint, asOf: criteria.asOf, position })).toString("base64url");
  return encoded + "." + createHmac("sha256", key).update(encoded).digest("base64url");
}
export function quoteAdminFilter(value: string) { return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }
const columns: Record<AdminSection, string[]> = {
  audit: ["action", "target_type", "target_id", "serial", "company_name", "search_text", "metadata->>actorEmail"],
  sends: ["zendesk_ticket_id", "organization_id", "requester_email", "assignee_email", "subject", "error_summary"],
  documents: ["company_name", "serial", "engineer_name"],
  users: ["email", "display_name"],
};
export function adminFilterExpression(criteria: AdminCriteria, countOnly = false) {
  const terms: string[] = [];
  if (criteria.q) {
    // Search metacharacters are literal. Quoting prevents PostgREST filter injection.
    const pattern = quoteAdminFilter("%" + criteria.q.replace(/[\\%_*]/g, "\\$&") + "%");
    terms.push("or(" + columns[criteria.section].map(column => column + ".ilike." + pattern).join(",") + ")");
  }
  if (!countOnly && criteria.cursor) {
    const { createdAt, id } = criteria.cursor;
    terms.push(`or(created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id}))`);
  }
  return terms.length ? "and(" + terms.join(",") + ")" : null;
}
