import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, apiOk, readJsonObject, requireRole, withApiHandler } from "@/lib/server/api";
import { writeAuditLog } from "@/lib/server/audit";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { getZendeskSettings } from "@/lib/server/settings";
import { buildTicketDraft, createZendeskTicket } from "@/lib/server/zendesk";
import {
  classifyTicketSendFailure,
  getStoredAutoSolveResult,
  isConfirmedTicketResult,
  RESULT_UNKNOWN_SUMMARY,
  ticketSendDisposition,
  type AutoSolveStatus,
  type ExistingTicketSend,
  type TicketSendStatus,
} from "@/lib/server/ticket-send-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TicketSendInput = {
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
  autoSolveStatus: AutoSolveStatus | null;
  autoSolveError: string | null;
  autoSolveRecordedAt: string | null;
  status: TicketSendStatus;
  errorSummary: string | null;
};

export function POST(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "operator");
    await enforceRateLimit("ticket-send:" + auth.user.id, 10, 60_000);
    const body = await readJsonObject(request);
    const settings = await getZendeskSettings(auth.supabase);
    const draft = buildTicketDraft(body, settings);
    const input: TicketSendInput = {
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
      // Keep the existing auto_solved column's request semantics for old readers.
      autoSolved: draft.autoSolve,
      autoSolveStatus: null,
      autoSolveError: null,
      autoSolveRecordedAt: null,
      status: "pending",
      // A lost process leaves a non-retryable reservation without inventing a solve outcome.
      errorSummary: RESULT_UNKNOWN_SUMMARY,
    };
    const reservation = await reserveTicketSend(auth.supabase, input);
    if (reservation.existing) {
      await writeSendAudit(
        auth.supabase, auth.user, "zendesk.ticket.send_duplicate", "zendesk_ticket",
        reservation.existing.zendesk_ticket_id,
        { requestId, idempotencyKey: draft.idempotencyKey, status: reservation.existing.status },
      );
      if (ticketSendDisposition(reservation.existing) !== "completed") {
        throw resultUnknownError(reservation.existing.zendesk_ticket_id);
      }
      return apiOk(requestId, {
        duplicate: true,
        dryRun: reservation.existing.status === "dry_run",
        ticketId: reservation.existing.zendesk_ticket_id,
        ticketUrl: reservation.existing.zendesk_ticket_url,
        ...getStoredAutoSolveResult(reservation.existing),
        previewPayload: null,
      });
    }

    let result: Awaited<ReturnType<typeof createZendeskTicket>>;
    try {
      result = await createZendeskTicket(draft);
    } catch (error) {
      const failure = classifyTicketSendFailure(error instanceof ApiError ? error.code : null, draft.dryRun);
      const recorded = await updateTicketSend(auth.supabase, {
        ...input, status: failure.status, errorSummary: failure.errorSummary,
      });
      await writeSendAudit(
        auth.supabase, auth.user,
        failure.retrySafe && recorded ? "zendesk.ticket.send_failed" : "zendesk.ticket.send_result_unknown",
        "zendesk_ticket", null,
        { requestId, idempotencyKey: draft.idempotencyKey, organizationId: draft.organizationId, autoSolve: draft.autoSolve },
      );
      if (!failure.retrySafe || !recorded) throw resultUnknownError();
      throw error;
    }

    if (!isConfirmedTicketResult(result)) {
      await updateTicketSend(auth.supabase, {
        ...input, zendeskTicketUrl: result.ticketUrl, errorSummary: RESULT_UNKNOWN_SUMMARY,
      });
      await writeSendAudit(auth.supabase, auth.user, "zendesk.ticket.send_result_unknown", "zendesk_ticket", null, {
        requestId, idempotencyKey: draft.idempotencyKey, reason: "missing_ticket_id",
      });
      throw resultUnknownError();
    }

    const autoSolveStatus: AutoSolveStatus = result.dryRun || !draft.autoSolve
      ? "not_requested"
      : result.autoSolveStatus === "solved" || result.autoSolveStatus === "failed"
        ? result.autoSolveStatus
        : "unknown";
    const autoSolveError = autoSolveStatus === "failed"
      ? result.autoSolveError?.trim() || "티켓은 생성되었지만 자동 해결에 실패했습니다. Zendesk에서 해결 상태를 확인하세요."
      : autoSolveStatus === "unknown" ? result.autoSolveError?.trim() || null : null;
    const autoSolveRecordedAt = new Date().toISOString();
    const recorded = await updateTicketSend(auth.supabase, {
      ...input,
      zendeskTicketId: result.ticketId,
      zendeskTicketUrl: result.ticketUrl,
      status: result.dryRun ? "dry_run" : "success",
      // Preserve legacy error_summary semantics for old readers during deployment.
      errorSummary: autoSolveStatus === "failed" ? autoSolveError : null,
      autoSolveStatus,
      autoSolveError,
      autoSolveRecordedAt,
    });
    if (!recorded) {
      // A failed write may have committed. The pending guard prevents this
      // best-effort fallback from overwriting an already successful record.
      await updateTicketSend(auth.supabase, {
        ...input,
        zendeskTicketId: result.ticketId,
        zendeskTicketUrl: result.ticketUrl,
        errorSummary: RESULT_UNKNOWN_SUMMARY,
      });
      await writeSendAudit(auth.supabase, auth.user, "zendesk.ticket.send_result_unknown", "zendesk_ticket", result.ticketId, {
        requestId, idempotencyKey: draft.idempotencyKey, reason: "history_update_unconfirmed", dryRun: result.dryRun,
      });
      // An ok response would let callers replace the idempotency key.
      throw resultUnknownError(result.ticketId);
    }

    await writeSendAudit(auth.supabase, auth.user, "zendesk.ticket.send", "zendesk_ticket", result.ticketId, {
      requestId, idempotencyKey: draft.idempotencyKey, dryRun: result.dryRun,
      organizationId: draft.organizationId, autoSolve: draft.autoSolve,
      autoSolveStatus, autoSolveRecordedAt, uploadCount: draft.uploadTokens.length,
    });
    if (autoSolveStatus === "failed") {
      await writeSendAudit(auth.supabase, auth.user, "zendesk.ticket.solve_failed", "zendesk_ticket", result.ticketId, {
        requestId, idempotencyKey: draft.idempotencyKey, error: autoSolveError,
      });
    }
    return apiOk(requestId, {
      dryRun: result.dryRun, duplicate: false, ticketId: result.ticketId, ticketUrl: result.ticketUrl,
      autoSolveRequested: draft.autoSolve,
      autoSolveStatus, autoSolveError, autoSolveRecordedAt, autoSolveEvidence: "recorded", previewPayload: result.payload,
    }, result.dryRun ? 202 : 201);
  });
}

async function reserveTicketSend(supabase: SupabaseClient, input: TicketSendInput): Promise<{ existing: ExistingTicketSend | null }> {
  const row = toTicketSendRow(input);
  let error: { code?: string } | null;
  try {
    ({ error } = await supabase.from("ticket_sends").insert(row));
  } catch {
    throw stateUnavailableError();
  }
  if (!error) return { existing: null };
  if (error.code !== "23505") throw stateUnavailableError();

  const existing = await findExistingTicketSend(supabase, input.sentBy, input.idempotencyKey);
  if (ticketSendDisposition(existing) !== "retry-safe") return { existing };

  // Reclaim only explicitly proven pre-creation failures. Compare-and-set
  // protects concurrent retries; neither old pending nor legacy failed qualifies.
  let claimed: { id: string } | null;
  try {
    const result = await supabase
      .from("ticket_sends")
      .update({ ...row, created_at: new Date().toISOString() })
      .eq("sent_by", input.sentBy)
      .eq("idempotency_key", input.idempotencyKey)
      .eq("status", "failed")
      .eq("error_summary", existing.error_summary)
      .is("zendesk_ticket_id", null)
      .is("zendesk_ticket_url", null)
      .select("id")
      .maybeSingle<{ id: string }>();
    if (result.error) throw stateUnavailableError();
    claimed = result.data;
  } catch {
    throw stateUnavailableError();
  }
  if (claimed) return { existing: null };
  return { existing: await findExistingTicketSend(supabase, input.sentBy, input.idempotencyKey) };
}

async function updateTicketSend(supabase: SupabaseClient, input: TicketSendInput): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("ticket_sends")
      .update(toTicketSendRow(input))
      .eq("sent_by", input.sentBy)
      .eq("idempotency_key", input.idempotencyKey)
      .eq("status", "pending")
      .select("id")
      .maybeSingle<{ id: string }>();
    if (!error && data) return true;
    console.error(JSON.stringify({
      level: "warn", message: "ticket_send_history_update_unconfirmed",
      idempotencyKey: input.idempotencyKey, status: input.status,
      error: error?.message ?? "No pending reservation was updated",
    }));
  } catch {
    console.error(JSON.stringify({
      level: "warn", message: "ticket_send_history_update_unconfirmed",
      idempotencyKey: input.idempotencyKey, status: input.status,
    }));
  }
  return false;
}

async function findExistingTicketSend(supabase: SupabaseClient, sentBy: string, idempotencyKey: string): Promise<ExistingTicketSend> {
  try {
    const { data, error } = await supabase
      .from("ticket_sends")
      .select("zendesk_ticket_id,zendesk_ticket_url,status,error_summary,auto_solved,auto_solve_status,auto_solve_error,auto_solve_recorded_at")
      .eq("sent_by", sentBy)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle<ExistingTicketSend>();
    if (error || !data) throw stateUnavailableError();
    return data;
  } catch {
    throw stateUnavailableError();
  }
}

function stateUnavailableError() {
  return new ApiError(503, "TICKET_SEND_STATE_UNAVAILABLE", "기존 발송 상태를 확인할 수 없습니다. 같은 중복 방지 키를 유지하고 발송 이력을 확인하세요.");
}

function resultUnknownError(ticketId: string | null = null) {
  return new ApiError(409, "TICKET_SEND_RESULT_UNKNOWN",
    "처리 중이거나 발송 결과를 확정할 수 없습니다. 새 요청으로 다시 보내지 말고 기존 발송 이력과 Zendesk 티켓을 확인하세요." +
    (ticketId ? " 확인할 티켓: #" + ticketId : ""),
  );
}

async function writeSendAudit(...args: Parameters<typeof writeAuditLog>) {
  try {
    await writeAuditLog(...args);
  } catch {
    // Audit transport failure must not turn a confirmed send into a generic
    // failure that encourages repeating the external side effect.
    console.error(JSON.stringify({ level: "warn", message: "ticket_send_audit_unavailable", action: args[2] }));
  }
}

function toTicketSendRow(input: TicketSendInput) {
  return {
    sent_by: input.sentBy, idempotency_key: input.idempotencyKey,
    zendesk_ticket_id: input.zendeskTicketId, zendesk_ticket_url: input.zendeskTicketUrl,
    organization_id: input.organizationId, requester_email: input.requesterEmail,
    group_id: input.groupId, assignee_email: input.assigneeEmail, subject: input.subject,
    attachment_count: input.attachmentCount, auto_solved: input.autoSolved,
    auto_solve_status: input.autoSolveStatus, auto_solve_error: input.autoSolveError,
    auto_solve_recorded_at: input.autoSolveRecordedAt,
    status: input.status, error_summary: input.errorSummary,
  };
}
