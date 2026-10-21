// Pure policy: this module deliberately has no network or database dependencies.
export type TicketSendStatus = "pending" | "success" | "failed" | "dry_run";
export type AutoSolveStatus = "not_requested" | "solved" | "failed" | "unknown";

type StoredAutoSolveFields = {
  auto_solve_status?: string | null;
  auto_solve_error?: string | null;
  auto_solve_recorded_at?: string | null;
};

export type ExistingTicketSend = StoredAutoSolveFields & {
  zendesk_ticket_id: string | null;
  zendesk_ticket_url: string | null;
  status: TicketSendStatus;
  error_summary: string | null;
  // Legacy column name: this records the request, not successful resolution.
  auto_solved: boolean;
};

export function getStoredAutoSolveResult(row: StoredAutoSolveFields & {
  status: string;
  auto_solved: boolean;
  error_summary: string | null;
}): {
  autoSolveRequested: boolean;
  autoSolveStatus: AutoSolveStatus;
  autoSolveError: string | null;
  autoSolveRecordedAt: string | null;
  autoSolveEvidence: "recorded" | "legacy";
} {
  const autoSolveRequested = row.auto_solved === true;
  if (
    isAutoSolveStatus(row.auto_solve_status) &&
    typeof row.auto_solve_recorded_at === "string" &&
    Number.isFinite(Date.parse(row.auto_solve_recorded_at))
  ) {
    return {
      autoSolveRequested,
      autoSolveStatus: row.auto_solve_status,
      autoSolveError: row.auto_solve_error ?? null,
      autoSolveRecordedAt: row.auto_solve_recorded_at,
      autoSolveEvidence: "recorded",
    };
  }
  const legacy = { autoSolveRequested, autoSolveRecordedAt: null, autoSolveEvidence: "legacy" as const };
  if (row.status === "dry_run" || row.auto_solved === false) {
    return { ...legacy, autoSolveStatus: "not_requested", autoSolveError: null };
  }
  if (autoSolveRequested && row.status === "success" && row.error_summary?.trim()) {
    return { ...legacy, autoSolveStatus: "failed", autoSolveError: row.error_summary };
  }
  // No persisted outcome exists for a requested solve without an error. Absence
  // of an error is not enough to turn legacy request history into proof of success.
  return { ...legacy, autoSolveStatus: "unknown", autoSolveError: null };
}

function isAutoSolveStatus(value: unknown): value is AutoSolveStatus {
  return value === "not_requested" || value === "solved" || value === "failed" || value === "unknown";
}

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
