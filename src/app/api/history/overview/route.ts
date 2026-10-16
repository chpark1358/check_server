import type { NextRequest } from "next/server";
import { measureQuery, measureTiming } from "@/lib/server/request-timing";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { ApiError, apiOk, requireRole, withApiHandler } from "@/lib/server/api";
import {
  HistoryQueryError,
  historyFilterExpression,
  paginateHistory,
  parseHistoryQuery,
  type HistoryQuery,
  type HistoryType,
} from "@/lib/server/history-query";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AuditLogRow = {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  serial: string | null;
  company_name: string | null;
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
  subject: string;
  attachment_count: number;
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
  pdf_error_summary: string | null;
  attached_to_mail: boolean;
  created_at: string;
};

const checkActions = ["solution.checkup", "solution.checkup_failed"];
const sendStatuses = ["success", "failed", "dry_run", "pending"];

export function GET(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "operator");
    const signingKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!signingKey) throw new Error("History cursor signing is not configured.");
    let criteria: HistoryQuery;
    try {
      criteria = parseHistoryQuery(request.nextUrl.searchParams, auth.user.id, signingKey);
    } catch (error) {
      if (error instanceof HistoryQueryError) throw new ApiError(400, error.code, error.message);
      throw error;
    }
    const { limit, type, status } = criteria.filters;
    const includeSummary = criteria.includeSummary;

    const checkLikeStatus = status === "all" || status === "success" || status === "failed";
    const includeChecks = (type === "all" || type === "check") && checkLikeStatus;
    const includeDocuments = (type === "all" || type === "document") && checkLikeStatus;
    const includeMails = type === "all" || type === "mail";
    const includeFailureSummary = status === "all" || status === "failed";

    const [
      auditResult,
      sendsResult,
      documentsResult,
      checkCount,
      documentCount,
      mailCount,
      checkFailureCount,
      documentFailureCount,
      mailFailureCount,
    ] = await measureTiming("db", () => Promise.all([
      includeChecks ? measureQuery("q_audit", () => buildAuditQuery(auth.supabase, auth.user.id, criteria, status, false).limit(limit + 1)) : emptyResult<AuditLogRow>(),
      includeMails ? measureQuery("q_mail", () => buildSendsQuery(auth.supabase, auth.user.id, criteria, status, false).limit(limit + 1)) : emptyResult<TicketSendRow>(),
      includeDocuments ? measureQuery("q_documents", () => buildDocumentsQuery(auth.supabase, auth.user.id, criteria, status, false).limit(limit + 1)) : emptyResult<GeneratedDocumentRow>(),
      includeSummary && includeChecks ? measureQuery("q_check_count", () => runCount(buildAuditQuery(auth.supabase, auth.user.id, criteria, status, true))) : 0,
      includeSummary && includeDocuments ? measureQuery("q_document_count", () => runCount(buildDocumentsQuery(auth.supabase, auth.user.id, criteria, status, true))) : 0,
      includeSummary && includeMails ? measureQuery("q_mail_count", () => runCount(buildSendsQuery(auth.supabase, auth.user.id, criteria, status, true))) : 0,
      includeSummary && includeChecks && includeFailureSummary ? measureQuery("q_check_failed", () => runCount(buildAuditQuery(auth.supabase, auth.user.id, criteria, "failed", true))) : 0,
      includeSummary && includeDocuments && includeFailureSummary ? measureQuery("q_document_failed", () => runCount(buildDocumentsQuery(auth.supabase, auth.user.id, criteria, "failed", true))) : 0,
      includeSummary && includeMails && includeFailureSummary ? measureQuery("q_mail_failed", () => runCount(buildSendsQuery(auth.supabase, auth.user.id, criteria, "failed", true))) : 0,
    ]));

    if (auditResult.error) {
      throw new Error(auditResult.error.message);
    }
    if (sendsResult.error) {
      throw new Error(sendsResult.error.message);
    }
    if (documentsResult.error) {
      throw new Error(documentsResult.error.message);
    }

    const auditItems = ((auditResult.data ?? []) as AuditLogRow[]).map((row) => ({
      id: row.id,
      type: "check" as const,
      action: row.action,
      status: row.action.endsWith("_failed") ? "failed" : "success",
      actorEmail: stringMeta(row.metadata, "actorEmail"),
      companyName: row.company_name || stringMeta(row.metadata, "companyName"),
      serial: row.serial || stringMeta(row.metadata, "serial") || row.target_id,
      title: "점검 데이터 조회",
      summary: stringMeta(row.metadata, "errorSummary") || row.company_name || stringMeta(row.metadata, "companyName") || "-",
      targetId: row.target_id,
      createdAt: row.created_at,
    }));

    const sendItems = ((sendsResult.data ?? []) as TicketSendRow[]).map((row) => ({
      id: row.id,
      type: "mail" as const,
      action: "zendesk.ticket.send",
      status: row.status,
      actorEmail: null,
      companyName: "",
      serial: null,
      organizationId: row.organization_id,
      title: row.subject,
      summary: row.error_summary || row.requester_email || row.zendesk_ticket_id || "-",
      targetId: row.zendesk_ticket_id,
      ticketUrl: row.zendesk_ticket_url,
      createdAt: row.created_at,
    }));

    const documentItems = ((documentsResult.data ?? []) as GeneratedDocumentRow[]).map((row) => ({
      id: row.id,
      type: "document" as const,
      action: "document.check_report.generate",
      status: row.pdf_status === "failed" ? "failed" : "success",
      actorEmail: null,
      companyName: row.company_name,
      serial: row.serial,
      title: "점검서 생성",
      summary: `${row.engineer_name ?? "-"} · PDF ${formatPdfStatus(row.pdf_status)} · 메일 첨부 ${row.attached_to_mail ? "완료" : "대기"}`,
      targetId: row.id,
      documentId: row.id,
      createdAt: row.created_at,
    }));

    const page = paginateHistory([...auditItems, ...sendItems, ...documentItems], criteria, signingKey);

    return apiOk(requestId, {
      ...page,
      appliedFilters: criteria.filters,
      summary: includeSummary ? {
        checks: checkCount,
        documents: documentCount,
        mails: mailCount,
        failures: checkFailureCount + documentFailureCount + mailFailureCount,
      } : null,
    });
  });
}

function buildSourceQuery(
  supabase: SupabaseClient,
  userId: string,
  source: HistoryType,
  criteria: HistoryQuery,
  countOnly: boolean,
) {
  const sources = {
    check: {
      table: "audit_logs", owner: "actor_id",
      columns: "id,actor_id,action,target_type,target_id,serial,company_name,metadata,created_at",
    },
    mail: {
      table: "ticket_sends", owner: "sent_by",
      columns: "id,sent_by,zendesk_ticket_id,zendesk_ticket_url,organization_id,requester_email,subject,attachment_count,status,error_summary,created_at",
    },
    document: {
      table: "generated_documents", owner: "created_by",
      columns: "id,created_by,company_name,serial,engineer_name,pdf_status,pdf_error_summary,attached_to_mail,created_at",
    },
  };
  const config = sources[source];
  let query = supabase
    .from(config.table)
    .select(config.columns, countOnly ? { count: "exact", head: true } : undefined)
    .eq(config.owner, userId)
    .lte("created_at", criteria.filters.asOf);
  if (criteria.fromInclusive) query = query.gte("created_at", criteria.fromInclusive);
  if (criteria.toExclusive) query = query.lt("created_at", criteria.toExclusive);
  const expression = historyFilterExpression(source, criteria, countOnly);
  if (expression) query = query.or(expression);
  if (!countOnly) {
    const ascending = criteria.filters.sort === "oldest";
    query = query.order("created_at", { ascending }).order("id", { ascending });
  }
  return query;
}

function buildAuditQuery(
  supabase: SupabaseClient,
  userId: string,
  criteria: HistoryQuery,
  status: string,
  countOnly: boolean,
) {
  let query = buildSourceQuery(supabase, userId, "check", criteria, countOnly);
  if (status === "success") {
    query = query.eq("action", "solution.checkup");
  } else if (status === "failed") {
    query = query.eq("action", "solution.checkup_failed");
  } else {
    query = query.in("action", checkActions);
  }
  return query;
}

function buildSendsQuery(
  supabase: SupabaseClient,
  userId: string,
  criteria: HistoryQuery,
  status: string,
  countOnly: boolean,
) {
  let query = buildSourceQuery(supabase, userId, "mail", criteria, countOnly);
  if (sendStatuses.includes(status)) query = query.eq("status", status);
  return query;
}

function buildDocumentsQuery(
  supabase: SupabaseClient,
  userId: string,
  criteria: HistoryQuery,
  status: string,
  countOnly: boolean,
) {
  let query = buildSourceQuery(supabase, userId, "document", criteria, countOnly);
  if (status === "success") {
    query = query.neq("pdf_status", "failed");
  } else if (status === "failed") {
    query = query.eq("pdf_status", "failed");
  }
  return query;
}

type CountQuery = PromiseLike<{ count: number | null; error: PostgrestError | null }>;

async function runCount(query: CountQuery) {
  const { count, error } = await query;
  if (error) {
    throw new Error(error.message);
  }
  return count ?? 0;
}

function emptyResult<T>() {
  return Promise.resolve({ data: [] as T[], error: null });
}

function stringMeta(metadata: Record<string, unknown> | null, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function formatPdfStatus(status: string) {
  if (status === "success") {
    return "완료";
  }
  if (status === "failed") {
    return "실패";
  }
  return "없음";
}
