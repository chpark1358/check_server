import { SEARCH_LOAD_PLAN, SEARCH_SERVER_PHASES, normalizeSearchDeployment, normalizeSearchTiming,
  type SearchLoadScenario, type SearchTiming, type SearchServerPhase, type SearchTransportResult } from "./search-load";

export type SearchResponseClock = { fetchStartedAt: number; responseReceivedAt: number; now?: () => number };

// Header descriptions may contain commas and semicolons. Do not split quoted
// descriptions into fake metrics, or retain descriptions as diagnostic output.
function splitHeader(value: string, delimiter: string): string[] {
  let quoted = false, escaped = false, start = 0;
  const parts: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (escaped) { escaped = false; continue; }
    if (char === "\\" && quoted) { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === delimiter && !quoted) { parts.push(value.slice(start, index)); start = index + 1; }
  }
  if (quoted || escaped) return [];
  parts.push(value.slice(start));
  return parts;
}

/** Only allowlisted durations survive; no description, arbitrary field or ID does. */
export function parseSearchServerTiming(header: string | null): Pick<SearchTiming, "server" | "serverTimingStatus"> {
  if (!header) return { server: null, serverTimingStatus: "missing" };
  const invalid = { server: null, serverTimingStatus: "invalid" as const };
  if (header.length > 8192) return invalid;
  const metrics = splitHeader(header, ",");
  if (!metrics.length) return invalid;
  const server: Partial<Record<SearchServerPhase, number>> = {};
  for (const metric of metrics) {
    const [name, ...parameters] = splitHeader(metric, ";").map(part => part.trim());
    if (!SEARCH_SERVER_PHASES.includes(name as SearchServerPhase)) continue;
    const key = name as SearchServerPhase;
    if (Object.hasOwn(server, key)) return invalid;
    const durations = parameters.filter(parameter => /^dur\s*(?:=|$)/i.test(parameter));
    if (durations.length !== 1) return invalid;
    const match = /^dur\s*=\s*(?:"(\d+(?:\.\d+)?)"|(\d+(?:\.\d+)?))$/i.exec(durations[0]);
    if (!match) return invalid;
    const ms = Number(match[1] ?? match[2]);
    if (!Number.isFinite(ms) || ms > 60_000) return invalid;
    server[key] = ms;
  }
  if (server.server === undefined) return Object.keys(server).length ? invalid : { server: null, serverTimingStatus: "missing" };
  return { server, serverTimingStatus: "valid" };
}

function elapsed(start: number | undefined, end: number | undefined): number | null {
  return typeof start === "number" && typeof end === "number" && Number.isFinite(start) && Number.isFinite(end) &&
    end >= start && end - start <= 60_000 ? Math.round((end - start) * 100) / 100 : null;
}

/** Response bodies remain inside this function. Only bounded aggregate metadata is returned. */
export async function readSearchResponse(response: Response, scenario: SearchLoadScenario["id"], clock?: SearchResponseClock): Promise<SearchTransportResult> {
  const now = clock?.now ?? (() => performance.now());
  const bodyStarted = now();
  const serverTrace = parseSearchServerTiming(response.headers.get("server-timing"));
  const deployment = normalizeSearchDeployment({ revision: response.headers.get("x-search-revision"),
    variant: response.headers.get("x-search-variant") as "baseline" | "optimized" | null, region: response.headers.get("x-search-region") });
  const observation = (bodyEnded?: number, parsedAt?: number) => ({
    deployment,
    timing: normalizeSearchTiming({ fetchToHeadersMs: elapsed(clock?.fetchStartedAt, clock?.responseReceivedAt),
      bodyReadMs: elapsed(bodyStarted, bodyEnded), jsonParseMs: elapsed(bodyEnded, parsedAt),
      responseTotalMs: elapsed(clock?.fetchStartedAt, parsedAt), ...serverTrace }),
  });
  if (response.status !== 200) {
    void response.body?.cancel().catch(() => {});
    return { status: response.status, ok: false, decodedBytes: 0, resultCount: 0, ...observation() };
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
          return { status: response.status, ok: false, decodedBytes, resultCount: 0, ...observation(now()) };
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
  }
  const bodyEnded = now();
  let data: Record<string, unknown> = {};
  try { const parsed: unknown = JSON.parse(text); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Record<string, unknown>; } catch { /* invalid JSON is an unsuccessful observation */ }
  const parsedAt = now();
  const rows = scenario === "documents_search" ? data.documents : scenario === "admin_audit_search" ? data.auditLogs : data.items;
  const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const summary = record(data.summary), pageInfo = record(data.pageInfo);
  const matchedTotal = scenario === "admin_audit_search" ? pageInfo.total : scenario === "documents_search" ? summary.total :
    [summary.checks, summary.documents, summary.mails].every(value => typeof value === "number") ? Number(summary.checks) + Number(summary.documents) + Number(summary.mails) : undefined;
  return { status: response.status, ok: response.ok && data.ok === true && Array.isArray(rows), decodedBytes,
    resultCount: Array.isArray(rows) ? rows.length : 0, matchedTotal: typeof matchedTotal === "number" ? matchedTotal : undefined,
    requestId: typeof data.requestId === "string" ? data.requestId : undefined,
    vercelId: response.headers.get("x-vercel-id") ?? undefined, cache: response.headers.get("x-vercel-cache") ?? undefined,
    ...observation(bodyEnded, parsedAt) };
}
