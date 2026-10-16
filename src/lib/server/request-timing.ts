import { AsyncLocalStorage } from "node:async_hooks";

// Durations include Supabase HTTP round trips; they are not database execution plans.
// Labels and descriptions are fixed so tokens, filters and SQL never enter headers.
const descriptions = {
  server: "API handler wall time",
  handler: "Route handler including nested phases",
  auth: "Supabase Auth round trip",
  profile: "Permission profile round trip",
  db: "Parallel search queries wall time",
  db_sum: "Sum of overlapping search query round trips",
  audit: "Optional search audit write round trip",
  actor: "Actor filter profile round trip",
  enrich: "Page profile enrichment round trip",
  auth_enrich: "Page Auth enrichment wall time",
  serialize: "JSON response construction",
  q_rows: "Main page query round trip",
  q_audit: "Check page query round trip",
  q_mail: "Mail page query round trip",
  q_documents: "Document page query round trip",
  q_total: "Total count round trip",
  q_pdf_ready: "Ready PDF count round trip",
  q_attached: "Attached document count round trip",
  q_check_count: "Check count round trip",
  q_document_count: "Document count round trip",
  q_mail_count: "Mail count round trip",
  q_check_failed: "Failed check count round trip",
  q_document_failed: "Failed document count round trip",
  q_mail_failed: "Failed mail count round trip",
  q_recent_audit: "Recent audit count round trip",
  q_recent_documents: "Recent document count round trip",
  q_recent_sends: "Recent send count round trip",
  q_recent_failed: "Recent failed send count round trip",
} as const;

type TimingName = keyof typeof descriptions;
type QueryTimingName = Extract<TimingName, `q_${string}`>;
type TimingState = { startedAt: number; durations: Partial<Record<TimingName, number>> };
const context = new AsyncLocalStorage<TimingState>();
const searchPaths = new Set(["/api/history/overview", "/api/documents", "/api/admin/overview"]);
// Change only when deploying a measured optimization after recording its baseline.
const SEARCH_TIMING_VARIANT: "baseline" | "optimized" = "baseline";

export function isSearchTimingEnabled(request: { method?: string; nextUrl?: { pathname: string } }) {
  return process.env.VERCEL_ENV === "preview" && request.method === "GET" && searchPaths.has(request.nextUrl?.pathname ?? "");
}

export async function withSearchTiming<T extends { headers: Headers }>(enabled: boolean, action: () => Promise<T>): Promise<T> {
  if (!enabled) return action();
  const state: TimingState = { startedAt: performance.now(), durations: {} };
  return context.run(state, async () => {
    const response = await action();
    record(state, "server", performance.now() - state.startedAt);
    response.headers.set("Server-Timing", Object.entries(descriptions)
      .filter(([name]) => state.durations[name as TimingName] !== undefined)
      .map(([name, description]) => `${name};dur=${state.durations[name as TimingName]!.toFixed(2)};desc="${description}"`)
      .join(", "));
    const revision = process.env.VERCEL_GIT_COMMIT_SHA;
    if (revision && /^[a-f0-9]{40,64}$/i.test(revision)) response.headers.set("X-Search-Revision", revision);
    const region = process.env.VERCEL_REGION;
    if (region && /^[a-z]{3}[0-9]$/.test(region)) response.headers.set("X-Search-Region", region);
    response.headers.set("X-Search-Variant", SEARCH_TIMING_VARIANT);
    return response;
  });
}

function record(state: TimingState, name: TimingName, duration: number) {
  if (!(name in descriptions) || !Number.isFinite(duration)) return;
  state.durations[name] = (state.durations[name] ?? 0) + Math.max(0, duration);
}

export async function measureTiming<T>(name: TimingName, action: () => PromiseLike<T> | T): Promise<T> {
  const state = context.getStore();
  if (!state) return action();
  const startedAt = performance.now();
  try { return await action(); }
  finally { record(state, name, performance.now() - startedAt); }
}

export async function measureQuery<T>(name: QueryTimingName, action: () => PromiseLike<T> | T): Promise<T> {
  const state = context.getStore();
  if (!state) return action();
  const startedAt = performance.now();
  try { return await action(); }
  finally {
    const duration = performance.now() - startedAt;
    record(state, name, duration);
    record(state, "db_sum", duration);
  }
}

export function measureSync<T>(name: TimingName, action: () => T): T {
  const state = context.getStore();
  if (!state) return action();
  const startedAt = performance.now();
  try { return action(); }
  finally { record(state, name, performance.now() - startedAt); }
}
