import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as crypto from "node:crypto";
import vm from "node:vm";

const ts = createRequire(import.meta.url)("typescript");
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function loadTs(file, imports) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Buffer, Date,
    process: { env: { NODE_ENV: "production", SUPABASE_SERVICE_ROLE_KEY: "test-secret-not-a-real-service-key" } },
    require(name) { assert.ok(Object.hasOwn(imports, name), "Unexpected dependency: " + name); return imports[name]; },
    fetch() { throw new Error("Network is forbidden in session tests"); },
  });
  return exports;
}
const auth = loadTs("../src/lib/server/solution-auth.ts", {
  "server-only": {}, "node:crypto": crypto,
  "@/lib/server/api": { ApiError, isRecord: value => Boolean(value && typeof value === "object" && !Array.isArray(value)) },
});
function response(status = 200) {
  const cookies = new Map();
  return { status, stored: cookies, cookies: { set: (name, value, options) => cookies.set(name, { value, options }) } };
}
const request = cookies => ({ cookies: { get: name => cookies.get(name) } });
function session(ttlSeconds = 60) {
  const result = response();
  auth.setSolutionSessionCookies(result, { token: "test-crm-token", tokenType: "Bearer", ttlSeconds, ownerId: "user-a" });
  return result.stored;
}
const rejectsWith = (fn, code) => assert.throws(fn, error => error instanceof ApiError && error.code === code);

test("CRM cookies are signed, HttpOnly, path-scoped and readable only by their app user", () => {
  const cookies = session();
  assert.equal(cookies.size, 3);
  for (const cookie of cookies.values()) {
    assert.equal(cookie.options.httpOnly, true);
    assert.equal(cookie.options.secure, true);
    assert.equal(cookie.options.sameSite, "strict");
    assert.equal(cookie.options.path, "/api/solution");
    assert.equal(cookie.options.maxAge, 60);
  }
  assert.equal(auth.readSolutionSessionFromRequest(request(cookies), "user-a").token, "test-crm-token");
  rejectsWith(() => auth.readSolutionSessionFromRequest(request(cookies), "user-b"), "SOLUTION_SESSION_MISMATCH");
});

test("legacy unbound cookies and missing CRM token require login", () => {
  const cookies = session();
  cookies.delete("solution_session_owner");
  rejectsWith(() => auth.readSolutionSessionFromRequest(request(cookies), "user-a"), "SOLUTION_SESSION_MISMATCH");
  cookies.delete("solution_token");
  rejectsWith(() => auth.readSolutionSessionFromRequest(request(cookies), "user-a"), "SOLUTION_NOT_AUTHENTICATED");
});

test("binding rejects changes to token, token type, owner or signed expiry", () => {
  for (const key of ["solution_token", "solution_token_type", "solution_session_owner"]) {
    const cookies = session();
    cookies.set(key, { value: cookies.get(key).value + "tampered" });
    rejectsWith(() => auth.readSolutionSessionFromRequest(request(cookies), "user-a"), "SOLUTION_SESSION_MISMATCH");
  }
  const cookies = session();
  cookies.set("solution_session_owner", { value: cookies.get("solution_session_owner").value.replace("user-a", "user-b") });
  rejectsWith(() => auth.readSolutionSessionFromRequest(request(cookies), "user-b"), "SOLUTION_SESSION_MISMATCH");
});

test("server checks signed expiry even when a client retains expired cookies", () => {
  rejectsWith(() => auth.readSolutionSessionFromRequest(request(session(-1)), "user-a"), "SOLUTION_TOKEN_EXPIRED");
});

test("logout clears token, type and binding using the original cookie path", () => {
  const result = response();
  auth.clearSolutionSessionCookies(result);
  assert.equal(result.stored.size, 3);
  for (const cookie of result.stored.values()) {
    assert.equal(cookie.value, "");
    assert.equal(cookie.options.maxAge, 0);
    assert.equal(cookie.options.path, "/api/solution");
  }
});

test("logout clears local CRM cookies even if app auth expired or audit failed", async () => {
  for (const authFails of [true, false]) {
    const route = loadTs("../src/app/api/solution/logout/route.ts", {
      "@/lib/server/api": {
        apiOk: () => response(),
        requireRole: async () => {
          if (authFails) throw new ApiError(401, "AUTH_INVALID", "Expired");
          return { supabase: {}, user: { id: "user-a" } };
        },
        withApiHandler: async (_, fn) => {
          try { return await fn("test-request"); }
          catch (error) { return response(error instanceof ApiError ? error.status : 500); }
        },
      },
      "@/lib/server/audit": { writeAuditLog: async () => { throw new Error("Audit unavailable"); } },
      "@/lib/server/solution-auth": auth,
    });
    const result = await route.POST({});
    assert.equal(result.status, authFails ? 401 : 500);
    assert.equal(result.stored.size, 3);
    assert.ok([...result.stored.values()].every(cookie => cookie.value === "" && cookie.options.maxAge === 0));
  }
});

test("checkup rejects another app user's CRM cookies before calling upstream", async () => {
  let fetches = 0;
  const route = loadTs("../src/app/api/solution/checkup/route.ts", {
    "@/lib/server/api": {
      ApiError, apiOk: () => ({}), assertNonEmptyString: value => value,
      requireRole: async () => ({ user: { id: "user-b" }, supabase: {} }),
      readJsonObject: async () => ({ serial: "LO1001" }),
      withApiHandler: async (_, fn) => {
        try { return await fn("test-request"); }
        catch (error) { return { code: error.code }; }
      },
    },
    "@/lib/server/audit": { writeAuditLog: async () => {} },
    "@/lib/server/rate-limit": { enforceRateLimit: async () => {} },
    "@/lib/server/solution-auth": auth,
    "@/lib/server/solution-checkup": { fetchCheckup: async () => { fetches++; throw new Error("Must not fetch"); } },
  });
  assert.equal((await route.POST(request(session()))).code, "SOLUTION_SESSION_MISMATCH");
  assert.equal(fetches, 0);
});
