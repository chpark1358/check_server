import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const ts = createRequire(import.meta.url)("typescript");
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const isRecord = value => Boolean(value && typeof value === "object" && !Array.isArray(value));
function loadTs(file, imports = {}, globals = {}) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Date, URL,
    process: { env: { SOLUTION_API_BASE_URL: "https://crm.example.invalid" } },
    console: { error() {} },
    require(name) { assert.ok(Object.hasOwn(imports, name), "Unexpected dependency: " + name); return imports[name]; },
    fetch() { throw new Error("Unmocked network is forbidden"); },
    ...globals,
  });
  return exports;
}
const models = loadTs("../src/lib/server-model.ts");
const normalization = loadTs("../src/lib/server/check-result.ts", {
  "server-only": {}, "@/lib/server/api": { isRecord }, "@/lib/server-model": models,
});
function harness(payload, { status = 200, raw = false, response } = {}) {
  const calls = [];
  const api = loadTs("../src/lib/server/solution-checkup.ts", {
    "server-only": {}, "@/lib/server/api": { ApiError, isRecord },
    "@/lib/server/check-result": normalization,
  }, { fetch: async (url, options) => {
    calls.push({ url, options });
    return response ?? new Response(raw ? payload : JSON.stringify(payload), { status });
  } });
  return { api, calls, run: serial => api.fetchCheckup(serial ?? "LO1001", "test-only-token") };
}
const rejectsCode = (run, code, status = 502) => assert.rejects(run,
  error => error instanceof ApiError && error.code === code && error.status === status);

test("empty, non-JSON and malformed successful responses never become a check result", async () => {
  for (const payload of [null, [], "ok", 42, true, { data: null }, { data: [] }, { data: "empty" }]) {
    await rejectsCode(harness(payload).run, "SOLUTION_CHECKUP_INVALID_RESPONSE");
  }
  for (const payload of ["", "  ", "<html>login</html>", "{broken"]) {
    await rejectsCode(harness(payload, { raw: true }).run, "SOLUTION_CHECKUP_INVALID_RESPONSE");
  }
  await rejectsCode(harness(null, { response: { ok: true, status: 200, text: async () => { throw new Error("stream closed"); } } }).run,
    "SOLUTION_CHECKUP_INVALID_RESPONSE");
});

test("a missing or malformed response serial is rejected before use", async () => {
  for (const payload of [{}, { data: {} }, { companyName: "Sample", cpuUsage: 12 },
    { serial: "", cpuUsage: 12 }, { serial: 1001, cpuUsage: 12 }, { serial: "OTHER1001", cpuUsage: 12 }]) {
    await rejectsCode(harness(payload).run, "SOLUTION_CHECKUP_IDENTITY_MISSING");
  }
  await rejectsCode(harness({ serial: "LO1002", cpuUsage: 12 }).run, "SOLUTION_CHECKUP_SERIAL_MISMATCH");
});

test("identity, timestamp or unusable fields alone are not collected check data", async () => {
  for (const payload of [
    { serial: "LO1001", companyName: "Sample", checkTime: "2026-10-15" },
    { serial: "LO1001", cpuUsage: null, memoryUsage: " ", agentStatus: [] },
    { serial: "LO1001", logData: "{broken", system: { message: "no data" } },
    { serial: "LO1001", logData: { time: "2026-10-15" } },
  ]) await rejectsCode(harness(payload).run, "SOLUTION_CHECKUP_DATA_EMPTY");
});

test("HTTP 200 business failures are errors even if valid-looking data accompanies them", async () => {
  const data = { serial: "LO1001", cpuUsage: 12 };
  for (const payload of [
    { success: false, data }, { ok: false, data }, { error: "unavailable", data },
    { error: { message: "unavailable" }, data }, { errorCode: "CHECK_FAILED", data },
    { status: "failed", data }, { data: { ...data, success: false } },
  ]) await assert.rejects(harness(payload).run, error => error instanceof ApiError && error.status >= 400);
  await rejectsCode(harness({ success: false, code: "TOKEN_EXPIRED", message: "token expired" }).run, "SOLUTION_TOKEN_EXPIRED", 401);
  await rejectsCode(harness({ status: 403, message: "Forbidden" }).run, "SOLUTION_CHECKUP_FORBIDDEN", 403);
  await rejectsCode(harness({ code: "NOT_FOUND", data: null }).run, "NOT_FOUND", 404);
  await rejectsCode(harness({ status: 429 }).run, "SOLUTION_CHECKUP_RATE_LIMITED", 429);
  await rejectsCode(harness({ error: { code: "FORBIDDEN", message: "Permission denied" } }).run, "FORBIDDEN", 403);
  await rejectsCode(harness({ errorCode: 401 }).run, "SOLUTION_TOKEN_EXPIRED", 401);
});

test("flat and wrapped CRM formats preserve measurements and normalize only the serial casing", async () => {
  const data = {
    serial: "lo1001", companyId: "sample-id", companyName: "Sample", totalLicence: 100, useLicence: 50,
    cpuUsage: "12%", memoryUsage: "35.5%", totalMemorySize: 16,
    dockerImageVersion: "officekeeper:2.4", agentVersion: "123", agentStatus: "Y",
    checkOsVersion: "CentOS Linux 7", rootDirectoryUsage: 21, checkTime: "2026-10-15T09:00:00+09:00",
  };
  for (const payload of [data, { success: true, data }, { code: 200, data }, { error: null, data }]) {
    const { result, rawPayload } = await harness(payload).run(" lo1001 ");
    assert.equal(result.serial, "LO1001");
    assert.equal(result.companyName, "Sample");
    assert.equal(result.system.cpuUsagePercent, 12);
    assert.equal(result.system.memUsagePercent, 35.5);
    assert.equal(result.license.total, 100);
    assert.equal(result.disks.root.usedPercent, 21);
    assert.equal(result.versions.docker, "2.4");
    assert.equal(result.versions.agentWin, "V123");
    assert.equal(result.flags.agent, true);
    assert.equal(JSON.stringify(rawPayload), JSON.stringify(payload));
  }
});

test("nested aliases, zero measurements and false flags remain supported", async () => {
  for (const data of [
    { serialNumber: "LO1001", system: { cpuUsage: 0 } },
    { serial: "LO1001", license: { total: 0 } },
    { serial: "LO1001", agentStatus: false },
    { serial: "LO1001", disk: { root: { usagePercent: 0 } } },
    { serial: "LO1001", memory: { totalGb: 16 } },
  ]) {
    const { result } = await harness({ data }).run();
    assert.equal(result.serial, "LO1001");
    assert.equal(result.system.cpuUsagePercent, 0);
  }
});

test("existing mail-not-used and inactive-firewall rules are retained for collected logs", async () => {
  const logData = { checkMailServer: "N", isFirewallActive: "service not active", osInfo: "Linux" };
  for (const value of [logData, JSON.stringify(logData)]) {
    const { result } = await harness({ serial: "LO1001", logData: value }).run();
    assert.equal(result.flags.mail, true);
    assert.equal(result.flags.firewall, true);
    assert.equal(result.system.osInfo, "Linux");
  }
  const { result } = await harness({ serial: "LO1001", logData: { checkMailServer: "connection failed" } }).run();
  assert.equal(result.flags.mail, false);
});

test("upstream HTTP errors and invalid requested serials keep their typed recovery behavior", async () => {
  await rejectsCode(harness(null, { status: 401 }).run, "SOLUTION_TOKEN_EXPIRED", 401);
  await rejectsCode(harness(null, { status: 403 }).run, "SOLUTION_CHECKUP_FORBIDDEN", 403);
  await rejectsCode(harness(null, { status: 404 }).run, "SOLUTION_CHECKUP_NOT_FOUND", 404);
  await rejectsCode(harness(null, { status: 503 }).run, "SOLUTION_CHECKUP_UPSTREAM_FAILED", 502);
  const fixture = harness({ serial: "LO1001", cpuUsage: 0 });
  await rejectsCode(() => fixture.run("invalid"), "SERIAL_INVALID", 400);
  assert.equal(fixture.calls.length, 0);
  await fixture.run();
  assert.equal(fixture.calls[0].url.pathname, "/api/solution/checkup/LO1001");
  assert.equal(fixture.calls[0].options.cache, "no-store");
  assert.equal(fixture.calls[0].options.headers.authorization, "Bearer test-only-token");
});

test("invalid check data is audited as a failure and never returned as successful route data", async () => {
  const actions = [];
  const upstream = harness({ data: null });
  const route = loadTs("../src/app/api/solution/checkup/route.ts", {
    "@/lib/server/api": {
      ApiError, apiOk: (_id, result) => ({ status: 200, ...result }), assertNonEmptyString: value => value,
      requireRole: async () => ({ user: { id: "sample-user" }, supabase: {} }),
      readJsonObject: async () => ({ serial: "LO1001" }),
      withApiHandler: (_request, fn) => fn("test-request"),
    },
    "@/lib/server/audit": { writeAuditLog: async (_db, _user, action) => { actions.push(action); } },
    "@/lib/server/rate-limit": { enforceRateLimit: async () => {} },
    "@/lib/server/solution-auth": { readSolutionSessionFromRequest: () => ({ token: "test-only-token", tokenType: "Bearer" }) },
    "@/lib/server/solution-checkup": upstream.api,
  });
  await rejectsCode(() => route.POST({}), "SOLUTION_CHECKUP_INVALID_RESPONSE");
  assert.deepEqual(actions, ["solution.checkup_failed"]);
});
