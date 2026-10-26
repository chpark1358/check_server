export type AutoSolveOutcome = {
  autoSolveStatus?: "not_requested" | "solved" | "failed" | "unknown";
  autoSolveRequested?: boolean;
  autoSolveError?: string | null;
  autoSolveRecordedAt?: string | null;
  autoSolveEvidence?: "recorded" | "legacy";
};

export type CcRecipientRecord = {
  ccEmails?: string[] | null;
  ccEvidence?: "recorded" | "legacy";
};

export function formatCcRecipients(record: CcRecipientRecord): string {
  if (record.ccEvidence === "legacy" || record.ccEmails == null) return "CC 기록 없음 (이전 이력)";
  return record.ccEmails.length ? `요청 CC: ${record.ccEmails.join(", ")}` : "참조 없음";
}

export type TicketSendResponse = AutoSolveOutcome & CcRecipientRecord & {
  dryRun: boolean;
  duplicate: boolean;
  ticketId: string | null;
  ticketUrl: string | null;
};

export function formatAutoSolveLabel(outcome: AutoSolveOutcome) {
  const status = outcome.autoSolveStatus ?? (outcome.autoSolveRequested === false ? "not_requested" : "unknown");
  return status === "solved" ? "자동 해결 완료" : status === "failed" ? "자동 해결 실패" : status === "not_requested" ? "자동 해결 미요청" : "자동 해결 미확인";
}

export function formatAutoSolveRecord(outcome: AutoSolveOutcome): string | null {
  if (outcome.autoSolveEvidence === "legacy") {
    return "이전 이력에는 자동 해결 결과가 별도 저장되지 않았습니다.";
  }
  if (outcome.autoSolveEvidence !== "recorded" || !outcome.autoSolveRecordedAt) return null;
  const date = new Date(outcome.autoSolveRecordedAt);
  if (Number.isNaN(date.getTime())) return "결과 저장 시각을 확인할 수 없습니다.";
  const label = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
  return `결과 저장 시각: ${label} (KST). Zendesk의 실제 해결 시각과 다를 수 있습니다.`;
}

export function getAutoSolveWarning(response: TicketSendResponse): string | null {
  if (response.dryRun) return null;
  if (response.autoSolveStatus === "failed") {
    return `티켓은 생성됐지만 자동 해결에 실패했습니다. ${response.autoSolveError || "Zendesk 필수 필드 또는 권한을 확인하세요."} 티켓을 다시 생성하지 말고 기존 티켓을 확인하세요.`;
  }
  if (response.autoSolveStatus === "unknown") {
    return `기존 티켓의 자동 해결 결과는 저장된 기록만으로 확인할 수 없습니다.${response.autoSolveError ? ` ${response.autoSolveError}` : ""} 티켓을 다시 생성하지 말고 기존 티켓의 상태를 확인하세요.`;
  }
  return null;
}

export function getBatchSendOutcome(response: TicketSendResponse) {
  return {
    // Ticket creation succeeded even when its subsequent solve request failed.
    status: "sent" as const,
    error: null,
    sendWarning: getAutoSolveWarning(response),
    sendTicketId: response.ticketId,
    sendTicketUrl: response.ticketUrl,
    sendMode: response.dryRun ? "dry-run" as const : "real" as const,
    sendAutoSolveStatus: response.dryRun ? "not_requested" as const : response.autoSolveStatus,
    sendAutoSolveRecordedAt: response.autoSolveRecordedAt ?? null,
    sendAutoSolveEvidence: response.autoSolveEvidence,
    sendCcEmails: response.ccEmails ?? null,
    sendCcEvidence: response.ccEvidence ?? "legacy" as const,
  };
}

export function isBatchSendEligible(
  item: { status: string; sendMode: string | null },
  mode: "dry-run" | "real",
) {
  return item.status !== "sent" || (mode === "real" && item.sendMode === "dry-run");
}

export function formatBatchSendResult(item: {
  status: string;
  sendMode: string | null;
  sendWarning?: string | null;
  sendAutoSolveStatus?: AutoSolveOutcome["autoSolveStatus"];
}) {
  if (item.status === "sent") {
    if (item.sendMode === "dry-run") return "테스트 완료";
    return item.sendWarning ? "티켓 생성 · 해결 확인 필요" : item.sendAutoSolveStatus === "solved" ? "티켓 생성 · 자동 해결 완료" : "티켓 생성";
  }
  return item.status === "sending" ? "처리 중" : item.status === "failed" ? "확인 필요" : "대기";
}
