import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const ts = createRequire(import.meta.url)("typescript");
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function loadTs(file, imports = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, Date, require(name) {
    assert.ok(Object.hasOwn(imports, name), "Unexpected dependency: " + name); return imports[name];
  } });
  return exports;
}
const roster = loadTs("../src/lib/engineer-roster.ts");
const baseRow = {
  default_engineer_name: "이석진", default_server_model: "auto", default_iptables_status: "auto",
  default_agent_status: "auto", default_send_mode: "dry-run", default_auto_solved: false,
  mail_body_template: "저장된 템플릿 {{requesterName}}",
};
const defaults = {
  defaultEngineerName: "이석진", defaultServerModel: "auto", defaultIptablesStatus: "auto",
  defaultAgentStatus: "auto", defaultSendMode: "dry-run", defaultAutoSolved: false,
  mailBodyTemplate: "새 템플릿 {{requesterName}}",
};
function harness({ missing = [], row = baseRow, readError = null, returnedOverride = null, code = "42703" } = {}) {
  let stored = row ? { ...row } : null;
  const reads = [], writes = [];
  const supabase = { from(table) {
    assert.equal(table, "user_preferences");
    let columns = [], pending = null;
    const query = {
      select(value) { columns = value.split(","); return query; },
      eq(key, value) { assert.equal(key, "user_id"); assert.equal(value, "test-user"); return query; },
      upsert(value) { pending = { ...value }; return query; },
      async maybeSingle() {
        reads.push([...columns]);
        if (readError) return { data: null, error: readError };
        return selectRow();
      },
      async single() {
        const absent = columns.find(column => missing.includes(column));
        if (absent) throw new Error("Unsupported write should have been rejected before upsert");
        writes.push(pending);
        stored = { ...(stored ?? {}), ...pending, ...(returnedOverride ?? {}) };
        return selectRow();
      },
    };
    function selectRow() {
      const absent = columns.find(column => missing.includes(column));
      if (absent) return { data: null, error: { code, message: code === "PGRST204"
        ? `Could not find the '${absent}' column of 'user_preferences' in the schema cache`
        : `column user_preferences.${absent} does not exist` } };
      return { data: stored ? Object.fromEntries(columns.map(column => [column, stored[column]])) : null, error: null };
    }
    return query;
  } };
  const route = loadTs("../src/app/api/user/preferences/route.ts", {
    "@/lib/engineer-roster": roster,
    "@/lib/server/api": {
      ApiError, apiOk: (_id, value) => value,
      isRecord: value => Boolean(value && typeof value === "object" && !Array.isArray(value)),
      readJsonObject: async request => request.body,
      requireRole: async (_request, _id, role) => { assert.equal(role, "viewer"); return { user: { id: "test-user" }, supabase }; },
      withApiHandler: (_request, fn) => fn("test-request"),
    },
  });
  return { reads, writes, get: () => route.GET({}), put: preferences => route.PUT({ body: { preferences } }) };
}

test("GET missing Agent column preserves the stored mail template", async () => {
  const h = harness({ missing: ["default_agent_status"] });
  const { preferences } = await h.get();
  assert.equal(preferences.defaultAgentStatus, "auto");
  assert.equal(preferences.mailBodyTemplate, baseRow.mail_body_template);
  assert.equal(h.reads.length, 2);
  assert.ok(h.reads[1].includes("mail_body_template"));
  assert.equal(h.writes.length, 0);
});

test("GET missing template keeps Agent support; both missing optional columns keep base settings", async () => {
  const h = harness({ missing: ["mail_body_template"], row: { ...baseRow, default_agent_status: "Y" }, code: "PGRST204" });
  const { preferences } = await h.get();
  assert.equal(preferences.defaultAgentStatus, "Y");
  assert.equal(preferences.mailBodyTemplate, "");
  assert.ok(h.reads[1].includes("default_agent_status"));
  const oldest = harness({ missing: ["default_agent_status", "mail_body_template"] });
  assert.equal((await oldest.get()).preferences.defaultEngineerName, "이석진");
  assert.equal(oldest.reads.length, 3);
});

test("unrelated DB failures never trigger a lossy legacy fallback", async () => {
  for (const readError of [
    { code: "42501", message: "permission denied reading default_agent_status" },
    { code: "42703", message: "column user_preferences.default_server_model does not exist" },
  ]) {
    const h = harness({ readError });
    await assert.rejects(h.get, error => error.code === "USER_PREFERENCES_LOAD_FAILED");
    assert.equal(h.reads.length, 1);
    await assert.rejects(() => h.put(defaults), error => error.code === "USER_PREFERENCES_SAVE_FAILED");
    assert.equal(h.writes.length, 0);
  }
});

test("unsupported Agent or mail values return a schema error without partially saving other fields", async () => {
  for (const [missing, preferences] of [
    [["default_agent_status"], { ...defaults, defaultAgentStatus: "Y" }],
    [["default_agent_status"], { ...defaults, defaultAgentStatus: "N" }],
    [["mail_body_template"], defaults],
    [["default_agent_status", "mail_body_template"], { ...defaults, defaultAgentStatus: "N" }],
  ]) {
    const h = harness({ missing });
    await assert.rejects(() => h.put(preferences), error => error instanceof ApiError && error.status === 409 && error.code === "USER_PREFERENCES_SCHEMA_REQUIRED");
    assert.equal(h.writes.length, 0);
  }
});

test("supported base settings and template save when Agent default remains auto", async () => {
  const h = harness({ missing: ["default_agent_status"] });
  const { preferences } = await h.put({ ...defaults, defaultEngineerName: "류은석", defaultServerModel: "AWS" });
  assert.equal(h.writes.length, 1);
  assert.equal(Object.hasOwn(h.writes[0], "default_agent_status"), false);
  assert.equal(h.writes[0].mail_body_template, defaults.mailBodyTemplate);
  assert.equal(preferences.mailBodyTemplate, defaults.mailBodyTemplate);
  assert.equal(preferences.defaultEngineerName, "");
  assert.equal(preferences.defaultServerModel, "AWS");
  assert.equal(preferences.defaultAgentStatus, "auto");
  assert.equal((await h.get()).preferences.mailBodyTemplate, defaults.mailBodyTemplate);
});

test("missing template with empty value permits Agent defaults, and oldest schema permits base preferences", async () => {
  const h = harness({ missing: ["mail_body_template"] });
  const { preferences } = await h.put({ ...defaults, mailBodyTemplate: "", defaultAgentStatus: "Y" });
  assert.equal(preferences.defaultAgentStatus, "Y");
  assert.equal(Object.hasOwn(h.writes[0], "mail_body_template"), false);
  const oldest = harness({ missing: ["default_agent_status", "mail_body_template"] });
  const result = await oldest.put({ ...defaults, mailBodyTemplate: "", defaultAutoSolved: true });
  assert.equal(result.preferences.defaultAutoSolved, true);
  assert.equal(oldest.writes.length, 1);
});

test("current schema saves all values and returns only the persisted database result", async () => {
  const h = harness({ returnedOverride: { mail_body_template: "DB stored template", default_agent_status: "N" } });
  const { preferences } = await h.put({ ...defaults, defaultAgentStatus: "Y" });
  assert.equal(h.writes[0].default_agent_status, "Y");
  assert.equal(h.writes[0].mail_body_template, defaults.mailBodyTemplate);
  assert.equal(preferences.defaultAgentStatus, "N");
  assert.equal(preferences.mailBodyTemplate, "DB stored template");
});

test("a new user can read defaults and create supported preferences on an older schema", async () => {
  const h = harness({ missing: ["default_agent_status"], row: null });
  assert.equal((await h.get()).preferences.mailBodyTemplate, "");
  assert.equal((await h.put(defaults)).preferences.mailBodyTemplate, defaults.mailBodyTemplate);
  assert.equal(h.writes.length, 1);
});
