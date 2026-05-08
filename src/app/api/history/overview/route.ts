import type { NextRequest } from "next/server";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { apiOk, requireRole, withApiHandler } from "@/lib/server/api";

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
    const params = request.nextUrl.searchParams;
    const limit = normalizeLimit(params.get("limit"));
    const q = normalizeQuery(params.get("q"));
    const type = normalizeType(params.get("type"));
    const status = normalizeStatus(params.get("status"));
    const since = getSince(params.get("range"));

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
    ] = await Promise.all([
      includeChecks ? buildAuditQuery(auth.supabase, auth.user.id, since, status, q, false).limit(limit) : emptyResult<AuditLogRow>(),
      includeMails ? buildSendsQuery(auth.supabase, auth.user.id, since, status, q, false).limit(limit) : emptyResult<TicketSendRow>(),
      includeDocuments ? buildDocumentsQuery(auth.supabase, auth.user.id, since, status, q, false).limit(limit) : emptyResult<GeneratedDocumentRow>(),
      includeChecks ? runCount(buildAuditQuery(auth.supabase, auth.user.id, since, status, q, true)) : 0,
      includeDocuments ? runCount(buildDocumentsQuery(auth.supabase, auth.user.id, since, status, q, true)) : 0,
      includeMails ? runCount(buildSendsQuery(auth.supabase, auth.user.id, since, status, q, true)) : 0,
      includeChecks && includeFailureSummary ? runCount(buildAuditQuery(auth.supabase, auth.user.id, since, "failed", q, true)) : 0,
      includeDocuments && includeFailureSummary ? runCount(buildDocumentsQuery(auth.supabase, auth.user.id, since, "failed", q, true)) : 0,
      includeMails && includeFailureSummary ? runCount(buildSendsQuery(auth.supabase, auth.user.id, since, "failed", q, true)) : 0,
    ]);

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
      serial: row.organization_id,
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

    const items = [...auditItems, ...sendItems, ...documentItems]
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, limit);

    return apiOk(requestId, {
      items,
      summary: {
        checks: checkCount,
        documents: documentCount,
        mails: mailCount,
        failures: checkFailureCount + documentFailureCount + mailFailureCount,
      },
    });
  });
}

function buildAuditQuery(
  supabase: SupabaseClient,
  userId: string,
  since: Date,
  status: string,
  q: string,
  countOnly: boolean,
) {
  let query = supabase
    .from("audit_logs")
    .select("id,actor_id,action,target_type,target_id,serial,company_name,metadata,created_at", countOnly ? { count: "exact", head: true } : undefined)
    .eq("actor_id", userId)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false });

  if (status === "success") {
    query = query.eq("action", "solution.checkup");
  } else if (status === "failed") {
    query = query.eq("action", "solution.checkup_failed");
  } else {
    query = query.in("action", checkActions);
  }
  if (q) {
    const value = escapeFilterValue(q);
    if (value) {
      query = query.or(`target_id.ilike.%${value}%,serial.ilike.%${value}%,company_name.ilike.%${value}%,search_text.ilike.%${value}%`);
    }
  }
  return query;
}

function buildSendsQuery(
  supabase: SupabaseClient,
  userId: string,
  since: Date,
  status: string,
  q: string,
  countOnly: boolean,
) {
  let query = supabase
    .from("ticket_sends")
    .select(
      "id,sent_by,zendesk_ticket_id,zendesk_ticket_url,organization_id,requester_email,subject,attachment_count,status,error_summary,created_at",
      countOnly ? { count: "exact", head: true } : undefined,
    )
    .eq("sent_by", userId)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false });

  if (sendStatuses.includes(status)) {
    query = query.eq("status", status);
  }
  if (q) {
    const value = escapeFilterValue(q);
    if (value) {
      query = query.or(
        `zendesk_ticket_id.ilike.%${value}%,organization_id.ilike.%${value}%,requester_email.ilike.%${value}%,subject.ilike.%${value}%,error_summary.ilike.%${value}%`,
      );
    }
  }
  return query;
}

function buildDocumentsQuery(
  supabase: SupabaseClient,
  userId: string,
  since: Date,
  status: string,
  q: string,
  countOnly: boolean,
) {
  let query = supabase
    .from("generated_documents")
    .select(
      "id,created_by,company_name,serial,engineer_name,pdf_status,pdf_error_summary,attached_to_mail,created_at",
      countOnly ? { count: "exact", head: true } : undefined,
    )
    .eq("created_by", userId)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false });

  if (status === "success") {
    query = query.neq("pdf_status", "failed");
  } else if (status === "failed") {
    query = query.eq("pdf_status", "failed");
  }
  if (q) {
    const value = escapeFilterValue(q);
    if (value) {
      query = query.or(`company_name.ilike.%${value}%,serial.ilike.%${value}%,engineer_name.ilike.%${value}%,pdf_error_summary.ilike.%${value}%`);
    }
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

function normalizeLimit(value: string | null) {
  const parsed = Number(value ?? 100);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 100;
}

function normalizeType(value: string | null) {
  return ["check", "document", "mail"].includes(String(value)) ? String(value) : "all";
}

function normalizeStatus(value: string | null) {
  return ["success", "failed", "dry_run", "pending"].includes(String(value)) ? String(value) : "all";
}

function normalizeQuery(value: string | null) {
  return (value ?? "").trim().toLowerCase();
}

function escapeFilterValue(value: string) {
  return value.replace(/[%,]/g, " ").trim();
}

function getSince(range: string | null) {
  const now = Date.now();
  if (range === "today") {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }
  if (range === "7d") {
    return new Date(now - 7 * 24 * 60 * 60 * 1000);
  }
  return new Date(now - 30 * 24 * 60 * 60 * 1000);
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
