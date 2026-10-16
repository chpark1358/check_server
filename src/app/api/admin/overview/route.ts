import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AdminQueryError, adminFilterExpression, createAdminCursor, isAdminUserId, parseAdminQuery, type AdminCriteria } from "@/lib/server/admin-query";
import { ApiError, apiOk, requireRole, withApiHandler } from "@/lib/server/api";
import { writeAuditLog } from "@/lib/server/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ProfileRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string | null;
  created_at: string;
  updated_at: string | null;
};

type AuditLogRow = {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type TicketSendRow = {
  id: string;
  sent_by: string;
  zendesk_ticket_id: string | null;
  zendesk_ticket_url: string | null;
  organization_id: string | null;
  requester_email: string | null;
  group_id: string | null;
  assignee_email: string | null;
  subject: string;
  attachment_count: number;
  auto_solved: boolean;
  status: string;
  error_summary: string | null;
  created_at: string;
};

type GeneratedDocumentRow = {
  id: string;
  created_by: string;
  company_name: string;
  serial: string;
  engineer_name: string | null;
  pdf_status: string;
  attached_to_mail: boolean;
  created_at: string;
  expires_at: string;
};

const tableNames = { audit: "audit_logs", sends: "ticket_sends", documents: "generated_documents", users: "profiles" } as const;
const selectedColumns = {
  audit: "id,actor_id,action,target_type,target_id,metadata,created_at",
  sends: "id,sent_by,zendesk_ticket_id,zendesk_ticket_url,organization_id,requester_email,group_id,assignee_email,subject,attachment_count,auto_solved,status,error_summary,created_at",
  documents: "id,created_by,company_name,serial,engineer_name,pdf_status,attached_to_mail,created_at,expires_at",
  users: "id,email,display_name,role,created_at,updated_at",
} as const;

export function GET(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "admin");
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error("Admin cursor signing is not configured.");
    let criteria: AdminCriteria;
    try { criteria = parseAdminQuery(request.nextUrl.searchParams, auth.user.id, key); }
    catch (error) {
      if (error instanceof AdminQueryError) throw new ApiError(400, "INVALID_ADMIN_QUERY", error.message);
      throw error;
    }
    const { section, limit, asOf } = criteria;
    if (request.nextUrl.searchParams.get("audit") === "search") {
      await writeAuditLog(auth.supabase, auth.user, "admin.overview.search", "admin_console", null, {
        requestId, section, q: criteria.q.slice(0, 80) || null, action: criteria.action || null,
        status: criteria.status || null, range: criteria.range, limit,
      });
    }
    let actorIds: string[] | null = null;
    if (criteria.actor) {
      if (isAdminUserId(criteria.actor)) actorIds = [criteria.actor];
      else {
        const found = await auth.supabase.from("profiles").select("id").ilike("email", criteria.actor.replace(/[\\%_]/g, "\\$&")).limit(2);
        if (found.error) throw new Error(found.error.message);
        actorIds = (found.data ?? []).map(row => row.id as string);
        if (actorIds.length > 1) throw new ApiError(400, "AMBIGUOUS_ADMIN_ACTOR", "같은 이메일의 프로필이 여러 개입니다. 사용자 ID로 검색하세요.");
      }
    }
    const since = new Date(Date.parse(asOf) - 86_400_000).toISOString();
    const [records, totalResult, auditCount, documentCount, sendCount, failedCount] = await Promise.all([
      buildQuery(auth.supabase, criteria, actorIds, false).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1),
      buildQuery(auth.supabase, criteria, actorIds, true),
      countRecent(auth.supabase, "audit_logs", since, asOf),
      countRecent(auth.supabase, "generated_documents", since, asOf),
      countRecent(auth.supabase, "ticket_sends", since, asOf),
      countRecent(auth.supabase, "ticket_sends", since, asOf, "failed"),
    ]);
    if (records.error) throw new Error(records.error.message);
    if (totalResult.error) throw new Error(totalResult.error.message);
    if (totalResult.count === null) throw new Error("검색 결과 개수를 확인하지 못했습니다.");
    const candidates = records.data ?? [];
    const hasMore = candidates.length > limit;
    const rows = candidates.slice(0, limit);
    const last = rows.at(-1) as unknown as { id: string; created_at: string } | undefined;
    const actorColumn = section === "audit" ? "actor_id" : section === "sends" ? "sent_by" : "created_by";
    const ids = section === "users" ? [] : [...new Set(rows.map(row => (row as unknown as Record<string, unknown>)[actorColumn]).filter((id): id is string => typeof id === "string"))];
    const profileResult = section === "users" ? { data: rows, error: null } : ids.length
      ? await auth.supabase.from("profiles").select("id,email,display_name,role,created_at,updated_at").in("id", ids)
      : { data: [], error: null };
    if (profileResult.error) throw new Error(profileResult.error.message);
    const profiles = (profileResult.data ?? []) as unknown as ProfileRow[];
    const profileById = new Map(profiles.map(profile => [profile.id, profile]));
    // Fetch only this page's Auth records. Do not enumerate all Auth users to render a log page.
    const authResults = section === "users" ? await Promise.all(profiles.map(async profile => ({
      id: profile.id, result: await auth.supabase.auth.admin.getUserById(profile.id),
    }))) : [];
    const authById = new Map(authResults.map(({ id, result }) => [id, result.error ? null : result.data.user]));
    const users = section === "users" ? profiles.map(profile => {
      const authUser = authById.get(profile.id);
      return {
        id: profile.id, email: profile.email ?? authUser?.email ?? null,
        displayName: profile.display_name, role: profile.role ?? "viewer",
        createdAt: profile.created_at, updatedAt: profile.updated_at,
        invitedAt: authUser?.invited_at ?? null, emailConfirmedAt: authUser?.email_confirmed_at ?? null,
        lastSignInAt: authUser?.last_sign_in_at ?? null,
        authLookupFailed: !authUser,
      };
    }) : [];
    const auditLogs = section === "audit" ? (rows as unknown as AuditLogRow[]).map(row => ({
      id: row.id, actorId: row.actor_id,
      actorEmail: stringMeta(row.metadata, "actorEmail") ?? profileById.get(row.actor_id ?? "")?.email ?? null,
      action: row.action, targetType: row.target_type, targetId: row.target_id,
      metadata: sanitizeAdminMetadata(row.metadata ?? {}), createdAt: row.created_at,
    })) : [];
    const ticketSends = section === "sends" ? (rows as unknown as TicketSendRow[]).map(row => ({
      id: row.id, sentBy: row.sent_by, actorEmail: profileById.get(row.sent_by)?.email ?? null,
      zendeskTicketId: row.zendesk_ticket_id, zendeskTicketUrl: row.zendesk_ticket_url,
      organizationId: row.organization_id, requesterEmail: row.requester_email,
      groupId: row.group_id, assigneeEmail: row.assignee_email, subject: row.subject,
      attachmentCount: row.attachment_count, autoSolved: row.auto_solved, status: row.status,
      errorSummary: row.error_summary, createdAt: row.created_at,
    })) : [];
    const documents = section === "documents" ? (rows as unknown as GeneratedDocumentRow[]).map(row => ({
      id: row.id, createdBy: row.created_by, actorEmail: profileById.get(row.created_by)?.email ?? null,
      companyName: row.company_name, serial: row.serial, engineerName: row.engineer_name,
      pdfStatus: row.pdf_status, attachedToMail: row.attached_to_mail, createdAt: row.created_at, expiresAt: row.expires_at,
    })) : [];
    return apiOk(requestId, {
      users, auditLogs, ticketSends, documents,
      summary: {
        auditEvents24h: auditCount, documents24h: documentCount, ticketSends24h: sendCount,
        failedTicketSends: failedCount,
        pendingInvites: users.filter(user => Boolean(user.invitedAt) && !user.emailConfirmedAt && !user.authLookupFailed).length,
      },
      pageInfo: { section, total: totalResult.count, hasMore, limit, asOf,
        startCursor: createAdminCursor(criteria, null, key),
        nextCursor: hasMore && last ? createAdminCursor(criteria, { id: last.id, createdAt: last.created_at }, key) : null },
      authUserLookupWarning: authResults.some(({ result }) => result.error) ? "현재 페이지의 일부 사용자 인증 정보를 조회하지 못했습니다." : null,
    });
  });
}

function buildQuery(supabase: SupabaseClient, criteria: AdminCriteria, actorIds: string[] | null, countOnly: boolean) {
  const { section } = criteria;
  let query = supabase.from(tableNames[section]).select(countOnly ? "id" : selectedColumns[section], countOnly ? { count: "exact", head: true } : {})
    .lte("created_at", criteria.asOf);
  if (criteria.from) query = query.gte("created_at", criteria.from);
  if (actorIds) query = query.in(section === "audit" ? "actor_id" : section === "sends" ? "sent_by" : "created_by", actorIds.length ? actorIds : ["00000000-0000-0000-0000-000000000000"]);
  if (criteria.action) query = query.eq("action", criteria.action);
  if (criteria.status) query = query.eq(section === "documents" ? "pdf_status" : "status", criteria.status);
  if (criteria.role) query = query.eq("role", criteria.role);
  const expression = adminFilterExpression(criteria, countOnly);
  if (expression) query = query.or(expression);
  return query;
}
async function countRecent(supabase: SupabaseClient, table: string, since: string, asOf: string, status?: string) {
  let query = supabase.from(table).select("id", { count: "exact", head: true }).gte("created_at", since).lte("created_at", asOf);
  if (status) query = query.eq("status", status);
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  if (result.count === null) throw new Error("관리자 집계를 확인하지 못했습니다.");
  return result.count;
}

function stringMeta(metadata: Record<string, unknown> | null, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sanitizeAdminMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sensitivePattern = /(token|secret|password|authorization|service_role|api_key)/i;
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key,
      sensitivePattern.test(key) ? "[redacted]" : sanitizeMetadataValue(value),
    ]),
  );
}

function sanitizeMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeMetadataValue);
  }
  if (value && typeof value === "object") {
    return sanitizeAdminMetadata(value as Record<string, unknown>);
  }
  return value;
}
