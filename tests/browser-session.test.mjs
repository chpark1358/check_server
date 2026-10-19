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
const { observeCrmSession } = loadTs("../src/lib/browser/crm-session-observer.ts", { "./crm-storage": crm });
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

function crmObserverHarness(userId = "user-a", storage = memoryStorage()) {
  let now = Date.parse("2026-10-20T01:00:00Z"), nextTimer = 0;
  const timers = new Map(), seen = [];
  const source = () => {
    const listeners = new Map();
    return {
      visibilityState: "visible",
      addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
      removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
      emit(type, event = {}) { for (const listener of listeners.get(type) ?? []) listener(event); },
      size() { return [...listeners.values()].reduce((total, group) => total + group.size, 0); },
    };
  };
  const events = source(), visibility = source();
  const controller = observeCrmSession(userId, (session, reason) => seen.push({ session, reason }), {
    read: () => crm.readCrmSessionSnapshot(userId, storage, now), events, visibility, now: () => now,
    schedule: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; },
    cancel: (id) => timers.delete(id),
  });
  return {
    controller, storage, events, visibility, seen, timers,
    session: (minutes = 30, username = "crm-id") => ({ username, masked: "***", expiresAt: new Date(now + minutes * 60_000).toISOString() }),
    storedChanged: (key = `check-server:solution-session:v2:${userId}`) => events.emit("storage", { key }),
    advance(minutes) {
      now += minutes * 60_000;
      for (let attempts = 0; attempts < 20; attempts++) {
        const due = [...timers.entries()].find(([, timer]) => timer.at <= now);
        if (!due) return;
        timers.delete(due[0]); due[1].callback();
      }
      assert.fail("CRM expiry observer did not settle");
    },
  };
}

test("mounted CRM panel observes another tab login and logout without reloading", () => {
  const h = crmObserverHarness();
  crm.writeCrmPreferences("user-a", true, "saved-id", h.storage);
  crm.writeCrmSession("user-a", h.session(), h.storage);
  h.storedChanged();
  assert.equal(h.seen.at(-1).session.username, "crm-id");
  crm.clearCrmSession("user-a", h.storage);
  h.storedChanged();
  assert.equal(h.seen.at(-1).session, null);
  assert.equal(crm.readCrmPreferences("user-a", h.storage).username, "saved-id");
  h.controller.stop();
});

test("focus and visible-tab resume recover a missed CRM storage event", () => {
  const h = crmObserverHarness();
  crm.writeCrmSession("user-a", h.session(), h.storage);
  h.events.emit("focus");
  assert.equal(h.seen.at(-1).session.username, "crm-id");
  crm.writeCrmSession("user-a", h.session(40, "new-id"), h.storage);
  h.visibility.visibilityState = "hidden";
  h.visibility.emit("visibilitychange");
  assert.equal(h.seen.at(-1).session.username, "crm-id");
  h.visibility.visibilityState = "visible";
  h.visibility.emit("visibilitychange");
  assert.equal(h.seen.at(-1).session.username, "new-id");
  const count = h.seen.length;
  h.events.emit("focus");
  assert.equal(h.seen.length, count, "unchanged metadata must not reset UI state");
  h.controller.stop();
});

test("an old CRM expiry timer preserves a newer session saved by another tab", () => {
  const h = crmObserverHarness();
  const oldSession = h.session(1);
  crm.writeCrmSession("user-a", oldSession, h.storage);
  h.storedChanged();
  const renewed = h.session(30, "renewed-id");
  crm.writeCrmSession("user-a", renewed, h.storage);
  // Deliberately omit the storage event to reproduce a suspended stale tab.
  h.advance(2);
  assert.equal(h.seen.at(-1).session.username, "renewed-id");
  assert.equal(crm.readCrmSessionSnapshot("user-a", h.storage, 0).session.username, "renewed-id");
  h.advance(30);
  assert.equal(h.seen.at(-1).session, null);
  assert.equal(h.seen.at(-1).reason, "expired");
  h.controller.stop();
});

test("blocked CRM metadata writes keep the current tab connected through focus until expiry", () => {
  const storage = memoryStorage();
  storage.setItem = () => { throw new Error("write blocked"); };
  const h = crmObserverHarness("user-a", storage);
  const current = h.session(30);
  crm.writeCrmSession("user-a", current, storage);
  h.controller.setLocalSession(current);
  const count = h.seen.length;
  h.events.emit("focus");
  h.visibility.emit("visibilitychange");
  assert.equal(h.seen.length, count, "empty unchanged storage must not erase a successful local login");
  h.advance(31);
  assert.equal(h.seen.at(-1).session, null);
  assert.equal(h.seen.at(-1).reason, "expired");
  h.controller.stop();
});

test("storage read failures and recovery do not falsely log out an in-memory CRM session", () => {
  const storage = memoryStorage(), originalGet = storage.getItem;
  storage.getItem = () => { throw new Error("read blocked"); };
  const h = crmObserverHarness("user-a", storage);
  h.controller.setLocalSession(h.session());
  const count = h.seen.length;
  h.events.emit("focus");
  storage.getItem = originalGet;
  h.events.emit("focus");
  assert.equal(h.seen.length, count);
  h.storedChanged(null); // An explicit cross-tab clear is authoritative.
  assert.equal(h.seen.at(-1).session, null);
  h.controller.stop();
});

test("recovering blocked storage does not replace a newer local CRM login with stale metadata", () => {
  const storage = memoryStorage(), originalGet = storage.getItem;
  const h = crmObserverHarness("user-a", storage);
  crm.writeCrmSession("user-a", h.session(1, "old-id"), storage);
  h.storedChanged();
  storage.getItem = () => { throw new Error("read blocked"); };
  storage.setItem = () => { throw new Error("write blocked"); };
  const current = h.session(30, "new-id");
  crm.writeCrmSession("user-a", current, storage);
  h.controller.setLocalSession(current);
  const count = h.seen.length;
  storage.getItem = originalGet;
  h.events.emit("focus");
  h.advance(2);
  h.events.emit("focus");
  assert.equal(h.seen.length, count, "old metadata expiry must not disconnect the newer local session");
  h.advance(30);
  assert.equal(h.seen.at(-1).session, null);
  assert.equal(h.seen.at(-1).reason, "expired");
  h.controller.stop();
});

test("CRM owner changes clean up old listeners and timers; unrelated account events are ignored", () => {
  const h = crmObserverHarness();
  crm.writeCrmSession("user-a", h.session(), h.storage);
  h.storedChanged("check-server:solution-session:v2:user-b");
  assert.equal(h.seen.length, 1);
  h.storedChanged();
  const pending = [...h.timers.values()][0].callback;
  const count = h.seen.length;
  h.controller.stop();
  assert.equal(h.events.size(), 0);
  assert.equal(h.visibility.size(), 0);
  assert.equal(h.timers.size, 0);
  crm.clearCrmSession("user-a", h.storage);
  h.events.emit("focus");
  pending();
  assert.equal(h.seen.length, count);
  const nextOwner = crmObserverHarness("user-b", h.storage);
  assert.equal(nextOwner.seen[0].session, null);
  nextOwner.controller.stop();
});

test("local CRM logout cancels expiry even if removing metadata fails", () => {
  const h = crmObserverHarness();
  crm.writeCrmSession("user-a", h.session(), h.storage);
  h.storedChanged();
  h.storage.removeItem = () => { throw new Error("remove blocked"); };
  crm.clearCrmSession("user-a", h.storage);
  h.controller.setLocalSession(null);
  const count = h.seen.length;
  h.events.emit("focus");
  h.advance(60);
  assert.equal(h.seen.length, count, "an unchanged old storage value must not revive a local logout");
  assert.equal(h.timers.size, 0);
  h.controller.stop();
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
