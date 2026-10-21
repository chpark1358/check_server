export type TicketSendResponse = {
  dryRun: boolean;
  duplicate: boolean;
  ticketId: string | null;
  ticketUrl: string | null;
  autoSolveStatus?: "not_requested" | "solved" | "failed" | "unknown";
  autoSolveRequested?: boolean;
  autoSolveError?: string | null;
};

export function getAutoSolveWarning(response: TicketSendResponse): string | null {
  if (response.dryRun) return null;
  if (response.autoSolveStatus === "failed") {
    return `티켓은 생성됐지만 자동 해결에 실패했습니다. ${response.autoSolveError || "Zendesk 필수 필드 또는 권한을 확인하세요."} 티켓을 다시 생성하지 말고 기존 티켓을 확인하세요.`;
  }
  if (response.autoSolveStatus === "unknown") {
    return "기존 티켓의 자동 해결 결과는 저장된 기록만으로 확인할 수 없습니다. 티켓을 다시 생성하지 말고 기존 티켓의 상태를 확인하세요.";
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
}) {
  if (item.status === "sent") {
    if (item.sendMode === "dry-run") return "테스트 완료";
    return item.sendWarning ? "티켓 생성 · 해결 확인 필요" : "티켓 생성";
  }
  return item.status === "sending" ? "처리 중" : item.status === "failed" ? "확인 필요" : "대기";
}
