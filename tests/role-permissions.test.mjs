import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DOC = "33333333-3333-4333-8333-333333333333";
const next = { NextResponse: {
  json: (body, options) => Response.json(body, options),
  redirect: (url, status) => new Response(null, { status, headers: { location: url } }),
} };

function load(path, mocks, fallback = name => require(name)) {
  const output = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", output)(name => name in mocks ? mocks[name] : fallback(name), compiledModule, compiledModule.exports);
  return compiledModule.exports;
}

function authHarness(options = {}) {
  const calls = [];
  const profile = options.profile === null ? null : { id: USER, role: options.role ?? "viewer", email: "fixture@example.invalid", ...options.profile };
  const user = { id: USER, email: "fixture@example.invalid", app_metadata: options.appMetadata ?? {}, user_metadata: options.userMetadata ?? {} };
  const supabase = {
    auth: { getUser: async token => { calls.push(["getUser", token]); return { data: { user: options.invalidToken ? null : user }, error: options.invalidToken ? { message: "Invalid token" } : null }; } },
    from: table => {
      calls.push(["from", table]);
      if (table !== "profiles") {
        if (options.from) return options.from(table);
        throw new Error("Unexpected domain query before authorization: " + table);
      }
      const query = {
        select: () => query,
        eq: (key, value) => { assert.equal(key, "id"); assert.equal(value, USER); return query; },
        maybeSingle: async () => ({ data: profile, error: options.profileError ? { message: "Database unavailable" } : null }),
      };
      return query;
    },
  };
  const api = load("../src/lib/server/api.ts", {
    "server-only": {}, "next/server": next,
    "@/lib/supabase/server": { createServiceRoleSupabaseClient: () => { calls.push(["serviceClient"]); return supabase; } },
  });
  return { api, calls, supabase };
}

function request({ token = "verified-token", body = {}, url = "https://fixture.invalid/api/test" } = {}) {
  return { url, nextUrl: new URL(url), headers: new Headers(token === null ? {} : { authorization: `Bearer ${token}` }), json: async () => body };
}

const matches = (status, code) => error => error.status === status && error.code === code;

test("verified profile roles enforce the complete viewer/operator/admin hierarchy", async () => {
  const roles = ["viewer", "operator", "admin"];
  for (let actual = 0; actual < roles.length; actual++) {
    for (let required = 0; required < roles.length; required++) {
      const h = authHarness({ role: roles[actual] });
      const invocation = h.api.requireRole(request(), "request-id", roles[required]);
      if (actual < required) await assert.rejects(invocation, matches(403, "FORBIDDEN"));
      else {
        const auth = await invocation;
        assert.equal(auth.role, roles[actual]); assert.equal(auth.user.id, USER);
      }
      assert.deepEqual(h.calls.filter(call => call[0] === "getUser"), [["getUser", "verified-token"]]);
    }
  }
});

test("missing, forged and expired app tokens fail before any profile/domain lookup", async () => {
  const missing = authHarness();
  await assert.rejects(missing.api.requireRole(request({ token: null }), "request-id", "viewer"), matches(401, "AUTH_REQUIRED"));
  assert.deepEqual(missing.calls, []);
  const invalid = authHarness({ invalidToken: true });
  await assert.rejects(invalid.api.requireRole(request({ token: "invalid-or-expired" }), "request-id", "viewer"), matches(401, "AUTH_INVALID"));
  assert.equal(invalid.calls.some(call => call[0] === "from"), false);
});

test("user editable role metadata cannot elevate a viewer or missing-profile account", async () => {
  for (const options of [
    { role: "viewer", userMetadata: { role: "admin" }, appMetadata: { role: "admin" } },
    { profile: null, userMetadata: { role: "admin" } },
    { role: "invalid-role", appMetadata: { role: "admin" } },
  ]) {
    const h = authHarness(options);
    await assert.rejects(h.api.requireRole(request(), "request-id", "operator"), matches(403, "FORBIDDEN"));
    assert.equal((await h.api.requireRole(request(), "request-id", "viewer")).role, "viewer");
  }
});

test("profile lookup failure is fail-closed even with trusted admin metadata", async () => {
  const h = authHarness({ profileError: true, appMetadata: { role: "admin" } });
  await assert.rejects(h.api.requireRole(request(), "request-id", "viewer"), matches(500, "PROFILE_LOOKUP_FAILED"));
});

// This inventory executes the real route handlers and real authentication guard.
// All non-auth dependencies throw if authorization ever lets the request reach them.
const routes = [
  ["admin/invitations", "POST", "admin"], ["admin/overview", "GET", "admin"],
  ["documents", "GET", "operator"], ["documents/check-report", "POST", "operator"],
  ["documents/[id]/download", "GET", "viewer"], ["documents/[id]/retry-pdf", "POST", "operator"],
  ["engineer-signatures", "GET", "operator"], ["engineer-signatures", "POST", "admin"],
  ["engineer-signatures/[id]", "DELETE", "admin"], ["health", "GET", "viewer"],
  ["history/audit-logs", "GET", "admin"], ["history/overview", "GET", "operator"],
  ["history/ticket-sends", "GET", "operator"], ["settings/zendesk", "GET", "viewer"],
  ["settings/zendesk", "POST", "admin"], ["solution/checkup", "POST", "operator"],
  ["solution/login", "POST", "operator"], ["solution/logout", "POST", "operator"],
  ["user/customer-mappings", "GET", "viewer"], ["user/customer-mappings", "PUT", "viewer"],
  ["user/preferences", "GET", "viewer"], ["user/preferences", "PUT", "viewer"],
  ["zendesk/connection", "GET", "admin"], ["zendesk/groups", "GET", "viewer"],
  ["zendesk/organizations", "GET", "viewer"], ["zendesk/required-fields", "GET", "viewer"],
  ["zendesk/tickets", "POST", "operator"], ["zendesk/tickets/preview", "POST", "operator"],
  ["zendesk/uploads", "POST", "operator"], ["zendesk/uploads/generated", "POST", "operator"],
  ["zendesk/users", "GET", "viewer"],
];

async function deniedRoute(path, method, role, token) {
  const h = authHarness({ role });
  const effects = [];
  const route = load(`../src/app/api/${path}/route.ts`, {
    "@/lib/server/api": h.api, "next/server": next,
    // Clearing only this browser's expired CRM cookie remains intentional on logout.
    "@/lib/server/solution-auth": new Proxy({}, { get: (_, member) => member === "clearSolutionSessionCookies" ? () => {} : () => { effects.push(member); throw new Error("Unexpected CRM operation"); } }),
  }, name => new Proxy({}, { get: (_, member) => () => { effects.push(`${name}.${String(member)}`); throw new Error("Unexpected business effect before permission check"); } }));
  const deniedRequest = request({ token });
  for (const parser of ["json", "formData"]) deniedRequest[parser] = async () => {
    effects.push(`request.${parser}`); throw new Error("Request body must not be parsed before permission check");
  };
  const response = await route[method](deniedRequest, { params: Promise.resolve({ id: DOC }) });
  assert.equal(response.status, token === null ? 401 : 403, `${method} ${path}`);
  assert.equal((await response.json()).code, token === null ? "AUTH_REQUIRED" : "FORBIDDEN");
  assert.deepEqual(effects, [], `${method} ${path} must not invoke business dependencies`);
  assert.equal(h.calls.some(call => call[0] === "from" && call[1] !== "profiles"), false);
}

test("all 31 protected API actions reject anonymous callers before body parsing, DB or external effects", async () => {
  for (const [path, method] of routes) await deniedRoute(path, method, "admin", null);
});

test("operator/admin API actions reject every lower role before business effects", async () => {
  for (const [path, method, minimum] of routes) {
    if (minimum !== "viewer") await deniedRoute(path, method, "viewer", "verified-token");
    if (minimum === "admin") await deniedRoute(path, method, "operator", "verified-token");
  }
});

function documentHarness({ role = "operator", owner = USER, expiresAt = "2099-01-01T00:00:00.000Z", missing = false, pdfPath } = {}) {
  const effects = [];
  const row = { id: DOC, created_by: owner, company_name: "Fixture", serial: "LO0000", docx_path: `${owner}/${DOC}/document.docx`, pdf_path: `${owner}/${DOC}/document.pdf`, created_at: "2026-10-16T00:00:00.000Z", expires_at: expiresAt, attached_to_mail: true };
  if (pdfPath !== undefined) row.pdf_path = pdfPath;
  const h = authHarness({ role, from: table => {
    assert.equal(table, "generated_documents");
    const query = { select: () => query, eq: (key, id) => { assert.equal(key, "id"); assert.equal(id, DOC); return query; }, maybeSingle: async () => ({ data: missing ? null : row, error: null }) };
    return query;
  } });
  const storage = {
    ...load("../src/lib/server/document-storage.ts", { "server-only": {}, "@/lib/server/api": h.api }),
    buildDocumentDisplayFileName: () => "fixture.pdf", documentContentType: () => "application/pdf",
    createSignedDocumentUrl: async (_, key) => { effects.push(["sign", key]); return "https://storage.example.invalid/signed-fixture"; },
    downloadDocumentObject: async (_, key) => { effects.push(["download", key]); return Buffer.from("%PDF-fixture"); },
  };
  const imports = {
    "@/lib/server/api": h.api, "next/server": next,
    "@/lib/server/audit": { writeAuditLog: async () => { effects.push(["audit"]); } },
    "@/lib/server/rate-limit": { enforceRateLimit: async () => {} },
    "@/lib/server/document-storage": storage,
    "@/lib/server/zendesk": { uploadZendeskFile: async () => { effects.push(["upload"]); return { token: "fixture-token", fileName: "fixture.pdf", size: 12, dryRun: true }; } },
  };
  return {
    effects,
    download: () => load("../src/app/api/documents/[id]/download/route.ts", imports).GET(request({ url: `https://fixture.invalid/api/documents/${DOC}/download?type=pdf` }), { params: Promise.resolve({ id: DOC }) }),
    attach: () => load("../src/app/api/zendesk/uploads/generated/route.ts", imports).POST(request({ body: { documentId: DOC, types: ["pdf"], dryRun: true } })),
  };
}

test("document download permits owner/viewer and admin but blocks another operator before signing", async () => {
  for (const [options, expected] of [[{ role: "viewer" }, 302], [{ owner: OTHER }, 403], [{ owner: OTHER, role: "admin" }, 302]]) {
    const h = documentHarness(options), response = await h.download();
    assert.equal(response.status, expected);
    assert.equal(h.effects.some(effect => effect[0] === "sign"), expected === 302);
  }
});

test("generated attachment requires owner/operator or admin and blocks cross-owner storage access", async () => {
  for (const [options, expected] of [[{}, 202], [{ role: "viewer" }, 403], [{ owner: OTHER }, 403], [{ owner: OTHER, role: "admin" }, 202]]) {
    const h = documentHarness(options), response = await h.attach();
    assert.equal(response.status, expected);
    assert.equal(h.effects.some(effect => effect[0] === "download"), expected === 202);
    assert.equal(h.effects.some(effect => effect[0] === "upload"), expected === 202);
  }
});

test("missing, expired or malformed-expiry documents never reach signing or attachment provider", async () => {
  for (const [options, expected] of [[{ missing: true }, 404], [{ expiresAt: "2000-01-01T00:00:00.000Z" }, 410], [{ expiresAt: "invalid" }, 410]]) {
    for (const operation of ["download", "attach"]) {
      const h = documentHarness(options);
      assert.equal((await h[operation]()).status, expected);
      assert.deepEqual(h.effects, []);
    }
  }
});

test("even an owner or admin cannot use forged document metadata to sign or attach another storage object", async () => {
  for (const pdfPath of [`${OTHER}/${DOC}/document.pdf`, `${USER}/${OTHER}/document.pdf`, `${USER}/${DOC}/../other.pdf`, `${USER}/${DOC}/%2e%2e/other.pdf`]) {
    for (const role of ["operator", "admin"]) {
      for (const operation of ["download", "attach"]) {
        const h = documentHarness({ role, pdfPath });
        const response = await h[operation]();
        assert.equal(response.status, 409);
        assert.equal((await response.json()).code, "DOCUMENT_STORAGE_PATH_INVALID");
        assert.deepEqual(h.effects, []);
      }
    }
  }
});

test("legacy send history returns only the operator's rows even when another user's id is supplied", async () => {
  const fixtures = [
    { id: "own-send", sent_by: USER, subject: "Own fixture", created_at: "2026-10-16T00:00:00.000Z" },
    { id: "other-send", sent_by: OTHER, subject: "Other fixture", created_at: "2026-10-16T00:00:00.000Z" },
  ];
  for (const role of ["operator", "admin"]) {
    const requests = [];
    const database = createClient("https://fixture.example.invalid", "fake-service-role", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async input => {
        const url = new URL(String(input)); requests.push(url);
        const filter = url.searchParams.get("sent_by");
        const rows = filter ? fixtures.filter(row => `eq.${row.sent_by}` === filter) : fixtures;
        return Response.json(rows);
      } },
    });
    const h = authHarness({ role, from: table => database.from(table) });
    const route = load("../src/app/api/history/ticket-sends/route.ts", { "@/lib/server/api": h.api });
    const response = await route.GET(request({ url: `https://fixture.invalid/api/history/ticket-sends?sent_by=${OTHER}&userId=${OTHER}&limit=2` }));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.sends.map(row => row.id), role === "admin" ? ["own-send", "other-send"] : ["own-send"]);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].searchParams.get("sent_by"), role === "admin" ? null : `eq.${USER}`);
    assert.equal(requests[0].searchParams.get("limit"), "2");
  }
});
