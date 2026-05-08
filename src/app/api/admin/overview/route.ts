import type { NextRequest } from "next/server";
import { apiOk, requireRole, withApiHandler } from "@/lib/server/api";
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

export function GET(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "admin");
    const limit = normalizeLimit(request.nextUrl.searchParams.get("limit"));
    const q = (request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
    const action = (request.nextUrl.searchParams.get("action") ?? "").trim();
    const status = (request.nextUrl.searchParams.get("status") ?? "").trim();
    const auditIntent = request.nextUrl.searchParams.get("audit");
    const sourceLimit = q || action || status ? Math.max(limit, 1000) : limit;
    if (auditIntent === "search") {
      await writeAuditLog(
        auth.supabase,
        auth.user,
        "admin.overview.search",
        "admin_console",
        null,
        {
          requestId,
          q: q ? q.slice(0, 80) : null,
          action: action || null,
          status: status || null,
          limit,
        },
      );
    }

    let auditQuery = auth.supabase
      .from("audit_logs")
      .select("id,actor_id,action,target_type,target_id,metadata,created_at")
      .order("created_at", { ascending: false });
    if (action) {
      auditQuery = auditQuery.eq("action", action);
    }

    let sendsQuery = auth.supabase
      .from("ticket_sends")
      .select(
        "id,sent_by,zendesk_ticket_id,zendesk_ticket_url,organization_id,requester_email,group_id,assignee_email,subject,attachment_count,auto_solved,status,error_summary,created_at",
      )
      .order("created_at", { ascending: false });
    if (status) {
      sendsQuery = sendsQuery.eq("status", status);
    }

    const [profilesResult, usersResult, auditResult, sendsResult, documentsResult] =
      await Promise.all([
        auth.supabase
          .from("profiles")
          .select("id,email,display_name,role,created_at,updated_at")
          .order("created_at", { ascending: false }),
        auth.supabase.auth.admin.listUsers({ page: 1, perPage: 200 }),
        auditQuery.limit(sourceLimit),
        sendsQuery.limit(sourceLimit),
        auth.supabase
          .from("generated_documents")
          .select("id,created_by,company_name,serial,engineer_name,pdf_status,attached_to_mail,created_at,expires_at")
          .order("created_at", { ascending: false })
          .limit(sourceLimit),
      ]);

    if (profilesResult.error) {
      throw new Error(profilesResult.error.message);
    }
    if (auditResult.error) {
      throw new Error(auditResult.error.message);
    }
    if (sendsResult.error) {
      throw new Error(sendsResult.error.message);
    }
    if (documentsResult.error) {
      throw new Error(documentsResult.error.message);
    }

    const profiles = (profilesResult.data ?? []) as ProfileRow[];
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const authUsers = usersResult.error ? [] : usersResult.data.users;
    const users = profiles.map((profile) => {
      const authUser = authUsers.find((user) => user.id === profile.id);
      return {
        id: profile.id,
        email: profile.email ?? authUser?.email ?? null,
        displayName: profile.display_name,
        role: profile.role ?? "viewer",
        createdAt: profile.created_at,
        updatedAt: profile.updated_at,
        invitedAt: authUser?.invited_at ?? null,
        emailConfirmedAt: authUser?.email_confirmed_at ?? null,
        lastSignInAt: authUser?.last_sign_in_at ?? null,
      };
    });

    const auditLogs = ((auditResult.data ?? []) as AuditLogRow[])
      .filter((row) => !action || row.action === action)
      .filter((row) => matchesQuery(q, row))
      .map((row) => ({
        id: row.id,
        actorId: row.actor_id,
        actorEmail: stringMeta(row.metadata, "actorEmail") ?? profileById.get(row.actor_id ?? "")?.email ?? null,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        metadata: sanitizeAdminMetadata(row.metadata ?? {}),
        createdAt: row.created_at,
      }));

    const ticketSends = ((sendsResult.data ?? []) as TicketSendRow[])
      .filter((row) => !status || row.status === status)
      .filter((row) => matchesQuery(q, row))
      .map((row) => ({
        id: row.id,
        sentBy: row.sent_by,
        actorEmail: profileById.get(row.sent_by)?.email ?? null,
        zendeskTicketId: row.zendesk_ticket_id,
        zendeskTicketUrl: row.zendesk_ticket_url,
        organizationId: row.organization_id,
        requesterEmail: row.requester_email,
        groupId: row.group_id,
        assigneeEmail: row.assignee_email,
        subject: row.subject,
        attachmentCount: row.attachment_count,
        autoSolved: row.auto_solved,
        status: row.status,
        errorSummary: row.error_summary,
        createdAt: row.created_at,
      }));

    const documents = ((documentsResult.data ?? []) as GeneratedDocumentRow[])
      .filter((row) => matchesQuery(q, row))
      .map((row) => ({
        id: row.id,
        createdBy: row.created_by,
        actorEmail: profileById.get(row.created_by)?.email ?? null,
        companyName: row.company_name,
        serial: row.serial,
        engineerName: row.engineer_name,
        pdfStatus: row.pdf_status,
        attachedToMail: row.attached_to_mail,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      }));

    return apiOk(requestId, {
      users,
      auditLogs,
      ticketSends,
      documents,
      summary: buildSummary(auditLogs, ticketSends, documents, users),
      authUserLookupWarning: usersResult.error ? usersResult.error.message : null,
    });
  });
}

function normalizeLimit(value: string | null) {
  const parsed = Number(value ?? 100);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 100;
}

function matchesQuery(query: string, value: unknown): boolean {
  if (!query) {
    return true;
  }
  return JSON.stringify(value).toLowerCase().includes(query);
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

function buildSummary(
  auditLogs: Array<{ action: string; createdAt: string }>,
  ticketSends: Array<{ status: string; createdAt: string }>,
  documents: Array<{ createdAt: string }>,
  users: Array<{ invitedAt: string | null; emailConfirmedAt: string | null }>,
) {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const isRecent = (value: string) => new Date(value).getTime() >= since;

  return {
    auditEvents24h: auditLogs.filter((row) => isRecent(row.createdAt)).length,
    documents24h: documents.filter((row) => isRecent(row.createdAt)).length,
    ticketSends24h: ticketSends.filter((row) => isRecent(row.createdAt)).length,
    failedTicketSends: ticketSends.filter((row) => row.status === "failed").length,
    pendingInvites: users.filter((user) => Boolean(user.invitedAt) && !user.emailConfirmedAt).length,
  };
}
