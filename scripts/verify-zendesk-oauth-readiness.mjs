// Read-only configuration check. This does not verify a deployed Production build.
// Run with Vercel-injected environment and an explicit matching target, for example:
// vercel env run -e production -- node scripts/verify-zendesk-oauth-readiness.mjs production
// Credentials and issued tokens remain in process memory and are never written.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
const inputTarget = process.argv.length === 3 ? process.argv[2] : null;
const target = ["production", "preview"].includes(inputTarget) ? inputTarget : null;
const keys = ["ZENDESK_SUBDOMAIN", "ZENDESK_OAUTH_CLIENT_ID", "ZENDESK_OAUTH_CLIENT_SECRET"];
const output = {
  target,
  configPresence: Object.fromEntries(keys.map(key => [key, Boolean(process.env[key]?.trim())])),
  statusCodes: { token: null, currentUser: null },
  tokenGranted: false,
  grantedReadScopes: null,
  errorCodes: [],
};
output.configPresence.expectedTenant = process.env.ZENDESK_SUBDOMAIN?.trim().toLowerCase() === "jiransoft";
output.configPresence.realSendExplicitlyDisabled = process.env.ALLOW_REAL_ZENDESK_SEND === "false";

const allowedErrors = new Set([
  "invalid_client", "invalid_grant", "invalid_request", "invalid_scope", "unauthorized_client",
  "unsupported_grant_type", "access_denied", "server_error", "temporarily_unavailable",
  "ZENDESK_OAUTH_CONFIG_INVALID", "ZENDESK_OAUTH_NOT_CONFIGURED",
  "ZENDESK_OAUTH_TOKEN_FAILED", "ZENDESK_OAUTH_SCOPE_NOT_ALLOWED",
]);
const modules = new Map();
const nativeFetch = globalThis.fetch;
const requests = { token: 0, currentUser: 0 };
let accessToken = null;
let oauth = null;

function fail(code) {
  if (!output.errorCodes.includes(code)) output.errorCodes.push(code);
  throw new Error("Readiness check stopped");
}

function load(path) {
  if (modules.has(path)) return modules.get(path);
  const compiledModule = { exports: {} };
  modules.set(path, compiledModule.exports);
  const outputText = ts.transpileModule(readFileSync(new URL(path, root), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", outputText)(name => {
    if (name === "server-only") return {};
    // Execute the real env helper while preventing any local .env fallback.
    if (name === "@next/env") return { loadEnvConfig() {} };
    if (name === "@/lib/env") return load("src/lib/env.ts");
    if (name === "@/lib/server/api") return load("src/lib/server/api.ts");
    if (name === "@/lib/server/request-timing") return load("src/lib/server/request-timing.ts");
    if (name === "@/lib/supabase/server") return { createServiceRoleSupabaseClient() { fail("UNEXPECTED_DATABASE_ACCESS"); } };
    return require(name);
  }, compiledModule, compiledModule.exports);
  modules.set(path, compiledModule.exports);
  return compiledModule.exports;
}

async function captureSafeProviderError(response) {
  try {
    const body = await response.clone().json();
    if (body && typeof body === "object" && allowedErrors.has(body.error)) {
      output.errorCodes.push(body.error);
    }
  } catch {
    // Never log provider bodies, thrown messages, headers or response text.
  }
}

async function guardedFetch(input, init = {}) {
  const url = new URL(String(input));
  const method = (init.method ?? "GET").toUpperCase();
  if (url.origin !== "https://jiransoft.zendesk.com" || url.search || url.hash || url.username || url.password) {
    fail("UNEXPECTED_NETWORK_DESTINATION");
  }
  let phase;
  if (url.pathname === "/oauth/tokens" && method === "POST") {
    phase = "token";
    let body;
    try { body = JSON.parse(init.body); } catch { fail("INVALID_TOKEN_REQUEST"); }
    if (body.grant_type !== "client_credentials" || body.scope !== "read") fail("NON_READ_SCOPE_BLOCKED");
  } else if (url.pathname === "/api/v2/users/me.json" && method === "GET") {
    phase = "currentUser";
  } else {
    fail("UNEXPECTED_NETWORK_OPERATION");
  }
  requests[phase] += 1;
  if (requests[phase] > 1) fail("UNEXPECTED_REPEATED_REQUEST");
  const response = await nativeFetch(input, {
    ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  output.statusCodes[phase] = response.status;
  if (!response.ok) await captureSafeProviderError(response);
  return response;
}

try {
  if (!target) fail("EXPLICIT_TARGET_REQUIRED");
  if (!output.configPresence.expectedTenant) fail("EXPECTED_TENANT_REQUIRED");
  if (target === "production" && !output.configPresence.realSendExplicitlyDisabled) fail("PRODUCTION_SEND_MUST_BE_DISABLED");
  if (keys.some(key => !output.configPresence[key])) fail("OAUTH_CONFIG_MISSING");

  // Vercel env run selects which secrets are injected. This explicit target makes
  // the application's real send gate evaluate exactly that selected environment.
  process.env.VERCEL_ENV = target;
  const env = load("src/lib/env.ts");
  if (env.isRealZendeskSendAllowed()) fail("REAL_SEND_GATE_ENABLED");
  oauth = load("src/lib/server/zendesk-oauth.ts");
  const status = oauth.getZendeskOAuthStatus();
  if (!status.configured) fail("OAUTH_CONFIG_INVALID");
  if (status.scopes.length !== 1 || status.scopes[0] !== "read") fail("NON_READ_SCOPE_BLOCKED");

  globalThis.fetch = guardedFetch;
  accessToken = await oauth.getZendeskOAuthAccessToken();
  output.tokenGranted = true;
  const granted = oauth.getZendeskOAuthStatus().grantedScopes;
  output.grantedReadScopes = granted === null ? null : granted.filter(scope => scope === "read");
  if (granted !== null && (granted.length !== 1 || granted[0] !== "read")) fail("GRANTED_SCOPE_UNEXPECTED");

  const response = await guardedFetch(`${oauth.getZendeskBaseUrl()}/api/v2/users/me.json`, {
    headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) fail("CURRENT_USER_LOOKUP_FAILED");
  const body = await response.json();
  if (!body || typeof body !== "object" || !body.user || typeof body.user !== "object") fail("CURRENT_USER_RESPONSE_INVALID");
} catch (error) {
  if (allowedErrors.has(error?.code)) output.errorCodes.push(error.code);
  else if (output.errorCodes.length === 0) output.errorCodes.push("READINESS_CHECK_FAILED");
  process.exitCode = 1;
} finally {
  globalThis.fetch = nativeFetch;
  if (oauth && accessToken) oauth.invalidateZendeskOAuthAccessToken(accessToken);
  accessToken = null;
  output.errorCodes = [...new Set(output.errorCodes)];
  console.log(JSON.stringify(output));
}
