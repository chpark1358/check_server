import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const output = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", output)(name => name in mocks ? mocks[name] : require(name), mod, mod.exports);
  return mod.exports;
}
const timing = load("../src/lib/server/request-timing.ts");
function metrics(response) {
  return Object.fromEntries((response.headers.get("server-timing") ?? "").split(", ").filter(Boolean).map(part => {
    const [name, duration] = part.split(";"); return [name, Number(duration.slice(4))];
  }));
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const response = () => Response.json({ ok: true, unchanged: [1, 2] });
function withEnv(values, action) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  return Promise.resolve().then(action).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

test("only exact Preview GET search routes expose diagnostics", async () => withEnv({ VERCEL_ENV: "preview" }, async () => {
  const paths = ["/api/history/overview", "/api/documents", "/api/admin/overview"];
  for (const pathname of paths) assert.equal(timing.isSearchTimingEnabled({ method: "GET", nextUrl: { pathname } }), true);
  for (const request of [{ method: "POST", nextUrl: { pathname: paths[0] } }, { method: "GET", nextUrl: { pathname: "/api/documents/check-report" } }, {}]) {
    assert.equal(timing.isSearchTimingEnabled(request), false);
  }
  for (const env of ["production", "development", ""]) {
    process.env.VERCEL_ENV = env;
    assert.equal(timing.isSearchTimingEnabled({ method: "GET", nextUrl: { pathname: paths[0] } }), false);
  }
  const result = await timing.withSearchTiming(false, async () => {
    await timing.measureTiming("auth", async () => {});
    return response();
  });
  assert.equal(result.headers.has("server-timing"), false);
  assert.deepEqual(await result.json(), { ok: true, unchanged: [1, 2] });
}));

test("concurrent requests isolate their metrics and failed phases keep original errors", async () => {
  const [first, second] = await Promise.all([
    timing.withSearchTiming(true, async () => {
      await timing.measureTiming("auth", () => sleep(20));
      const error = new Error("original");
      await assert.rejects(timing.measureTiming("profile", async () => { throw error; }), candidate => candidate === error);
      return response();
    }),
    timing.withSearchTiming(true, async () => {
      await timing.measureTiming("enrich", () => sleep(5));
      return response();
    }),
  ]);
  assert.ok(metrics(first).auth >= 10);
  assert.ok(metrics(first).profile >= 0);
  assert.equal(metrics(first).enrich, undefined);
  assert.equal(metrics(second).auth, undefined);
  assert.equal(metrics(second).profile, undefined);
  assert.ok(metrics(second).enrich >= 0);
});

test("parallel DB wall time stays distinct from summed query round trips", async () => {
  const result = await timing.withSearchTiming(true, async () => {
    await timing.measureTiming("db", () => Promise.all([
      timing.measureQuery("q_rows", () => sleep(40)),
      timing.measureQuery("q_total", () => sleep(40)),
    ]));
    return timing.measureSync("serialize", response);
  });
  const m = metrics(result);
  assert.ok(m.db_sum > m.db * 1.5);
  assert.ok(Math.abs(m.db_sum - m.q_rows - m.q_total) < 0.03);
  assert.ok(m.server >= m.db);
  assert.ok(m.serialize >= 0);
});

test("fixed labels omit dynamic values and validate deployment revision and region", async () => withEnv({ VERCEL_GIT_COMMIT_SHA: "a".repeat(40), VERCEL_REGION: "icn1" }, async () => {
  const result = await timing.withSearchTiming(true, async () => {
    await timing.measureTiming("token-from-request", async () => {});
    return response();
  });
  assert.equal(result.headers.get("x-search-revision"), "a".repeat(40));
  assert.equal(result.headers.get("x-search-region"), "icn1");
  assert.equal(result.headers.get("x-search-variant"), "optimized");
  assert.equal(result.headers.get("server-timing").includes("token-from-request"), false);
  process.env.VERCEL_GIT_COMMIT_SHA = "unsafe\r\nvalue";
  process.env.VERCEL_REGION = "ICN1;token=unsafe";
  const invalid = await timing.withSearchTiming(true, async () => response());
  assert.equal(invalid.headers.has("x-search-revision"), false);
  assert.equal(invalid.headers.has("x-search-region"), false);
  delete process.env.VERCEL_REGION;
  const missing = await timing.withSearchTiming(true, async () => response());
  assert.equal(missing.headers.has("x-search-region"), false);
}));

test("API instrumentation preserves authorization and JSON responses on success and denial", async () => withEnv({ VERCEL_ENV: "preview" }, async () => {
  const calls = [];
  const supabase = {
    auth: { getUser: async () => { calls.push("auth"); return { data: { user: { id: "fixture", email: "fixture@example.invalid" } }, error: null }; } },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { calls.push("profile"); return { data: { role: "operator" }, error: null }; } }) }) }),
  };
  const api = load("../src/lib/server/api.ts", {
    "server-only": {}, "next/server": { NextResponse: { json: Response.json } },
    "@/lib/server/request-timing": timing,
    "@/lib/supabase/server": { createServiceRoleSupabaseClient: () => supabase },
  });
  const request = { method: "GET", nextUrl: new URL("https://fixture.invalid/api/documents"), headers: new Headers({ authorization: "Bearer fixture" }) };
  const good = await api.withApiHandler(request, async id => {
    await api.requireRole(request, id, "operator");
    return api.apiOk(id, { documents: [] });
  });
  const goodMetrics = metrics(good);
  for (const key of ["server", "handler", "auth", "profile", "serialize"]) assert.ok(goodMetrics[key] >= 0);
  assert.deepEqual(calls, ["auth", "profile"]);
  assert.equal(good.status, 200);
  assert.deepEqual((await good.json()).documents, []);
  const denied = await api.withApiHandler(request, async id => {
    await api.requireRole(request, id, "admin");
    throw new Error("must never reach business code");
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, "FORBIDDEN");
  assert.ok(metrics(denied).serialize >= 0);
}));
