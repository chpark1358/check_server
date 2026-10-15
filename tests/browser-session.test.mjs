import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
function loadTs(file, imports = {}, globals = {}) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Error, require: (name) => {
    assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`);
    return imports[name];
  }, ...globals });
  return exports;
}
const crm = loadTs("../src/lib/browser/crm-storage.ts");
const { observePersistedSession } = loadTs("../src/lib/supabase/session-observer.ts");
function memoryStorage(initial = {}) {
  const rows = new Map(Object.entries(initial));
  return { rows, getItem: (key) => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value), removeItem: (key) => rows.delete(key) };
}

test("CRM ID survives reload for its app account; another account does not inherit it", () => {
  const storage = memoryStorage();
  assert.equal(crm.writeCrmPreferences("user-a", true, " crm-id ", storage), true);
  assert.equal(crm.readCrmPreferences("user-a", storage).username, "crm-id");
  assert.equal(crm.readCrmPreferences("user-b", storage).username, "");
  assert.equal(crm.readCrmPreferences("user-b", storage).rememberUsername, false);
});

test("CRM remember opt-out immediately removes ID and remains opted out after reload", () => {
  const storage = memoryStorage();
  crm.writeCrmPreferences("user-a", true, "crm-id", storage);
  crm.writeCrmPreferences("user-a", false, "crm-id", storage);
  assert.equal(crm.readCrmPreferences("user-a", storage).rememberUsername, false);
  assert.equal(crm.readCrmPreferences("user-a", storage).username, "");
  assert.ok(![...storage.rows.values()].some((value) => value.includes("crm-id")));
});

test("legacy saved CRM ID is adopted once; unowned CRM session is not reused", () => {
  const storage = memoryStorage({
    "check-server:solution-username:v1": "old-id",
    "check-server:solution-session:v1": JSON.stringify({ username: "old-id", masked: "legacy", expiresAt: "2099-01-01T00:00:00Z" }),
  });
  assert.equal(crm.readCrmPreferences("user-a", storage).username, "old-id");
  assert.equal(storage.getItem("check-server:solution-username:v1"), null);
  assert.equal(crm.readCrmPreferences("user-b", storage).username, "");
  assert.equal(crm.readCrmSession("user-a", storage), null);
});

test("CRM metadata expires, is account-scoped, and excludes tokens/passwords", () => {
  const storage = memoryStorage();
  crm.writeCrmSession("user-a", {
    username: "crm-id", masked: "***", expiresAt: "2026-10-16T00:00:00Z",
    password: "must-not-save", token: "must-not-save-token",
  }, storage);
  assert.ok(crm.readCrmSession("user-a", storage, Date.parse("2026-10-15T00:00:00Z")));
  assert.equal(crm.readCrmSession("user-b", storage, 0), null);
  assert.ok(![...storage.rows.values()].join("").includes("must-not-save"));
  assert.equal(crm.readCrmSession("user-a", storage, Date.parse("2026-10-17T00:00:00Z")), null);
  assert.equal(storage.rows.size, 0);
});

test("invalid CRM expiry is not considered a connected session; logout retains only opted-in ID", () => {
  const storage = memoryStorage();
  crm.writeCrmPreferences("user-a", true, "saved-id", storage);
  crm.writeCrmSession("user-a", { username: "saved-id", masked: "***", expiresAt: "invalid" }, storage);
  assert.equal(crm.readCrmSession("user-a", storage), null);
  crm.writeCrmSession("user-a", { username: "saved-id", masked: "***", expiresAt: "2099-01-01T00:00:00Z" }, storage);
  crm.clearCrmSession("user-a", storage);
  assert.equal(crm.readCrmSession("user-a", storage), null);
  assert.equal(crm.readCrmPreferences("user-a", storage).username, "saved-id");
});

test("restricted or corrupt browser storage cannot prevent login", () => {
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(crm.readCrmPreferences("user-a", blocked).username, "");
  assert.equal(crm.writeCrmPreferences("user-a", true, "id", blocked), false);
  assert.equal(crm.readCrmSession("user-a", blocked), null);
  assert.doesNotThrow(() => crm.clearCrmSession("user-a", blocked));
  assert.equal(crm.readCrmPreferences("user-a", memoryStorage({ "check-server:crm-preferences:v2:user-a": "{" })).username, "");
});

function authHarness() {
  let resolve, reject, callback, unsubscribed = false;
  const restored = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {
    auth: {
      getSession() { return restored; },
      onAuthStateChange(next) { callback = next; return { data: { subscription: { unsubscribe() { unsubscribed = true; } } } }; },
    },
    emit: (event, session) => callback(event, session),
    restore: (session) => resolve({ data: { session }, error: null }),
    fail: (message) => reject(new Error(message)),
    unsubscribed: () => unsubscribed,
  };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("saved app session restores without a new login and token refresh is delivered", async () => {
  const source = authHarness(), seen = [], errors = [];
  observePersistedSession(source.auth, (session) => seen.push(session), (message) => errors.push(message));
  source.restore({ user: { id: "user-a" }, access_token: "original" });
  await flush();
  source.emit("TOKEN_REFRESHED", { user: { id: "user-a" }, access_token: "refreshed" });
  assert.equal(seen.length, 2);
  assert.equal(seen[1].access_token, "refreshed");
  assert.deepEqual(errors, []);
});

test("late empty restore cannot overwrite a newly signed-in session", async () => {
  const source = authHarness(), seen = [];
  observePersistedSession(source.auth, (session) => seen.push(session), assert.fail);
  source.emit("SIGNED_IN", { user: { id: "user-a" } });
  source.restore(null);
  await flush();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].user.id, "user-a");
});

test("late restore cannot revive a session after explicit sign-out", async () => {
  const source = authHarness(), seen = [];
  observePersistedSession(source.auth, (session) => seen.push(session), assert.fail);
  source.emit("SIGNED_OUT", null);
  source.restore({ user: { id: "user-a" } });
  await flush();
  assert.deepEqual(seen, [null]);
});

test("restore failure reports recovery and disposed observers ignore later results", async () => {
  const source = authHarness(), errors = [];
  observePersistedSession(source.auth, assert.fail, (message) => errors.push(message));
  source.fail("offline");
  await flush();
  assert.deepEqual(errors, ["offline"]);
  const disposed = authHarness();
  const stop = observePersistedSession(disposed.auth, assert.fail, assert.fail);
  stop();
  disposed.restore({ user: { id: "user-a" } });
  disposed.emit("SIGNED_IN", { user: { id: "user-b" } });
  await flush();
  assert.equal(disposed.unsubscribed(), true);
});

test("browser auth client is persistent singleton without changing existing storage key", () => {
  const calls = [];
  const client = loadTs("../src/lib/supabase/client.ts", {
    "@supabase/supabase-js": { createClient: (...args) => { const value = { args }; calls.push(value); return value; } },
  }, { window: {}, process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://sample.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon" } } });
  assert.equal(client.createBrowserSupabaseClient(), client.createBrowserSupabaseClient());
  assert.equal(calls.length, 1);
  const options = calls[0].args[2].auth;
  assert.equal(options.persistSession, true);
  assert.equal(options.autoRefreshToken, true);
  assert.equal(options.detectSessionInUrl, true);
  assert.equal(options.storageKey, undefined);
});

test("server rendering never reuses an auth client across requests", () => {
  let created = 0;
  const client = loadTs("../src/lib/supabase/client.ts", {
    "@supabase/supabase-js": { createClient: () => ({ request: ++created }) },
  }, { process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://sample.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon" } } });
  assert.notEqual(client.createBrowserSupabaseClient(), client.createBrowserSupabaseClient());
});
