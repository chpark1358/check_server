import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const SIGNATURE_ID = "22222222-2222-4222-8222-222222222222";
const STORAGE_PATH = "ec9db4ec849deca784.png";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function load(relativePath, mocks = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(relativePath, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), compiledModule, compiledModule.exports,
  );
  return compiledModule.exports;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function harness(options = {}) {
  const calls = [], audits = [], limits = [];
  const row = { id: SIGNATURE_ID, name: "이석진", storage_path: STORAGE_PATH,
    created_at: "2026-10-16T00:00:00Z", updated_at: "2026-10-16T01:00:00Z" };
  const supabase = createClient("https://example.invalid", "test-only", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? "GET";
      const headers = new Headers(init.headers);
      const call = { pathname: url.pathname, query: url.searchParams, method };
      calls.push(call);
      if (url.pathname === "/auth/v1/user") {
        assert.equal(headers.get("authorization"), "Bearer fixture-token");
        return options.invalidAuth
          ? json({ message: "Invalid fixture token", code: "bad_jwt" }, 401)
          : json({ id: USER_ID, email: "fixture@example.invalid", app_metadata: { role: "viewer" },
            user_metadata: { role: "admin" } });
      }
      if (url.pathname === "/rest/v1/profiles") {
        assert.equal(url.searchParams.get("id"), `eq.${USER_ID}`);
        return options.profileError
          ? json({ code: "XX000", message: "Fixture profile unavailable" }, 500)
          : json([{ id: USER_ID, email: "fixture@example.invalid", role: options.role ?? "admin" }]);
      }
      if (url.pathname === `/storage/v1/object/engineer-signatures/${STORAGE_PATH}`) {
        assert.equal(method, "POST");
        assert.equal(headers.get("content-type"), "image/png");
        assert.equal(headers.get("x-upsert"), "true");
        call.bytes = Buffer.from(init.body);
        return options.storageError
          ? json({ statusCode: "500", error: "StorageError", message: "Fixture storage unavailable" }, 500)
          : json({ Key: `engineer-signatures/${STORAGE_PATH}` });
      }
      if (url.pathname === "/rest/v1/engineer_signatures") {
        if (method === "GET") return json([row]);
        assert.equal(method, "POST");
        call.body = JSON.parse(init.body);
        assert.equal(url.searchParams.get("on_conflict"), "name");
        assert.match(headers.get("prefer"), /resolution=merge-duplicates/);
        return options.metadataError
          ? json({ code: "XX000", message: "Fixture metadata unavailable" }, 500)
          : json(row);
      }
      assert.fail(`Unexpected external request: ${method} ${url.pathname}`);
    } },
  });
  const timing = load("../src/lib/server/request-timing.ts", { "server-only": {} });
  const api = load("../src/lib/server/api.ts", {
    "server-only": {},
    "@/lib/supabase/server": { createServiceRoleSupabaseClient: () => supabase },
    "@/lib/server/request-timing": timing,
  });
  const roster = load("../src/lib/engineer-roster.ts");
  const signatures = load("../src/lib/server/engineer-signatures.ts", {
    "server-only": {}, "@/lib/server/api": api,
    "@/lib/server/document-storage": { ENGINEER_SIGNATURES_BUCKET: "engineer-signatures" },
    "@/lib/engineer-roster": roster,
  });
  const route = load("../src/app/api/engineer-signatures/route.ts", {
    "@/lib/server/api": api,
    "@/lib/engineer-roster": roster,
    "@/lib/server/engineer-signatures": signatures,
    "@/lib/server/rate-limit": { enforceRateLimit: async (...args) => { limits.push(args); } },
    "@/lib/server/audit": { writeAuditLog: async (_db, user, action, entity, id, metadata) => {
      audits.push({ user: user.id, action, entity, id, metadata });
    } },
  });
  const invoke = async (form = {}, method = "POST") => {
    const headers = { "x-request-id": "fixture-signature-upload" };
    if (!options.anonymous) headers.authorization = "Bearer fixture-token";
    const body = new FormData();
    if (!form.omitName) body.set("name", form.name ?? " 이석진 ");
    if (!form.omitFile) body.set("file", form.file ?? new File([PNG], "signature.png", { type: "image/png" }));
    const response = await route[method](new NextRequest("https://example.invalid/api/engineer-signatures", {
      method, headers, ...(method === "POST" ? { body } : {}),
    }));
    return { status: response.status, body: await response.json() };
  };
  return { invoke, calls, audits, limits };
}

function mutationCalls(h) {
  return h.calls.filter(call => call.method !== "GET");
}

test("signature upload authenticates admin and registers the same bytes under the normal ASCII storage path", async () => {
  const h = harness();
  const result = await h.invoke();
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.deepEqual(result.body.signature, { id: SIGNATURE_ID, name: "이석진", updatedAt: "2026-10-16T01:00:00Z" });
  const writes = mutationCalls(h);
  assert.equal(writes.length, 2);
  assert.match(writes[0].pathname, /^\/storage\//);
  assert.deepEqual(writes[0].bytes, PNG);
  assert.equal(writes[1].pathname, "/rest/v1/engineer_signatures");
  assert.equal(writes[1].body.name, "이석진");
  assert.equal(writes[1].body.storage_path, STORAGE_PATH);
  assert.equal(writes[1].body.updated_by, USER_ID);
  assert.equal(writes[1].body.created_by, USER_ID);
  assert.ok(Number.isFinite(Date.parse(writes[1].body.updated_at)));
  assert.deepEqual(h.limits, [[`engineer-signature-upload:${USER_ID}`, 20, 60_000]]);
  assert.deepEqual(h.audits, [{ user: USER_ID, action: "engineer_signature.upload", entity: "engineer_signature",
    id: SIGNATURE_ID, metadata: { requestId: "fixture-signature-upload", name: "이석진" } }]);
});

test("anonymous, invalid, viewer and operator uploads are denied before storage, metadata or auditing", async () => {
  for (const [options, status, code] of [
    [{ anonymous: true }, 401, "AUTH_REQUIRED"],
    [{ invalidAuth: true }, 401, "AUTH_INVALID"],
    [{ role: "viewer" }, 403, "FORBIDDEN"],
    [{ role: "operator" }, 403, "FORBIDDEN"],
    [{ role: "unexpected-role" }, 403, "FORBIDDEN"],
    [{ profileError: true }, 500, "PROFILE_LOOKUP_FAILED"],
  ]) {
    const h = harness(options);
    const result = await h.invoke();
    assert.equal(result.status, status, JSON.stringify(options));
    assert.equal(result.body.code, code);
    assert.equal(mutationCalls(h).length, 0);
    assert.equal(h.audits.length + h.limits.length, 0);
  }
});

test("signature listing permits operator and admin while refusing viewer and anonymous sessions", async () => {
  for (const role of ["operator", "admin"]) {
    const h = harness({ role });
    const result = await h.invoke({}, "GET");
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.signatures, [{ id: SIGNATURE_ID, name: "이석진", updatedAt: "2026-10-16T01:00:00Z", hasSignature: true }]);
    assert.equal(mutationCalls(h).length + h.audits.length + h.limits.length, 0);
  }
  for (const options of [{ role: "viewer" }, { anonymous: true }]) {
    const h = harness(options);
    const result = await h.invoke({}, "GET");
    assert.equal(result.status, options.anonymous ? 401 : 403);
    assert.equal(h.calls.some(call => call.pathname === "/rest/v1/engineer_signatures"), false);
  }
});

test("invalid or retired names, missing/empty files, MIME and filename mismatches are rejected without writes", async () => {
  for (const [form, code] of [
    [{ omitName: true }, "NAME_REQUIRED"],
    [{ name: "  " }, "NAME_REQUIRED"],
    [{ name: "류은석" }, "ENGINEER_INACTIVE"],
    [{ name: " 박장현 " }, "ENGINEER_INACTIVE"],
    [{ name: "../이석진" }, "INVALID_SIGNATURE_NAME"],
    [{ omitFile: true }, "FILE_REQUIRED"],
    [{ file: "not-a-file" }, "FILE_REQUIRED"],
    [{ file: new File([], "empty.png", { type: "image/png" }) }, "FILE_EMPTY"],
    [{ file: new File([PNG], "signature.png", { type: "image/jpeg" }) }, "FILE_TYPE_NOT_ALLOWED"],
    [{ file: new File([PNG], "signature.jpg", { type: "image/png" }) }, "FILE_TYPE_NOT_ALLOWED"],
  ]) {
    const h = harness();
    const result = await h.invoke(form);
    assert.equal(result.status, 400, code);
    assert.equal(result.body.code, code);
    assert.equal(mutationCalls(h).length + h.audits.length, 0, code);
  }
});

test("256 KiB upload boundary is inclusive and an oversized file is denied before writes", async () => {
  const atLimit = Buffer.alloc(256 * 1024);
  PNG.copy(atLimit);
  const valid = harness();
  assert.equal((await valid.invoke({ file: new File([atLimit], "SIGNATURE.PNG", { type: "image/png" }) })).status, 200);
  assert.equal(mutationCalls(valid)[0].bytes.length, atLimit.length);
  const oversized = harness();
  const result = await oversized.invoke({ file: new File([Buffer.alloc(atLimit.length + 1)], "signature.png", { type: "image/png" }) });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, "FILE_TOO_LARGE");
  assert.equal(mutationCalls(oversized).length + oversized.audits.length, 0);
});

test("Storage upload failure does not write metadata or record a successful registration", async () => {
  const h = harness({ storageError: true });
  const result = await h.invoke();
  assert.equal(result.status, 500);
  assert.equal(result.body.code, "ENGINEER_SIGNATURE_UPLOAD_FAILED");
  assert.equal(mutationCalls(h).length, 1);
  assert.equal(h.calls.some(call => call.pathname === "/rest/v1/engineer_signatures"), false);
  assert.equal(h.audits.length, 0);
});

test("metadata failure after Storage upload returns failure without a success audit", async () => {
  const h = harness({ metadataError: true });
  const result = await h.invoke();
  assert.equal(result.status, 500);
  assert.equal(result.body.code, "ENGINEER_SIGNATURE_DB_FAILED");
  assert.equal(mutationCalls(h).length, 2);
  assert.equal(h.audits.length, 0);
});
