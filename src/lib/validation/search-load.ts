// Client-safe, bounded observations. Transport owns authentication and consumes
// the entire response before returning aggregate metadata; it never returns rows.
export const SEARCH_LOAD_PLAN = Object.freeze({
  requests: 76, hardBudget: 100, rps: 2, intervalMs: 500,
  timeoutMs: 10_000, maxDecodedBytes: 2 * 1024 * 1024, samplesPerTier: 6,
  concurrencyCaps: Object.freeze([1, 2, 4]),
});

export type SearchLoadScenario = Readonly<{
  id: "history_summary" | "history_without_summary" | "documents_search" | "admin_audit_search";
  path: "/api/history/overview" | "/api/documents" | "/api/admin/overview";
  params: Readonly<Record<string, string>>;
}>;
export const SEARCH_LOAD_SCENARIOS: readonly SearchLoadScenario[] = Object.freeze([
  Object.freeze({ id: "history_summary" as const, path: "/api/history/overview" as const,
    params: Object.freeze({ range: "all", limit: "50", q: "24123103", includeSummary: "true" }) }),
  Object.freeze({ id: "history_without_summary" as const, path: "/api/history/overview" as const,
    params: Object.freeze({ range: "all", limit: "50", q: "24123103", includeSummary: "false" }) }),
  Object.freeze({ id: "documents_search" as const, path: "/api/documents" as const,
    params: Object.freeze({ range: "all", limit: "50", q: "24123103" }) }),
  Object.freeze({ id: "admin_audit_search" as const, path: "/api/admin/overview" as const,
    params: Object.freeze({ section: "audit", range: "all", limit: "25", q: "24123103" }) }),
]);

export type SearchLoadMetadata = {
  status: number; ok: boolean; decodedBytes: number; resultCount: number;
  matchedTotal?: number | null; requestId?: string | null; vercelId?: string | null; cache?: string | null;
};
export type SearchTransportInput = { scenario: SearchLoadScenario; path: string; signal: AbortSignal };
export type SearchTransportResult = SearchLoadMetadata;
export type SearchLoadTransport = (input: SearchTransportInput) => Promise<SearchTransportResult>;
export type SearchLoadPhase = "first_observed" | "repeated";
export type SearchLoadSample = {
  ordinal: number; scenario: SearchLoadScenario["id"]; path: SearchLoadScenario["path"];
  phase: SearchLoadPhase; concurrencyCap: number; inFlightAtDispatch: number;
  startedAt: string; durationMs: number; status: number | null; decodedBytes: number;
  resultCount: number | null; matchedTotal: number | null; requestId: string | null;
  vercelId: string | null; cache: string | null; error: string | null;
};
export type SearchLoadSummary = {
  scenario: SearchLoadScenario["id"]; phase: SearchLoadPhase; concurrencyCap: number;
  requests: number; successful: number; failures: number; peakObservedInFlight: number;
  p50Ms: number | null; p95Ms: number | null; minMs: number | null; maxMs: number | null;
  decodedBytesMin: number | null; decodedBytesMax: number | null;
  resultCountMin: number | null; resultCountMax: number | null;
};
export type SearchLoadProgress = {
  completedRequests: number; plannedRequests: number; currentScenario: SearchLoadScenario["id"];
  phase: SearchLoadPhase; concurrencyCap: number; stoppedReason: string | null;
};
export type SearchLoadReport = {
  schemaVersion: 1; startedAt: string; endedAt: string; completed: boolean; stoppedReason: string | null;
  plan: typeof SEARCH_LOAD_PLAN; requests: SearchLoadSample[]; summary: SearchLoadSummary[];
  limitations: string[];
};
export type SearchLoadClock = {
  now: () => number;
  wallTime: () => string;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
};

const defaultClock: SearchLoadClock = {
  now: () => performance.now(), wallTime: () => new Date().toISOString(),
  sleep: (ms, signal) => new Promise(resolve => {
    if (signal.aborted) return resolve();
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  }),
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export function searchLoadRequestPath(scenario: SearchLoadScenario): string {
  // Identity, rather than caller-supplied strings, prevents expansion to arbitrary
  // endpoints or GET parameters such as admin audit=search (which writes a log).
  if (!SEARCH_LOAD_SCENARIOS.includes(scenario)) throw new Error("Unsupported search measurement scenario.");
  return scenario.path + "?" + new URLSearchParams(scenario.params).toString();
}

const cleanId = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_:-]{1,160}$/.test(value) ? value : null;
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

export function summarizeSearchLoad(samples: readonly SearchLoadSample[]): SearchLoadSummary[] {
  const groups = new Map<string, SearchLoadSample[]>();
  for (const sample of samples) {
    const key = `${sample.scenario}:${sample.phase}:${sample.concurrencyCap}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(sample);
  }
  return [...groups.values()].map(group => {
    const successful = group.filter(sample => sample.status === 200 && !sample.error);
    const timings = successful.map(sample => sample.durationMs).sort((a, b) => a - b);
    const quantile = (p: number) => timings.length ? timings[Math.max(0, Math.ceil(timings.length * p) - 1)] : null;
    const bytes = successful.map(sample => sample.decodedBytes);
    const counts = successful.flatMap(sample => sample.resultCount === null ? [] : [sample.resultCount]);
    return { scenario: group[0].scenario, phase: group[0].phase, concurrencyCap: group[0].concurrencyCap,
      requests: group.length, successful: timings.length, failures: group.length - timings.length,
      peakObservedInFlight: Math.max(...group.map(sample => sample.inFlightAtDispatch)),
      p50Ms: quantile(0.5), p95Ms: quantile(0.95), minMs: timings[0] ?? null, maxMs: timings.at(-1) ?? null,
      decodedBytesMin: bytes.length ? Math.min(...bytes) : null, decodedBytesMax: bytes.length ? Math.max(...bytes) : null,
      resultCountMin: counts.length ? Math.min(...counts) : null, resultCountMax: counts.length ? Math.max(...counts) : null };
  });
}

export async function runSearchLoad(options: {
  transport: SearchLoadTransport; signal?: AbortSignal; onProgress?: (progress: SearchLoadProgress) => void;
  clock?: SearchLoadClock; requestBudget?: number;
}): Promise<SearchLoadReport> {
  const clock = options.clock ?? defaultClock;
  const budget = options.requestBudget ?? SEARCH_LOAD_PLAN.hardBudget;
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > SEARCH_LOAD_PLAN.hardBudget) throw new Error("Invalid search measurement budget.");
  let nextDispatchAt = clock.now();
  let dispatchTail = Promise.resolve();
  let inFlight = 0;
  let dispatched = 0;
  let stoppedReason: string | null = null;
  const controller = new AbortController();
  const samples: SearchLoadSample[] = [];
  const stop = (reason: string) => { if (!stoppedReason) { stoppedReason = reason; controller.abort(); } };
  const externalAbort = () => stop("CANCELLED_BY_USER");
  if (options.signal?.aborted) externalAbort();
  else options.signal?.addEventListener("abort", externalAbort, { once: true });
  const request = async (scenario: SearchLoadScenario, phase: SearchLoadPhase, concurrencyCap: number) => {
    if (stoppedReason) return;
    // Serialize actual dispatch gates, rather than reserving future timestamps.
    // If background-tab timers wake late, queued workers still cannot burst.
    const slot = dispatchTail.then(async () => {
      if (stoppedReason) return;
      await clock.sleep(Math.max(0, nextDispatchAt - clock.now()), controller.signal);
      nextDispatchAt = clock.now() + SEARCH_LOAD_PLAN.intervalMs;
    });
    dispatchTail = slot;
    await slot;
    if (stoppedReason) return;
    if (dispatched >= budget) { stop("REQUEST_BUDGET"); return; }
    const sample: SearchLoadSample = {
      ordinal: ++dispatched, scenario: scenario.id, path: scenario.path, phase, concurrencyCap,
      inFlightAtDispatch: ++inFlight, startedAt: clock.wallTime(), durationMs: 0, status: null,
      decodedBytes: 0, resultCount: null, matchedTotal: null, requestId: null, vercelId: null, cache: null, error: null,
    };
    const started = clock.now();
    const local = new AbortController();
    let rejectAbort: (() => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => { rejectAbort = () => reject(new Error("Measurement stopped.")); });
    const onAbort = () => { local.abort(); rejectAbort?.(); };
    controller.signal.addEventListener("abort", onAbort, { once: true });
    const timer = clock.setTimer(() => { sample.error = "LATENCY_LIMIT"; stop("LATENCY_LIMIT"); }, SEARCH_LOAD_PLAN.timeoutMs);
    try {
      const metadata = await Promise.race([options.transport({ scenario, path: searchLoadRequestPath(scenario), signal: local.signal }), abortPromise]);
      if (!metadata || !Number.isSafeInteger(metadata.status) || metadata.status < 100 || metadata.status > 599) {
        sample.error = "INVALID_RESPONSE_METADATA"; stop(sample.error); return;
      }
      sample.status = metadata.status;
      if (metadata.status !== 200) { sample.error = `HTTP_${metadata.status}`; stop(sample.error); return; }
      if (metadata.ok !== true || !isCount(metadata.decodedBytes) || metadata.decodedBytes > SEARCH_LOAD_PLAN.maxDecodedBytes ||
          !isCount(metadata.resultCount) || metadata.resultCount > 200 ||
          (metadata.matchedTotal !== undefined && metadata.matchedTotal !== null && !isCount(metadata.matchedTotal))) {
        sample.error = "INVALID_RESPONSE_METADATA"; stop(sample.error); return;
      }
      sample.decodedBytes = metadata.decodedBytes;
      sample.resultCount = metadata.resultCount;
      sample.matchedTotal = metadata.matchedTotal ?? null;
      sample.requestId = cleanId(metadata.requestId);
      sample.vercelId = cleanId(metadata.vercelId);
      sample.cache = typeof metadata.cache === "string" && ["HIT", "MISS", "BYPASS", "STALE", "PRERENDER", "REVALIDATED"].includes(metadata.cache) ? metadata.cache : null;
    } catch {
      sample.error ??= stoppedReason ? "CANCELLED_AFTER_STOP" : "TRANSPORT_FAILURE";
      stop(sample.error);
    } finally {
      clock.clearTimer(timer);
      controller.signal.removeEventListener("abort", onAbort);
      sample.durationMs = Math.round(Math.max(0, clock.now() - started) * 100) / 100;
      inFlight -= 1;
      if (sample.durationMs >= SEARCH_LOAD_PLAN.timeoutMs && !sample.error) { sample.error = "LATENCY_LIMIT"; stop(sample.error); }
      samples.push(sample);
      // Consumer rendering must not bypass cleanup or change the measurement.
      try { options.onProgress?.({ completedRequests: samples.length, plannedRequests: SEARCH_LOAD_PLAN.requests,
        currentScenario: scenario.id, phase, concurrencyCap, stoppedReason }); } catch { /* UI callbacks are observational. */ }
    }
  };
  const startedAt = clock.wallTime();
  try {
    for (const scenario of SEARCH_LOAD_SCENARIOS) await request(scenario, "first_observed", 1);
    for (const concurrencyCap of SEARCH_LOAD_PLAN.concurrencyCaps) {
      for (const scenario of SEARCH_LOAD_SCENARIOS) {
        let next = 0;
        await Promise.all(Array.from({ length: concurrencyCap }, async () => {
          while (!stoppedReason && next++ < SEARCH_LOAD_PLAN.samplesPerTier) await request(scenario, "repeated", concurrencyCap);
        }));
      }
    }
  } finally {
    options.signal?.removeEventListener("abort", externalAbort);
  }
  samples.sort((a, b) => a.ordinal - b.ordinal);
  return { schemaVersion: 1, startedAt, endedAt: clock.wallTime(), completed: !stoppedReason && samples.length === SEARCH_LOAD_PLAN.requests,
    stoppedReason, plan: SEARCH_LOAD_PLAN, requests: samples, summary: summarizeSearchLoad(samples),
    limitations: ["Single authenticated account, current dataset, and a fixed serial query; no multi-user or large-dataset capacity claim.",
      "Client-observed API time includes transport, authentication, full body consumption, and parsing; not database-only execution time.",
      "First observed request does not prove a serverless cold start. Concurrency caps do not guarantee achieved concurrency.",
      "p95 uses nearest rank; with six repeated observations it equals the slowest sample and is only a small-sample reference.",
      "Only aggregate metadata is retained. No response bodies, record content, account IDs, or authentication values are stored."] };
}
