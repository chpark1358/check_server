// Pure policy: this module deliberately has no network or database dependencies.
export type TicketSendStatus = "pending" | "success" | "failed" | "dry_run";

export type ExistingTicketSend = {
  zendesk_ticket_id: string | null;
  zendesk_ticket_url: string | null;
  status: TicketSendStatus;
  error_summary: string | null;
};

export const RETRY_SAFE_PREFIX = "[TICKET_SEND_RETRY_SAFE] ";
export const RESULT_UNKNOWN_PREFIX = "[TICKET_SEND_RESULT_UNKNOWN] ";
export const RESULT_UNKNOWN_SUMMARY =
  `${RESULT_UNKNOWN_PREFIX}발송 결과를 확정할 수 없습니다. 새 요청으로 다시 보내지 말고 기존 발송 이력과 Zendesk 티켓을 확인하세요.`;

// These errors are raised before the ticket POST in createZendeskTicket.
// Transport errors, generic upstream errors and legacy failed rows do not prove
// that Zendesk rejected or never received the creation request.
const PRE_SEND_FAILURE_CODES = new Set([
  "ZENDESK_NOT_CONFIGURED",
  "ZENDESK_OAUTH_NOT_CONFIGURED",
  "ZENDESK_OAUTH_CONFIG_INVALID",
  "ZENDESK_OAUTH_TOKEN_FAILED",
  "ZENDESK_ASSIGNEE_NOT_FOUND",
  "ZENDESK_FIELD_OPTION_NOT_FOUND",
]);

export function classifyTicketSendFailure(code: string | null, dryRunRequested: boolean) {
  const retrySafe = dryRunRequested || (code !== null && PRE_SEND_FAILURE_CODES.has(code));
  return {
    status: retrySafe ? ("failed" as const) : ("pending" as const),
    errorSummary: retrySafe
      ? `${RETRY_SAFE_PREFIX}${code ?? "DRY_RUN_FAILED"}: 티켓 생성 전 실패가 확인되었습니다.`
      : RESULT_UNKNOWN_SUMMARY,
    retrySafe,
  };
}

export function ticketSendDisposition(existing: ExistingTicketSend | null) {
  if (!existing) return "unavailable" as const;
  if (existing.status === "dry_run") return "completed" as const;
  if (existing.status === "success" && existing.zendesk_ticket_id?.trim()) return "completed" as const;
  if (
    existing.status === "failed" &&
    !existing.zendesk_ticket_id &&
    !existing.zendesk_ticket_url &&
    existing.error_summary?.startsWith(RETRY_SAFE_PREFIX)
  ) {
    return "retry-safe" as const;
  }
  // pending is never reclaimed by age: a timeout is not proof of non-delivery.
  return "unknown" as const;
}

export function isConfirmedTicketResult(result: { dryRun: boolean; ticketId: string | null }) {
  return result.dryRun || Boolean(result.ticketId?.trim());
}
