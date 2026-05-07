import type { NextRequest } from "next/server";
import { apiOk, requireRole, withApiHandler } from "@/lib/server/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  attached_to_mail: boolean;
  created_at: string;
};

type ProfileRow = {
  id: string;
  email: string | null;
};

const historyActions = new Set([
  "solution.checkup",
  "solution.checkup_failed",
]);

export function GET(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "operator");
    const params = request.nextUrl.searchParams;
    const limit = normalizeLimit(params.get("limit"));
    const q = (params.get("q") ?? "").trim().toLowerCase();
    const type = params.get("type") ?? "all";
    const status = params.get("status") ?? "all";
    const since = getSince(params.get("range"));
    const isAdmin = auth.role === "admin";

    let auditQuery = auth.supabase
      .from("audit_logs")
      .select("id,actor_id,action,target_type,target_id,metadata,created_at")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!isAdmin) {
      auditQuery = auditQuery.eq("actor_id", auth.user.id);
    }

    let sendsQuery = auth.supabase
      .from("ticket_sends")
      .select("id,sent_by,zendesk_ticket_id,zendesk_ticket_url,organization_id,requester_email,subject,attachment_count,status,error_summary,created_at")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!isAdmin) {
      sendsQuery = sendsQuery.eq("sent_by", auth.user.id);
    }
    if (status !== "all" && ["success", "failed", "dry_run", "pending"].includes(status)) {
      sendsQuery = sendsQuery.eq("status", status);
    }

    let docsQuery = auth.supabase
      .from("generated_documents")
      .select("id,created_by,company_name,serial,engineer_name,pdf_status,attached_to_mail,created_at")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!isAdmin) {
      docsQuery = docsQuery.eq("created_by", auth.user.id);
    }
    if (status === "success") {
      docsQuery = docsQuery.eq("pdf_status", "success");
    } else if (status === "failed") {
      docsQuery = docsQuery.eq("pdf_status", "failed");
    }

    const [auditResult, sendsResult, documentsResult, profilesResult] = await Promise.all([
      auditQuery,
      sendsQuery,
      docsQuery,
      auth.supabase.from("profiles").select("id,email"),
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
    if (profilesResult.error) {
      throw new Error(profilesResult.error.message);
    }

    const profiles = (profilesResult.data ?? []) as ProfileRow[];
    const emailById = new Map(profiles.map((profile) => [profile.id, profile.email]));

    const auditItems = ((auditResult.data ?? []) as AuditLogRow[])
      .filter((row) => historyActions.has(row.action))
      .map((row) => ({
        id: row.id,
        type: row.action.startsWith("document.") ? "document" : "check",
        action: row.action,
        status: row.action.endsWith("_failed") ? "failed" : "success",
        actorEmail: emailById.get(row.actor_id ?? "") ?? stringMeta(row.metadata, "actorEmail"),
        companyName: stringMeta(row.metadata, "companyName"),
        serial: stringMeta(row.metadata, "serial") || row.target_id,
        title: row.action.startsWith("document.") ? "점검서 생성" : "점검 데이터 조회",
        summary: stringMeta(row.metadata, "errorSummary") || stringMeta(row.metadata, "companyName") || "-",
        targetId: row.target_id,
        createdAt: row.created_at,
      }));

    const sendItems = ((sendsResult.data ?? []) as TicketSendRow[]).map((row) => ({
      id: row.id,
      type: "mail",
      action: "zendesk.ticket.send",
      status: row.status,
      actorEmail: emailById.get(row.sent_by) ?? null,
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
      type: "document",
      action: "document.check_report.generate",
      status: row.pdf_status === "failed" ? "failed" : "success",
      actorEmail: emailById.get(row.created_by) ?? null,
      companyName: row.company_name,
      serial: row.serial,
      title: "점검서 생성",
      summary: `${row.engineer_name ?? "-"} · PDF ${formatPdfStatus(row.pdf_status)} · 메일 첨부 ${row.attached_to_mail ? "완료" : "대기"}`,
      targetId: row.id,
      documentId: row.id,
      createdAt: row.created_at,
    }));

    const items = [...auditItems, ...sendItems, ...documentItems]
      .filter((item) => type === "all" || item.type === type)
      .filter((item) => status === "all" || item.status === status || (status === "dry_run" && item.status === "dry_run"))
      .filter((item) => matchesQuery(q, item))
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, limit);

    return apiOk(requestId, {
      items,
      summary: {
        checks: items.filter((item) => item.type === "check").length,
        documents: items.filter((item) => item.type === "document").length,
        mails: items.filter((item) => item.type === "mail").length,
        failures: items.filter((item) => item.status === "failed").length,
      },
    });
  });
}

function normalizeLimit(value: string | null) {
  const parsed = Number(value ?? 100);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 100;
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

function matchesQuery(query: string, value: unknown) {
  if (!query) {
    return true;
  }
  return JSON.stringify(value).toLowerCase().includes(query);
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
