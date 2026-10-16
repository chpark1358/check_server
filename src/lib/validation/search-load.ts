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

// These measurements overlap: server includes handler; handler includes auth,
// profile and db; db_sum adds parallel query durations rather than wall time.
export const SEARCH_SERVER_PHASES = Object.freeze([
  "server", "handler", "auth", "profile", "db", "db_sum", "audit", "actor", "enrich", "auth_enrich", "serialize",
  "q_rows", "q_audit", "q_mail", "q_documents", "q_total", "q_pdf_ready", "q_attached", "q_check_count",
  "q_document_count", "q_mail_count", "q_check_failed", "q_document_failed", "q_mail_failed",
  "q_recent_audit", "q_recent_documents", "q_recent_sends", "q_recent_failed",
] as const);
export type SearchServerPhase = typeof SEARCH_SERVER_PHASES[number];
export type SearchComparisonLabel = "baseline" | "optimized" | "unlabeled";
export type SearchTiming = {
  fetchToHeadersMs: number | null; bodyReadMs: number | null; jsonParseMs: number | null;
  responseTotalMs: number | null; server: Partial<Record<SearchServerPhase, number>> | null;
  serverTimingStatus: "valid" | "missing" | "invalid";
};
export type SearchDeployment = { revision: string | null; variant: "baseline" | "optimized" | null; region: string | null };
export type SearchTimingStats = { samples: number; p50Ms: number | null; p95Ms: number | null; minMs: number | null; maxMs: number | null };
export type SearchTimingMetric = SearchServerPhase | "fetchToHeaders" | "bodyRead" | "jsonParse" | "responseTotal" | "clientMinusServer";
export type SearchSampleTiming = SearchTiming & { clientMinusServerMs: number | null };

export type SearchLoadMetadata = {
  status: number; ok: boolean; decodedBytes: number; resultCount: number;
  matchedTotal?: number | null; requestId?: string | null; vercelId?: string | null; cache?: string | null;
  timing?: SearchTiming; deployment?: SearchDeployment;
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
  timing: SearchSampleTiming; deployment: SearchDeployment;
};
export type SearchLoadSummary = {
  scenario: SearchLoadScenario["id"]; phase: SearchLoadPhase; concurrencyCap: number;
  requests: number; successful: number; failures: number; peakObservedInFlight: number;
  p50Ms: number | null; p95Ms: number | null; minMs: number | null; maxMs: number | null;
  decodedBytesMin: number | null; decodedBytesMax: number | null;
  resultCountMin: number | null; resultCountMax: number | null;
  timingCoverage: { valid: number; missing: number; invalid: number };
  timing: Record<SearchTimingMetric, SearchTimingStats>;
};
export type SearchLoadProgress = {
  completedRequests: number; plannedRequests: number; currentScenario: SearchLoadScenario["id"];
  phase: SearchLoadPhase; concurrencyCap: number; stoppedReason: string | null;
};
export type SearchLoadReport = {
  schemaVersion: 2; startedAt: string; endedAt: string; completed: boolean; stoppedReason: string | null;
  comparisonLabel: SearchComparisonLabel;
  deployment: { revisions: string[]; variants: string[]; regions: string[]; missingRevisionSamples: number; missingVariantSamples: number; missingRegionSamples: number };
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
const roundMs = (value: number) => Math.round(value * 100) / 100;
const duration = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 60_000 ? roundMs(value) : null;
const emptyTiming = (): SearchSampleTiming => ({ fetchToHeadersMs: null, bodyReadMs: null, jsonParseMs: null,
  responseTotalMs: null, server: null, serverTimingStatus: "missing", clientMinusServerMs: null });

/** Treat transport metadata as untrusted, even when supplied by a test adapter. */
export function normalizeSearchTiming(value: SearchTiming | undefined): SearchSampleTiming {
  if (!value || typeof value !== "object") return emptyTiming();
  const result: SearchSampleTiming = { ...emptyTiming(), fetchToHeadersMs: duration(value.fetchToHeadersMs),
    bodyReadMs: duration(value.bodyReadMs), jsonParseMs: duration(value.jsonParseMs), responseTotalMs: duration(value.responseTotalMs) };
  if (value.serverTimingStatus === "missing") return result;
  result.serverTimingStatus = "invalid";
  if (value.serverTimingStatus !== "valid" || !value.server || typeof value.server !== "object") return result;
  const server: Partial<Record<SearchServerPhase, number>> = {};
  for (const name of SEARCH_SERVER_PHASES) {
    if (value.server[name] === undefined) continue;
    const ms = duration(value.server[name]);
    if (ms === null) return result;
    server[name] = ms;
  }
  if (server.server === undefined || SEARCH_SERVER_PHASES.some(name => name !== "db_sum" && (server[name] ?? 0) > server.server! + 2)) return result;
  // Small rounding/clock-resolution differences are allowed, not large negative
  // residuals. An invalid trace is never silently replaced with zero duration.
  if (result.fetchToHeadersMs !== null && server.server > result.fetchToHeadersMs + 25) return result;
  result.server = server; result.serverTimingStatus = "valid";
  return result;
}

export function normalizeSearchDeployment(value: SearchDeployment | undefined): SearchDeployment {
  return { revision: typeof value?.revision === "string" && /^[a-f0-9]{40,64}$/i.test(value.revision) ? value.revision.toLowerCase() : null,
    variant: value?.variant === "baseline" || value?.variant === "optimized" ? value.variant : null,
    region: typeof value?.region === "string" && /^[a-z]{3}[0-9]$/.test(value.region) ? value.region : null };
}

function timingStats(values: number[]): SearchTimingStats {
  const sorted = values.filter(value => duration(value) !== null).sort((a, b) => a - b);
  const quantile = (p: number) => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;
  return { samples: sorted.length, p50Ms: quantile(0.5), p95Ms: quantile(0.95), minMs: sorted[0] ?? null, maxMs: sorted.at(-1) ?? null };
}

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
    const extract = (pick: (timing: SearchSampleTiming) => number | null | undefined) => timingStats(successful.flatMap(sample => {
      const value = sample.timing ? pick(sample.timing) : null; return value === null || value === undefined ? [] : [value];
    }));
    const timing = Object.fromEntries(SEARCH_SERVER_PHASES.map(name => [name, extract(t => t.server?.[name])])) as Record<SearchTimingMetric, SearchTimingStats>;
    timing.fetchToHeaders = extract(t => t.fetchToHeadersMs); timing.bodyRead = extract(t => t.bodyReadMs);
    timing.jsonParse = extract(t => t.jsonParseMs); timing.responseTotal = extract(t => t.responseTotalMs);
    timing.clientMinusServer = extract(t => t.clientMinusServerMs);
    return { scenario: group[0].scenario, phase: group[0].phase, concurrencyCap: group[0].concurrencyCap,
      requests: group.length, successful: timings.length, failures: group.length - timings.length,
      peakObservedInFlight: Math.max(...group.map(sample => sample.inFlightAtDispatch)),
      p50Ms: quantile(0.5), p95Ms: quantile(0.95), minMs: timings[0] ?? null, maxMs: timings.at(-1) ?? null,
      decodedBytesMin: bytes.length ? Math.min(...bytes) : null, decodedBytesMax: bytes.length ? Math.max(...bytes) : null,
      resultCountMin: counts.length ? Math.min(...counts) : null, resultCountMax: counts.length ? Math.max(...counts) : null,
      timingCoverage: { valid: successful.filter(s => s.timing?.serverTimingStatus === "valid").length,
        invalid: successful.filter(s => s.timing?.serverTimingStatus === "invalid").length,
        missing: successful.filter(s => !s.timing || s.timing.serverTimingStatus === "missing").length }, timing };
  });
}

export type SearchLoadComparison = {
  comparable: boolean; issues: string[]; baselineRevision: string | null; optimizedRevision: string | null;
  rows: { scenario: SearchLoadScenario["id"]; phase: SearchLoadPhase; concurrencyCap: number;
    beforeP50Ms: number | null; afterP50Ms: number | null; p50ChangeMs: number | null; p50ChangePercent: number | null;
    beforeP95Ms: number | null; afterP95Ms: number | null; resultCountsMatch: boolean;
    timing: Partial<Record<SearchTimingMetric, { beforeP50Ms: number | null; afterP50Ms: number | null }>> }[];
  limitations: string[];
};

/** Comparison labels express intent; immutable response revisions verify what ran. */
export function compareSearchLoad(before: SearchLoadReport, after: SearchLoadReport): SearchLoadComparison {
  const issues: string[] = [];
  for (const [name, report] of [["baseline", before], ["optimized", after]] as const) {
    if (report.comparisonLabel !== name) issues.push(`${name.toUpperCase()}_LABEL_MISMATCH`);
    if (!report.completed || report.requests.length !== SEARCH_LOAD_PLAN.requests) issues.push(`${name.toUpperCase()}_INCOMPLETE`);
    if (report.deployment.revisions.length !== 1 || report.deployment.missingRevisionSamples) issues.push(`${name.toUpperCase()}_REVISION_UNVERIFIED`);
    if (report.deployment.variants.length !== 1 || report.deployment.variants[0] !== name || report.deployment.missingVariantSamples) issues.push(`${name.toUpperCase()}_VARIANT_UNVERIFIED`);
    if (report.requests.some(sample => sample.timing.serverTimingStatus !== "valid")) issues.push(`${name.toUpperCase()}_TIMING_INCOMPLETE`);
  }
  if (JSON.stringify(before.plan) !== JSON.stringify(after.plan)) issues.push("PLAN_CHANGED");
  const key = (row: SearchLoadSummary) => `${row.scenario}:${row.phase}:${row.concurrencyCap}`;
  const afterGroups = new Map(after.summary.map(row => [key(row), row]));
  const rows: SearchLoadComparison["rows"] = [];
  for (const left of before.summary) {
    const right = afterGroups.get(key(left));
    if (!right) { issues.push("MISSING_COMPARISON_GROUP"); continue; }
    const resultCountsMatch = left.resultCountMin === right.resultCountMin && left.resultCountMax === right.resultCountMax;
    if (!resultCountsMatch) issues.push(`RESULT_COUNT_CHANGED:${key(left)}`);
    const timing = Object.fromEntries((Object.keys(left.timing) as SearchTimingMetric[]).map(name => [name,
      { beforeP50Ms: left.timing[name]?.p50Ms ?? null, afterP50Ms: right.timing[name]?.p50Ms ?? null }]));
    rows.push({ scenario: left.scenario, phase: left.phase, concurrencyCap: left.concurrencyCap,
      beforeP50Ms: left.p50Ms, afterP50Ms: right.p50Ms,
      p50ChangeMs: left.p50Ms !== null && right.p50Ms !== null ? roundMs(right.p50Ms - left.p50Ms) : null,
      p50ChangePercent: left.p50Ms !== null && left.p50Ms > 0 && right.p50Ms !== null ? roundMs((right.p50Ms - left.p50Ms) / left.p50Ms * 100) : null,
      beforeP95Ms: left.p95Ms, afterP95Ms: right.p95Ms, resultCountsMatch, timing });
  }
  if (rows.length !== after.summary.length) issues.push("COMPARISON_GROUPS_CHANGED");
  return { comparable: issues.length === 0, issues: [...new Set(issues)], baselineRevision: before.deployment.revisions.length === 1 ? before.deployment.revisions[0] : null,
    optimizedRevision: after.deployment.revisions.length === 1 ? after.deployment.revisions[0] : null, rows,
    limitations: ["Same query and sample counts do not prove identical rows. No business response content is stored for comparison.",
      "Sequential before/after runs are observational; warming, time, shared traffic and platform routing remain confounders.",
      "Phase medians are calculated independently and cannot be added into the total median."] };
}

export async function runSearchLoad(options: {
  transport: SearchLoadTransport; signal?: AbortSignal; onProgress?: (progress: SearchLoadProgress) => void;
  clock?: SearchLoadClock; requestBudget?: number;
  comparisonLabel?: SearchComparisonLabel;
}): Promise<SearchLoadReport> {
  const clock = options.clock ?? defaultClock;
  const budget = options.requestBudget ?? SEARCH_LOAD_PLAN.hardBudget;
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > SEARCH_LOAD_PLAN.hardBudget) throw new Error("Invalid search measurement budget.");
  const comparisonLabel = options.comparisonLabel ?? "unlabeled";
  if (!["baseline", "optimized", "unlabeled"].includes(comparisonLabel)) throw new Error("Invalid comparison label.");
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
      timing: emptyTiming(), deployment: { revision: null, variant: null, region: null },
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
      sample.timing = normalizeSearchTiming(metadata.timing);
      sample.deployment = normalizeSearchDeployment(metadata.deployment);
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
      if (sample.timing.server?.server !== undefined && sample.durationMs >= sample.timing.server.server) {
        sample.timing.clientMinusServerMs = roundMs(sample.durationMs - sample.timing.server.server);
      }
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
  return { schemaVersion: 2, startedAt, endedAt: clock.wallTime(), completed: !stoppedReason && samples.length === SEARCH_LOAD_PLAN.requests,
    comparisonLabel, deployment: { revisions: [...new Set(samples.flatMap(s => s.deployment.revision ? [s.deployment.revision] : []))],
      variants: [...new Set(samples.flatMap(s => s.deployment.variant ? [s.deployment.variant] : []))],
      regions: [...new Set(samples.flatMap(s => s.deployment.region ? [s.deployment.region] : []))],
      missingRevisionSamples: samples.filter(s => !s.deployment.revision).length, missingVariantSamples: samples.filter(s => !s.deployment.variant).length,
      missingRegionSamples: samples.filter(s => !s.deployment.region).length },
    stoppedReason, plan: SEARCH_LOAD_PLAN, requests: samples, summary: summarizeSearchLoad(samples),
    limitations: ["Single authenticated account, current dataset, and a fixed serial query; no multi-user or large-dataset capacity claim.",
      "Client-observed API time includes transport, authentication, full body consumption, and parsing; not database-only execution time.",
      "First observed request does not prove a serverless cold start. Concurrency caps do not guarantee achieved concurrency.",
      "Server timings include Supabase HTTP round trips, not pure SQL duration. server/handler/db and db_sum overlap and must not be added together.",
      "Client minus server time includes platform dispatch, transport, browser scheduling, body reading and JSON parsing; it is not pure network latency.",
      "Missing or inconsistent server traces are reported as missing/invalid, never as zero. Phase quantiles describe available samples only, not a sum of phases.",
      "Before/after runs use the same fixed scenario order. Time of day, server warming and shared traffic can confound causal attribution.",
      "p95 uses nearest rank; with six repeated observations it equals the slowest sample and is only a small-sample reference.",
      "Only aggregate metadata is retained. No response bodies, record content, account IDs, or authentication values are stored."] };
}
