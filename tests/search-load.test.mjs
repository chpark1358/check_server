import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("../src/lib/validation/search-load.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function("module", "exports", code)(mod, mod.exports);
const { SEARCH_LOAD_PLAN: plan, SEARCH_LOAD_SCENARIOS: scenarios, searchLoadRequestPath, runSearchLoad, summarizeSearchLoad, compareSearchLoad, normalizeSearchTiming } = mod.exports;

function fakeClock() {
  let time = 0;
  let id = 0;
  const timers = new Map();
  const clock = {
    now: () => time,
    wallTime: () => new Date(Date.UTC(2026, 9, 16) + time).toISOString(),
    setTimer: (callback, ms) => { const timerId = ++id; timers.set(timerId, { at: time + ms, callback }); return timerId; },
    clearTimer: timer => timers.delete(timer),
    sleep: (ms, signal) => new Promise(resolve => {
      if (signal.aborted) return resolve();
      const done = () => { timers.delete(timer); signal.removeEventListener("abort", done); resolve(); };
      const timer = clock.setTimer(done, ms);
      signal.addEventListener("abort", done, { once: true });
    }),
    step: () => {
      const first = [...timers.entries()].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      assert.ok(first, "simulation must have a pending timer until complete");
      timers.delete(first[0]); time = first[1].at; first[1].callback();
    },
    pending: () => timers.size,
  };
  return clock;
}
async function drive(clock, promise) {
  let settled = false;
  promise.finally(() => { settled = true; }).catch(() => {});
  for (let tick = 0; tick < 2000; tick++) {
    await new Promise(resolve => setImmediate(resolve));
    if (settled) return promise;
    clock.step();
  }
  throw new Error("simulation did not complete");
}
const good = extra => ({ status: 200, ok: true, decodedBytes: 1024, resultCount: 7, matchedTotal: 21, requestId: "test-request", ...extra });

test("fixed read-only scenarios cannot add alternate paths, cursor, or admin audit writes", () => {
  assert.equal(scenarios.length, 4);
  assert.ok(Object.isFrozen(scenarios));
  for (const scenario of scenarios) {
    const path = searchLoadRequestPath(scenario);
    assert.ok(path.startsWith("/api/"));
    assert.ok(path.includes("q=24123103"));
    assert.equal(new URL(path, "https://example.invalid").searchParams.has("audit"), false);
    assert.ok(Object.isFrozen(scenario.params));
  }
  assert.throws(() => searchLoadRequestPath({ ...scenarios[0] }));
  assert.throws(() => searchLoadRequestPath({ path: "/api/zendesk/tickets", params: {} }));
});

test("global scheduler completes 76 requests at <=2RPS and measures achieved concurrency", async () => {
  const clock = fakeClock();
  const starts = [];
  let active = 0;
  let peak = 0;
  const report = await drive(clock, runSearchLoad({ clock, transport: async ({ signal }) => {
    starts.push(clock.now()); active++; peak = Math.max(peak, active);
    await clock.sleep(1200, signal); active--;
    return good();
  } }));
  assert.equal(report.completed, true);
  assert.equal(report.requests.length, 76);
  assert.equal(report.summary.length, 16);
  assert.equal(report.requests.filter(sample => sample.phase === "first_observed").length, 4);
  for (let index = 1; index < starts.length; index++) assert.ok(starts[index] - starts[index - 1] >= 500);
  assert.equal(peak, 3, "2RPS and 1200ms response produce actual peak3 under cap4");
  for (const row of report.summary) {
    assert.ok(row.peakObservedInFlight <= row.concurrencyCap);
    assert.equal(row.p50Ms, 1200);
    assert.equal(row.p95Ms, 1200);
    assert.equal(row.requests, row.phase === "first_observed" ? 1 : 6);
  }
  assert.equal(clock.pending(), 0);
});

test("fast endpoints do not claim configured cap4 was achieved", async () => {
  const clock = fakeClock();
  const report = await drive(clock, runSearchLoad({ clock, transport: async ({ signal }) => {
    await clock.sleep(20, signal); return good();
  } }));
  assert.ok(report.summary.filter(row => row.concurrencyCap === 4).every(row => row.peakObservedInFlight === 1));
});

test("failure cancels active work and undispatched reservations instead of retrying", async () => {
  const clock = fakeClock();
  let count = 0;
  let aborts = 0;
  const report = await drive(clock, runSearchLoad({ clock, transport: async ({ signal }) => {
    const ordinal = ++count;
    signal.addEventListener("abort", () => { aborts++; }, { once: true });
    await clock.sleep(ordinal === 30 ? 100 : 1200, signal);
    return ordinal === 30 ? good({ status: 429, ok: false }) : good();
  } }));
  assert.equal(report.completed, false);
  assert.equal(report.stoppedReason, "HTTP_429");
  assert.equal(count, 30);
  assert.ok(aborts >= 1);
  assert.ok(report.requests.some(sample => sample.error === "CANCELLED_AFTER_STOP"));
  assert.equal(clock.pending(), 0);
});

test("authentication, permission, server, and invalid-metadata errors stop immediately", async () => {
  for (const metadata of [good({ status: 401 }), good({ status: 403 }), good({ status: 500 }), good({ ok: false }), good({ resultCount: -1 }), good({ decodedBytes: plan.maxDecodedBytes + 1 }), null]) {
    const clock = fakeClock(); let count = 0;
    const report = await drive(clock, runSearchLoad({ clock, transport: async () => { count++; return metadata; } }));
    assert.equal(report.completed, false);
    assert.equal(count, 1);
    assert.ok(report.stoppedReason);
    assert.equal(clock.pending(), 0);
  }
});

test("10 second timeout ends even if injected transport ignores abort", async () => {
  const clock = fakeClock();
  const report = await drive(clock, runSearchLoad({ clock, transport: async () => new Promise(() => {}) }));
  assert.equal(report.stoppedReason, "LATENCY_LIMIT");
  assert.equal(report.requests.length, 1);
  assert.equal(report.requests[0].durationMs, 10_000);
  assert.equal(clock.pending(), 0);
});

test("budget cannot exceed100 and a lower budget stops before another request", async () => {
  const clock = fakeClock(); let count = 0;
  await assert.rejects(runSearchLoad({ clock, requestBudget: 101, transport: async () => good() }));
  const report = await drive(clock, runSearchLoad({ clock, requestBudget: 2, transport: async () => { count++; return good(); } }));
  assert.equal(count, 2);
  assert.equal(report.stoppedReason, "REQUEST_BUDGET");
});

test("cancelled user signal dispatches nothing and consumer callback errors are isolated", async () => {
  const signal = AbortSignal.abort(); const clock = fakeClock(); let count = 0;
  const report = await runSearchLoad({ clock, signal, transport: async () => { count++; return good(); } });
  assert.equal(count, 0);
  assert.equal(report.stoppedReason, "CANCELLED_BY_USER");
  const second = await drive(clock, runSearchLoad({ clock, requestBudget: 1,
    transport: async () => good(), onProgress: () => { throw new Error("render error"); } }));
  assert.equal(second.requests.length, 1);
  assert.equal(second.stoppedReason, "REQUEST_BUDGET");
});

test("report includes only numeric aggregates and safe IDs; exception contents are never serialized", async () => {
  const clock = fakeClock();
  const report = await drive(clock, runSearchLoad({ clock, requestBudget: 1, transport: async () => good({
    requestId: "email@example.com", vercelId: "Bearer secret-token", cache: "sensitive", accountId: "private-account",
    rows: [{ requesterEmail: "customer@example.com" }], body: "raw-body-content", token: "secret-token",
  }) }));
  const json = JSON.stringify(report);
  for (const secret of ["email@example.com", "secret-token", "private-account", "customer@example.com", "raw-body-content", "sensitive"]) assert.equal(json.includes(secret), false);
  const errors = await drive(clock, runSearchLoad({ clock, transport: async () => { throw new Error("Bearer secret-token"); } }));
  assert.equal(JSON.stringify(errors).includes("secret-token"), false);
  assert.equal(errors.stoppedReason, "TRANSPORT_FAILURE");
});

test("nearest-rank quantiles stay separate by scenario, first observation, and concurrency cap", () => {
  const base = { scenario: "history_summary", phase: "repeated", concurrencyCap: 1,
    status: 200, error: null, inFlightAtDispatch: 1, decodedBytes: 20, resultCount: 1 };
  const samples = [10, 20, 30, 40, 50, 60].map(durationMs => ({ ...base, durationMs }));
  samples.push({ ...base, durationMs: 999, error: "HTTP_500", status: 500 });
  samples.push({ ...base, durationMs: 5000, phase: "first_observed" });
  samples.push({ ...base, durationMs: 700, concurrencyCap: 4 });
  samples.push({ ...base, durationMs: 800, scenario: "documents_search" });
  const rows = summarizeSearchLoad(samples);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].p50Ms, 30);
  assert.equal(rows[0].p95Ms, 60);
  assert.equal(rows[0].successful, 6);
  assert.equal(rows[0].failures, 1);
});

const timed = (serverMs = 80) => ({ fetchToHeadersMs: 100, bodyReadMs: 10, jsonParseMs: 2, responseTotalMs: 112,
  server: { server: serverMs, auth: 20, profile: 10, db: 40, db_sum: 120, serialize: 1 }, serverTimingStatus: "valid" });

test("phase coverage excludes missing and invalid traces rather than counting them as zero", async () => {
  const clock = fakeClock(); let call = 0;
  const report = await drive(clock, runSearchLoad({ clock, comparisonLabel: "baseline", transport: async ({ signal }) => {
    call++; await clock.sleep(120, signal);
    return good({ timing: call % 3 === 0 ? undefined : call % 3 === 1 ? timed() : { ...timed(), server: { server: NaN } },
      deployment: { revision: "a".repeat(40), variant: "baseline", region: "iad1", account: "private" } });
  } }));
  assert.equal(report.schemaVersion, 2); assert.equal(report.comparisonLabel, "baseline");
  assert.deepEqual(report.deployment, { revisions: ["a".repeat(40)], variants: ["baseline"], regions: ["iad1"], missingRevisionSamples: 0, missingVariantSamples: 0, missingRegionSamples: 0 });
  for (const row of report.summary.filter(row => row.phase === "repeated")) {
    assert.deepEqual(row.timingCoverage, { valid: 2, invalid: 2, missing: 2 });
    assert.deepEqual(row.timing.auth, { samples: 2, p50Ms: 20, p95Ms: 20, minMs: 20, maxMs: 20 });
    assert.equal(row.timing.clientMinusServer.p50Ms, 40);
    assert.equal(row.timing.fetchToHeaders.samples, 4);
    assert.equal(row.p50Ms, 120);
  }
  assert.equal(JSON.stringify(report).includes("private"), false);
});

test("timing sanitizer retains only known numeric metrics and rejects overlapping fields beyond server wall", () => {
  const safe = normalizeSearchTiming({ ...timed(), server: { server: 80, auth: 20, db_sum: 120, secret: "token" }, token: "sensitive" });
  assert.deepEqual(safe.server, { server: 80, auth: 20, db_sum: 120 });
  assert.equal(JSON.stringify(safe).includes("token"), false);
  for (const server of [{ server: 80, auth: 100 }, { server: 80, auth: -1 }, { server: Infinity }, { auth: 20 }, { server: 1000 }]) {
    const result = normalizeSearchTiming({ ...timed(), server });
    assert.equal(result.server, null); assert.equal(result.serverTimingStatus, "invalid");
  }
});

test("before/after comparison requires complete verified deployments and preserves phase boundaries", async () => {
  const make = async (comparisonLabel, ms, revision) => {
    const clock = fakeClock();
    return drive(clock, runSearchLoad({ clock, comparisonLabel, transport: async ({ signal }) => {
      await clock.sleep(ms, signal);
      return good({ timing: timed(), deployment: { revision, variant: comparisonLabel } });
    } }));
  };
  const before = await make("baseline", 120, "a".repeat(40));
  const after = await make("optimized", 100, "b".repeat(40));
  const comparison = compareSearchLoad(before, after);
  assert.equal(comparison.comparable, true); assert.equal(comparison.rows.length, 16);
  assert.equal(comparison.rows[0].p50ChangeMs, -20); assert.equal(comparison.rows[0].p50ChangePercent, -16.67);
  assert.equal(comparison.rows[0].timing.auth.beforeP50Ms, 20);
  const unverified = structuredClone(after);
  unverified.deployment.revisions.push("c".repeat(40));
  unverified.requests[0].timing.serverTimingStatus = "missing";
  unverified.summary[0].resultCountMin = 99;
  const invalid = compareSearchLoad(before, unverified);
  assert.equal(invalid.comparable, false);
  assert.ok(invalid.issues.includes("OPTIMIZED_REVISION_UNVERIFIED"));
  assert.ok(invalid.issues.includes("OPTIMIZED_TIMING_INCOMPLETE"));
  assert.ok(invalid.issues.some(issue => issue.startsWith("RESULT_COUNT_CHANGED:")));
});
