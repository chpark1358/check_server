import { SEARCH_LOAD_PLAN, type SearchLoadScenario, type SearchTransportResult } from "./search-load";

/** Response bodies remain inside this function. Only bounded aggregate metadata is returned. */
export async function readSearchResponse(response: Response, scenario: SearchLoadScenario["id"]): Promise<SearchTransportResult> {
  if (response.status !== 200) {
    void response.body?.cancel().catch(() => {});
    return { status: response.status, ok: false, decodedBytes: 0, resultCount: 0 };
  }
  const reader = response.body?.getReader();
  let decodedBytes = 0, text = "";
  const decoder = new TextDecoder();
  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        decodedBytes += value.byteLength;
        if (decodedBytes > SEARCH_LOAD_PLAN.maxDecodedBytes) {
          await reader.cancel();
          return { status: response.status, ok: false, decodedBytes, resultCount: 0 };
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
  }
  let data: Record<string, unknown> = {};
  try { const parsed: unknown = JSON.parse(text); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Record<string, unknown>; } catch { /* invalid JSON is an unsuccessful observation */ }
  const rows = scenario === "documents_search" ? data.documents : scenario === "admin_audit_search" ? data.auditLogs : data.items;
  const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const summary = record(data.summary), pageInfo = record(data.pageInfo);
  const matchedTotal = scenario === "admin_audit_search" ? pageInfo.total : scenario === "documents_search" ? summary.total :
    [summary.checks, summary.documents, summary.mails].every(value => typeof value === "number") ? Number(summary.checks) + Number(summary.documents) + Number(summary.mails) : undefined;
  return { status: response.status, ok: response.ok && data.ok === true && Array.isArray(rows), decodedBytes,
    resultCount: Array.isArray(rows) ? rows.length : 0, matchedTotal: typeof matchedTotal === "number" ? matchedTotal : undefined,
    requestId: typeof data.requestId === "string" ? data.requestId : undefined,
    vercelId: response.headers.get("x-vercel-id") ?? undefined, cache: response.headers.get("x-vercel-cache") ?? undefined };
}
