import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ApiError,
  apiOk,
  readJsonObject,
  requireRole,
  withApiHandler,
} from "@/lib/server/api";
import { writeAuditLog } from "@/lib/server/audit";
import { enforceMemoryRateLimit } from "@/lib/server/rate-limit";
import { getZendeskSettings } from "@/lib/server/settings";
import {
  buildTicketDraft,
  createZendeskTicket,
} from "@/lib/server/zendesk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TicketSendStatus = "pending" | "success" | "failed" | "dry_run";

const STALE_PENDING_MS = 10 * 60 * 1000;

export function POST(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "operator");
    enforceMemoryRateLimit(`ticket-send:${auth.user.id}`, 10, 60_000);

    const body = await readJsonObject(request);
    const settings = await getZendeskSettings(auth.supabase);
    const draft = buildTicketDraft(body, settings);
    const reservation = await reserveTicketSend(auth.supabase, {
      sentBy: auth.user.id,
      idempotencyKey: draft.idempotencyKey,
      zendeskTicketId: null,
      zendeskTicketUrl: null,
      organizationId: draft.organizationId,
      requesterEmail: draft.requesterEmail,
      groupId: draft.groupId,
      assigneeEmail: draft.assigneeEmail,
      subject: draft.subject,
      attachmentCount: draft.uploadTokens.length,
      autoSolved: draft.autoSolve,
      status: "pending",
      errorSummary: null,
    });

    if (reservation.existing) {
      await writeAuditLog(
        auth.supabase,
        auth.user,
        "zendesk.ticket.send_duplicate",
        "zendesk_ticket",
        reservation.existing.zendesk_ticket_id,
        {
          requestId,
          idempotencyKey: draft.idempotencyKey,
          status: reservation.existing.status,
        },
      );

      if (reservation.existing.status === "pending") {
        throw new ApiError(
          409,
          "TICKET_SEND_IN_PROGRESS",
          "같은 발송 요청이 이미 처리 중입니다. 잠시 후 발송 이력을 확인하세요.",
        );
      }

      return apiOk(requestId, {
        duplicate: true,
        dryRun: reservation.existing.status === "dry_run",
        ticketId: reservation.existing.zendesk_ticket_id,
        ticketUrl: reservation.existing.zendesk_ticket_url,
        previewPayload: null,
      });
    }

    const result = await createZendeskTicket(draft).catch(async (error: unknown) => {
      await updateTicketSend(auth.supabase, {
        sentBy: auth.user.id,
        idempotencyKey: draft.idempotencyKey,
        zendeskTicketId: null,
        zendeskTicketUrl: null,
        organizationId: draft.organizationId,
        requesterEmail: draft.requesterEmail,
        groupId: draft.groupId,
        assigneeEmail: draft.assigneeEmail,
        subject: draft.subject,
        attachmentCount: draft.uploadTokens.length,
        autoSolved: draft.autoSolve,
        status: "failed",
        errorSummary: error instanceof Error ? error.message : "Unknown error",
      });

      await writeAuditLog(auth.supabase, auth.user, "zendesk.ticket.send_failed", "zendesk_ticket", null, {
        requestId,
        organizationId: draft.organizationId,
        autoSolve: draft.autoSolve,
      });

      throw error;
    });

    await updateTicketSend(auth.supabase, {
      sentBy: auth.user.id,
      idempotencyKey: draft.idempotencyKey,
      zendeskTicketId: result.ticketId,
      zendeskTicketUrl: result.ticketUrl,
      organizationId: draft.organizationId,
      requesterEmail: draft.requesterEmail,
      groupId: draft.groupId,
      assigneeEmail: draft.assigneeEmail,
      subject: draft.subject,
      attachmentCount: draft.uploadTokens.length,
      autoSolved: draft.autoSolve,
      status: result.dryRun ? "dry_run" : "success",
      errorSummary: null,
    });

    await writeAuditLog(auth.supabase, auth.user, "zendesk.ticket.send", "zendesk_ticket", result.ticketId, {
      requestId,
      idempotencyKey: draft.idempotencyKey,
      dryRun: result.dryRun,
      organizationId: draft.organizationId,
      autoSolve: draft.autoSolve,
      uploadCount: draft.uploadTokens.length,
    });

    return apiOk(
      requestId,
      {
        dryRun: result.dryRun,
        duplicate: false,
        ticketId: result.ticketId,
        ticketUrl: result.ticketUrl,
        previewPayload: result.payload,
      },
      result.dryRun ? 202 : 201,
    );
  });
}

async function reserveTicketSend(
  supabase: SupabaseClient,
  input: {
    sentBy: string;
    idempotencyKey: string;
    zendeskTicketId: string | null;
    zendeskTicketUrl: string | null;
    organizationId: string | null;
    requesterEmail: string | null;
    groupId: string | null;
    assigneeEmail: string | null;
    subject: string;
    attachmentCount: number;
    autoSolved: boolean;
    status: TicketSendStatus;
    errorSummary: string | null;
  },
) {
  const row = toTicketSendRow(input);
  const { error } = await supabase.from("ticket_sends").insert(row);

  if (!error) {
    return { existing: null };
  }

  if (error.code !== "23505") {
    throw new ApiError(500, "TICKET_SEND_RESERVATION_FAILED", "발송 요청을 예약할 수 없습니다.");
  }

  const existing = await findExistingTicketSend(supabase, input.sentBy, input.idempotencyKey);

  if (existing && existing.status === "pending") {
    const staleThreshold = new Date(Date.now() - STALE_PENDING_MS).toISOString();
    const { data: claimed, error: claimError } = await supabase
      .from("ticket_sends")
      .update({ ...row, created_at: new Date().toISOString() })
      .eq("sent_by", input.sentBy)
      .eq("idempotency_key", input.idempotencyKey)
      .eq("status", "pending")
      .lt("created_at", staleThreshold)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (claimError) {
      console.error(
        JSON.stringify({
          level: "warn",
          message: "ticket_send_stale_reclaim_failed",
          idempotencyKey: input.idempotencyKey,
          error: claimError.message,
        }),
      );
    }

    if (claimed) {
      return { existing: null };
    }
  }

  return { existing };
}

async function updateTicketSend(
  supabase: SupabaseClient,
  input: {
    sentBy: string;
    idempotencyKey: string;
    zendeskTicketId: string | null;
    zendeskTicketUrl: string | null;
    organizationId: string | null;
    requesterEmail: string | null;
    groupId: string | null;
    assigneeEmail: string | null;
    subject: string;
    attachmentCount: number;
    autoSolved: boolean;
    status: TicketSendStatus;
    errorSummary: string | null;
  },
) {
  const { error } = await supabase
    .from("ticket_sends")
    .update(toTicketSendRow(input))
    .eq("sent_by", input.sentBy)
    .eq("idempotency_key", input.idempotencyKey);

  if (error) {
    console.error(
      JSON.stringify({
        level: "warn",
        message: "ticket_send_history_update_failed",
        idempotencyKey: input.idempotencyKey,
        status: input.status,
        error: error.message,
      }),
    );
  }
}

async function findExistingTicketSend(
  supabase: SupabaseClient,
  sentBy: string,
  idempotencyKey: string,
) {
  const { data, error } = await supabase
    .from("ticket_sends")
    .select("zendesk_ticket_id,zendesk_ticket_url,status")
    .eq("sent_by", sentBy)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle<{
      zendesk_ticket_id: string | null;
      zendesk_ticket_url: string | null;
      status: TicketSendStatus;
    }>();

  if (error) {
    console.error(
      JSON.stringify({
        level: "warn",
        message: "ticket_send_idempotency_lookup_failed",
        idempotencyKey,
        error: error.message,
      }),
    );
  }

  return data ?? null;
}

function toTicketSendRow(input: {
  sentBy: string;
  idempotencyKey: string;
  zendeskTicketId: string | null;
  zendeskTicketUrl: string | null;
  organizationId: string | null;
  requesterEmail: string | null;
  groupId: string | null;
  assigneeEmail: string | null;
  subject: string;
  attachmentCount: number;
  autoSolved: boolean;
  status: TicketSendStatus;
  errorSummary: string | null;
}) {
  return {
    sent_by: input.sentBy,
    idempotency_key: input.idempotencyKey,
    zendesk_ticket_id: input.zendeskTicketId,
    zendesk_ticket_url: input.zendeskTicketUrl,
    organization_id: input.organizationId,
    requester_email: input.requesterEmail,
    group_id: input.groupId,
    assignee_email: input.assigneeEmail,
    subject: input.subject,
    attachment_count: input.attachmentCount,
    auto_solved: input.autoSolved,
    status: input.status,
    error_summary: input.errorSummary,
  };
}
