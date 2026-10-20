import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../src/lib/browser/customer-mapping-save.ts", import.meta.url), "utf8");
function freshSaveModule() {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Error });
  return exports;
}
const { saveCustomerMappings, readCustomerMappingsSnapshot } = freshSaveModule();
const row = (id = "one", serial = "LO24123103") => ({
  id, companyName: "테스트 고객", serial, zendeskOrgId: "123", requesterName: "담당자",
  requesterEmail: "test@example.invalid", ccEmails: "", defaultEngineerName: "", memo: "",
});
const snapshot = (mappings = [row()], revision = "revision-2") => ({ mappings, revision });

test("server failure never updates the local cache or produces a confirmed result", async () => {
  let cached = false;
  await assert.rejects(saveCustomerMappings({
    mappings: [row()], authenticated: true, revision: "revision-1", allowEmpty: false,
    persist: async () => { throw new Error("503 저장 불가"); },
    cache: () => { cached = true; return true; },
  }), /503/);
  assert.equal(cached, false);
});

test("server acknowledgement precedes caching and canonical response is used", async () => {
  const events = [];
  const saved = await saveCustomerMappings({
    mappings: [row()], authenticated: true, revision: "revision-1", allowEmpty: false,
    persist: async (body) => { events.push("server"); assert.equal(body.expectedRevision, "revision-1"); return snapshot([row("canonical")]); },
    cache: (mappings) => { events.push("cache"); assert.equal(mappings[0].id, "canonical"); return true; },
  });
  assert.deepEqual(events, ["server", "cache"]);
  assert.equal(saved.mappings[0].id, "canonical");
  assert.equal(saved.revision, "revision-2");
});

test("malformed input is rejected without invoking save or becoming an empty deletion", async () => {
  for (const mappings of [null, {}, [null], [row(), { ...row("bad"), requesterEmail: "" }]]) {
    let requests = 0, cacheWrites = 0;
    await assert.rejects(saveCustomerMappings({
      mappings, authenticated: true, revision: "revision-1", allowEmpty: true,
      persist: async () => { requests++; return snapshot(); },
      cache: () => { cacheWrites++; return true; },
    }), /형식/);
    assert.equal(requests, 0);
    assert.equal(cacheWrites, 0);
  }
});

test("empty replacement requires an explicit final-delete confirmation", async () => {
  const base = { mappings: [], authenticated: true, revision: "revision-1", cache: () => true };
  await assert.rejects(saveCustomerMappings({ ...base, allowEmpty: false, persist: async () => { assert.fail("must not call"); } }), /전체 매핑 삭제/);
  const saved = await saveCustomerMappings({ ...base, allowEmpty: true, persist: async (body) => {
    assert.equal(body.allowEmpty, true);
    return snapshot([]);
  } });
  assert.equal(saved.mappings.length, 0);
});

test("missing revision blocks writes until a current server list is loaded", async () => {
  await assert.rejects(saveCustomerMappings({
    mappings: [row()], authenticated: true, revision: null, allowEmpty: false,
    persist: async () => { assert.fail("must not call"); }, cache: () => true,
  }), /최신 서버/);
});

test("bad server response cannot overwrite the cache or claim success", async () => {
  for (const response of [{ mappings: [] }, { mappings: null, revision: "r" }, { mappings: [{ id: "partial" }], revision: "r" }]) {
    await assert.rejects(saveCustomerMappings({
      mappings: [row()], authenticated: true, revision: "r", allowEmpty: false,
      persist: async () => response, cache: () => { assert.fail("must not cache"); },
    }));
  }
  assert.throws(() => readCustomerMappingsSnapshot({ mappings: [], revision: "" }), /서버 매핑/);
});

test("local cache failure is separate from an already-confirmed server save", async () => {
  const saved = await saveCustomerMappings({
    mappings: [row()], authenticated: true, revision: "r", allowEmpty: false,
    persist: async () => snapshot(), cache: () => { throw new Error("quota"); },
  });
  assert.equal(saved.cached, false);
  assert.equal(saved.mappings.length, 1);
});

test("signed-out save uses only local storage and does not falsely succeed when blocked", async () => {
  const base = { mappings: [row()], authenticated: false, revision: null, allowEmpty: false, persist: async () => assert.fail("no server") };
  assert.equal((await saveCustomerMappings({ ...base, cache: () => true })).revision, null);
  await assert.rejects(saveCustomerMappings({ ...base, cache: () => false }), /브라우저에 매핑/);
});

const consoleSource = readFileSync(new URL("../src/components/mail-console.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("mail-console.tsx", consoleSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const consoleFunction = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "MailConsole");
function loadHandler(name, globals) {
  const node = [...consoleFunction.body.statements, ...parsed.statements].find((candidate) => ts.isFunctionDeclaration(candidate) && candidate.name?.text === name);
  assert.ok(node, `Missing real UI handler ${name}`);
  const compiled = ts.transpileModule(`${node.getText(parsed)}\nresult = ${name};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = { ...globals, result: null, Error, DOMException, Object, JSON, Boolean };
  vm.runInNewContext(compiled, context);
  return context.result;
}
function saveHarness(persist, extraGlobals = {}) {
  const seen = { mappings: [row("existing")], cache: [], errors: [], notices: [], busy: [] };
  const refs = {
    mappingRevision: { current: "revision-1" }, scopeVersion: { current: 1 },
    mappingWriteInFlight: { current: false }, mappingRequestVersion: { current: 0 },
    confirmedMappings: { current: seen.mappings },
  };
  const handler = loadHandler("saveBatchMappings", {
    ...refs, mappingSyncBusy: false, saveCustomerMappings, preview: false,
    session: { access_token: "not-a-real-token", user: { email: "user@example.invalid" } },
    apiFetch: persist, writeBatchMappings: (_email, mappings) => { seen.cache.push(mappings); return { cached: true, recoveryMappings: [] }; },
    setLocalMappingBackup: () => {},
    mergeCustomerMappings: (...arrays) => arrays.flat(),
    setMappingSyncBusy: (value) => seen.busy.push(value),
    setMappingSyncError: (value) => seen.errors.push(value),
    setNotice: (value) => seen.notices.push(value),
    setBatchMappings: (value) => { seen.mappings = value; },
    setBatchItems: () => {}, findBatchMapping: () => null,
    ...extraGlobals,
  });
  return { handler, seen, refs };
}

test("real UI save handler leaves confirmed rows unchanged while waiting and prevents concurrent PUTs", async () => {
  let finish, requests = 0;
  const harness = saveHarness(async () => { requests++; return new Promise((resolve) => { finish = resolve; }); });
  const pending = harness.handler([row("new")]);
  assert.equal(harness.seen.mappings[0].id, "existing");
  assert.equal(harness.seen.cache.length, 0);
  assert.equal(await harness.handler([row("second")]), false);
  assert.equal(requests, 1);
  finish(snapshot([row("new")]));
  assert.equal(await pending, true);
  assert.equal(harness.seen.mappings[0].id, "new");
});

test("real UI conflict preserves rows and invalidates revision without an automatic retry", async () => {
  let requests = 0;
  const harness = saveHarness(async () => { requests++; throw Object.assign(new Error("conflict"), { status: 409 }); });
  assert.equal(await harness.handler([row("new")]), false);
  assert.equal(harness.seen.mappings[0].id, "existing");
  assert.equal(harness.seen.cache.length, 0);
  assert.equal(harness.refs.mappingRevision.current, null);
  assert.match(harness.seen.errors.at(-1), /목록 새로고침/);
  assert.equal(await harness.handler([row("new")]), false);
  assert.equal(requests, 1);
});

test("account change during save cannot apply old-account mapping results", async () => {
  let finish;
  const harness = saveHarness(async () => new Promise((resolve) => { finish = resolve; }));
  const pending = harness.handler([row("new")]);
  harness.refs.scopeVersion.current++;
  // The actual apiFetch also rejects account changes before returning a body.
  finish(Promise.reject(new DOMException("계정 변경", "AbortError")));
  assert.equal(await pending, false);
  assert.equal(harness.seen.mappings[0].id, "existing");
  assert.equal(harness.seen.cache.length, 0);
});

test("real add handler keeps all input/candidates and avoids success notice on failed save", async () => {
  const events = [];
  const add = loadHandler("addBatchMapping", {
    mappingSyncBusy: false, busyLabel: null, mappingForm: row(), batchMappings: [],
    normalizeMappingForm: (form) => form, customerMappingStorageIdentity: (mapping) => mapping.serial,
    crypto: { randomUUID: () => "new-id" },
    saveBatchMappings: async () => false,
    setNotice: (value) => events.push(["notice", value]),
    setMappingSyncError: () => {},
    setMappingForm: () => events.push(["clear-form"]),
    setBatchOrgCandidates: () => events.push(["clear-org"]),
    setBatchUserCandidates: () => events.push(["clear-users"]),
    emptyMappingForm: {}, session: { access_token: "test" },
  });
  await add();
  assert.deepEqual(events, []);
});

test("loading an empty server snapshot never restores browser-only rows automatically", async () => {
  const calls = [], seen = { rows: [row("old")], backup: [] };
  const handler = loadHandler("reloadBatchMappings", {
    session: { access_token: "test", user: { email: "user@example.invalid" } }, preview: false,
    mappingWriteInFlight: { current: false }, scopeVersion: { current: 1 },
    mappingRequestVersion: { current: 0 }, mappingRevision: { current: null }, confirmedMappings: { current: [] },
    apiFetchWithToken: async (...args) => { calls.push(args); return snapshot([]); },
    readCustomerMappingsSnapshot,
    readBatchMappings: () => [row("local")],
    mergeCustomerMappings: (...arrays) => arrays.flat(),
    customerMappingStorageIdentity: (mapping) => mapping.serial,
    setLocalMappingBackup: (update) => { seen.backup = update([]); },
    setBatchMappings: (rows) => { seen.rows = rows; },
    writeBatchMappings: () => ({ cached: true, recoveryMappings: [row("local")] }),
    setMappingSyncBusy: () => {}, setMappingSyncError: () => {},
  });
  await handler();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 2, "Only a GET; no PUT restoration");
  assert.equal(seen.rows.length, 0);
  assert.ok(seen.backup.length > 0, "Local rows offered separately for explicit recovery");
});

test("mapping-only retry preserves unrelated fresh server rows and never calls Zendesk", async () => {
  const seen = [];
  const handler = loadHandler("retryLearnedMappings", {
    pendingLearnedMappings: [row("learned", "LO11111")],
    batchMappings: [row("fresh-other", "LO22222")],
    mergeCustomerMappings: (...arrays) => arrays.flat(),
    saveBatchMappings: async (rows) => { seen.push(rows); return true; },
    setPendingLearnedMappings: (rows) => { assert.equal(rows.length, 0); },
    setNotice: () => {},
  });
  await handler();
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].map((mapping) => mapping.id), ["learned", "fresh-other"]);
});

const mappingSerialKey = loadHandler("customerMappingSerialKey", {});
const mappingIdentity = loadHandler("customerMappingStorageIdentity", { customerMappingSerialKey: mappingSerialKey });
const cacheKey = "check-server:batch-mail-mappings:user@example.invalid";
const recoveryKey = "check-server:batch-mail-mappings-recovery:user@example.invalid";
function memoryStorage(initial = {}) {
  const rows = new Map(Object.entries(initial));
  return {
    rows,
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => rows.set(key, value),
  };
}
function freshCacheWriter(storage) {
  return loadHandler("writeBatchMappings", {
    window: { localStorage: storage },
    cacheCustomerMappingSnapshot: freshSaveModule().cacheCustomerMappingSnapshot,
    batchMappingsStorageKey: loadHandler("batchMappingsStorageKey", {}),
    customerMappingStorageIdentity: mappingIdentity,
  });
}
function freshReloadPage(storage, serverRows) {
  const seen = { backup: [], errors: [], rows: [] };
  const reload = loadHandler("reloadBatchMappings", {
    session: { access_token: "test", user: { email: "user@example.invalid" } }, preview: false,
    mappingWriteInFlight: { current: false }, scopeVersion: { current: 1 },
    mappingRequestVersion: { current: 0 }, mappingRevision: { current: null }, confirmedMappings: { current: [] },
    apiFetchWithToken: async () => snapshot(serverRows),
    readCustomerMappingsSnapshot: freshSaveModule().readCustomerMappingsSnapshot,
    mergeCustomerMappings: loadHandler("mergeCustomerMappings", {
      customerMappingStorageIdentity: mappingIdentity, normalizeActiveEngineerName: (name) => name,
    }),
    setLocalMappingBackup: (update) => { seen.backup = update(seen.backup); },
    setBatchMappings: (rows) => { seen.rows = rows; },
    writeBatchMappings: freshCacheWriter(storage),
    setMappingSyncBusy: () => {},
    setMappingSyncError: (value) => seen.errors.push(value),
  });
  return { reload, seen };
}

test("real reload handler durably preserves local-only rows across a fresh page instance", async () => {
  const local = row("local-only");
  const storage = memoryStorage({ [cacheKey]: JSON.stringify([local]) });
  const first = freshReloadPage(storage, []);
  await first.reload();
  assert.equal(first.seen.backup[0].id, "local-only");
  assert.equal(JSON.parse(storage.getItem(cacheKey)).length, 0);
  assert.equal(JSON.parse(storage.getItem(recoveryKey))[0].id, "local-only");
  const reloaded = freshReloadPage(storage, []);
  await reloaded.reload();
  assert.equal(reloaded.seen.backup[0].id, "local-only", "No React state survived the simulated reload");
});

test("successful unrelated server saves retain durable pending recovery data", async () => {
  const local = row("local-only", "LO11111"), server = row("new-server", "LO22222");
  const storage = memoryStorage({ [cacheKey]: "[]", [recoveryKey]: JSON.stringify([local]) });
  const save = saveHarness(async () => snapshot([server]), {
    writeBatchMappings: freshCacheWriter(storage),
  });
  assert.equal(await save.handler([server]), true);
  assert.equal(JSON.parse(storage.getItem(recoveryKey))[0].id, "local-only");
  const reloaded = freshReloadPage(storage, [server]);
  await reloaded.reload();
  assert.equal(reloaded.seen.backup[0].id, "local-only");
  assert.equal(reloaded.seen.rows[0].id, "new-server");
});

test("recovery is cleared only after an explicit restore was acknowledged by the server", async () => {
  const local = row("local-only"), initial = JSON.stringify([local]);
  const storage = memoryStorage({ [cacheKey]: "[]", [recoveryKey]: initial });
  const failed = saveHarness(async () => { throw new Error("offline"); }, {
    writeBatchMappings: freshCacheWriter(storage),
  });
  assert.equal(await failed.handler([local], false, [local.id]), false);
  assert.equal(storage.getItem(recoveryKey), initial);
  const success = saveHarness(async () => snapshot([local]), {
    writeBatchMappings: freshCacheWriter(storage),
  });
  assert.equal(await success.handler([local], false, [local.id]), true);
  assert.equal(storage.getItem(recoveryKey), "[]");
  assert.equal(JSON.parse(storage.getItem(cacheKey))[0].id, local.id);
});

test("blocked or corrupt recovery storage cannot destroy the original local cache", async () => {
  for (const failure of ["read", "recovery-write", "cache-write", "corrupt"]) {
    const original = JSON.stringify([row("only-copy")]);
    const memory = memoryStorage({ [cacheKey]: original, ...(failure === "corrupt" ? { [recoveryKey]: "{" } : {}) });
    const storage = {
      getItem(key) {
        if (failure === "read" && key === recoveryKey) throw new Error("blocked");
        return memory.getItem(key);
      },
      setItem(key, value) {
        if ((failure === "recovery-write" && key === recoveryKey) || (failure === "cache-write" && key === cacheKey)) throw new Error("quota");
        memory.setItem(key, value);
      },
    };
    const page = freshReloadPage(storage, []);
    await page.reload();
    assert.equal(memory.getItem(cacheKey), original, failure);
    assert.ok(page.seen.errors.some((message) => message?.includes("기존 브라우저 사본")), failure);
  }
});

test("recovery keys are account-scoped and an unrelated account never inherits them", () => {
  const storage = memoryStorage({ [cacheKey]: "[]", [recoveryKey]: JSON.stringify([row("private")]) });
  const other = freshCacheWriter(storage)("other@example.invalid", [], []);
  assert.equal(other.recoveryMappings.length, 0);
  assert.equal(JSON.parse(storage.getItem(recoveryKey))[0].id, "private");
});

async function runRealAdd(form, existing) {
  let submitted;
  const add = loadHandler("addBatchMapping", {
    mappingSyncBusy: false, busyLabel: null, mappingForm: form, batchMappings: existing,
    normalizeMappingForm: loadHandler("normalizeMappingForm", { normalizeActiveEngineerName: (name) => name }),
    customerMappingStorageIdentity: mappingIdentity,
    crypto: { randomUUID: () => "replacement" },
    saveBatchMappings: async (rows) => { submitted = rows; return true; },
    setNotice: () => {}, setMappingSyncError: () => {}, setMappingForm: () => {},
    setBatchOrgCandidates: () => {}, setBatchUserCandidates: () => {},
    emptyMappingForm: {}, session: { access_token: "test" },
  });
  await add();
  return submitted;
}

test("adding a serial preserves the same company's other serials and company fallback", async () => {
  const existing = [row("first", "LO11111"), row("second", "LO22222"), row("fallback", "")];
  const added = await runRealAdd(row("ignored", "LO33333"), existing);
  assert.deepEqual(Array.from(added, (mapping) => mapping.id), ["replacement", "first", "second", "fallback"]);
});

test("editing a serial replaces only its normalized serial identity", async () => {
  const edited = await runRealAdd(row("ignored", "11-111"), [
    row("old", "LO11111"), row("other", "LO22222"), row("fallback", ""),
  ]);
  assert.deepEqual(Array.from(edited, (mapping) => mapping.id), ["replacement", "other", "fallback"]);
});

test("editing a company fallback leaves all serial-specific rows intact", async () => {
  const edited = await runRealAdd(row("ignored", ""), [
    row("serial", "LO11111"), row("old-fallback", ""), { ...row("different", ""), companyName: "다른 고객" },
  ]);
  assert.deepEqual(Array.from(edited, (mapping) => mapping.id), ["replacement", "serial", "different"]);
});

test("a different serial is never matched as a company-wide fallback", () => {
  const find = loadHandler("findBatchMapping", { customerMappingSerialKey: mappingSerialKey });
  assert.equal(find([row("specific", "LO11111")], "LO22222", "테스트 고객"), null);
  assert.equal(find([row("specific", "LO11111"), row("fallback", "")], "LO22222", "테스트 고객").id, "fallback");
});
