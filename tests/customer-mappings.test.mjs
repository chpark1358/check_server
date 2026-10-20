import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const api = {
  ApiError,
  isRecord: (value) => value !== null && typeof value === "object" && !Array.isArray(value),
};
function loadTs(file, imports) {
  const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, require(name) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; },
  });
  return exports;
}
const helper = loadTs("../src/lib/server/customer-mappings.ts", {
  "server-only": {}, "@/lib/server/api": api,
});
const revision = "a".repeat(64), nextRevision = "b".repeat(64);
const mapping = (overrides = {}) => ({
  id: "aaaaaaaa-0000-4000-8000-000000000001", companyName: "Sample company", serial: "LO123",
  zendeskOrgId: "test-org", requesterName: "Synthetic", requesterEmail: "nobody@example.invalid",
  ccEmails: "", defaultEngineerName: "", memo: "", ...overrides,
});
const body = (mappings = [mapping()], extra = {}) => ({ mappings, expectedRevision: revision, ...extra });
function harness(result = { data: { mappings: [mapping()], revision: nextRevision }, error: null }) {
  const queries = [];
  const supabase = {
    async rpc(name, parameters) {
      queries.push({ name, parameters });
      if (result instanceof Error) throw result;
      return result;
    },
    from() { throw new Error("Non-atomic table access is forbidden"); },
  };
  const route = loadTs("../src/app/api/user/customer-mappings/route.ts", {
    "@/lib/server/customer-mappings": helper,
    "@/lib/server/api": {
      ...api, apiOk: (_, payload) => ({ status: 200, body: payload }),
      readJsonObject: async (request) => request.body,
      requireRole: async (_request, _id, role) => {
        assert.equal(role, "viewer"); return { user: { id: "trusted-owner" }, supabase };
      },
      withApiHandler: async (_, fn) => {
        try { return await fn("test"); } catch (error) {
          return { status: error.status ?? 500, body: { code: error.code ?? "INTERNAL_ERROR" } };
        }
      },
    },
  });
  return { route, queries };
}

test("GET reads rows and their revision in one owner-scoped RPC", async () => {
  const h = harness();
  const response = await h.route.GET({});
  assert.equal(response.status, 200);
  assert.equal(response.body.revision, nextRevision);
  assert.deepEqual(JSON.parse(JSON.stringify(h.queries)), [{
    name: "customer_mail_mappings_state", parameters: { p_user_id: "trusted-owner" },
  }]);
});

test("PUT makes exactly one atomic call and ignores a supplied foreign owner", async () => {
  const h = harness();
  const response = await h.route.PUT({ body: body([mapping()], { user_id: "foreign-owner" }) });
  assert.equal(response.status, 200);
  assert.equal(h.queries.length, 1);
  assert.equal(h.queries[0].name, "replace_customer_mail_mappings");
  assert.equal(h.queries[0].parameters.p_user_id, "trusted-owner");
  assert.equal(h.queries[0].parameters.p_expected_revision, revision);
  assert.equal(h.queries[0].parameters.p_allow_empty, false);
});

test("invalid or missing revisions cannot mutate the database", async () => {
  for (const expectedRevision of [undefined, null, "", 12, "old-revision"]) {
    const h = harness();
    const response = await h.route.PUT({ body: body([mapping()], { expectedRevision }) });
    assert.equal(response.status, 428); assert.equal(h.queries.length, 0);
  }
});

test("malformed non-empty input is rejected in full, never silently cleared or truncated", async () => {
  for (const mappings of [null, {}, [null], [mapping(), null], [mapping(), {}],
    [mapping({ requesterEmail: "" })], [mapping({ companyName: "", serial: "" })], [mapping({ serial: "invalid" })],
    [mapping({ memo: 22 })], [mapping({ id: "bad-id" })],
    [mapping({ memo: "x".repeat(8193) })], [mapping({ companyName: "\0" })]]) {
    const h = harness();
    assert.equal((await h.route.PUT({ body: body(mappings) })).status, 400);
    assert.equal(h.queries.length, 0);
  }
});

test("raw arrays above the limit fail before filtering any records", async () => {
  const h = harness();
  const response = await h.route.PUT({ body: body(Array.from({ length: 201 }, () => null)) });
  assert.equal(response.body.code, "TOO_MANY_CUSTOMER_MAPPINGS");
  assert.equal(h.queries.length, 0);
});

test("duplicate IDs and canonical serial/company keys reject the entire write", async () => {
  const secondId = "bbbbbbbb-0000-4000-8000-000000000002";
  for (const mappings of [
    [mapping(), mapping({ serial: "LO456" })],
    [mapping(), mapping({ id: mapping().id.toUpperCase(), serial: "LO456" })],
    [mapping(), mapping({ id: secondId, serial: "123" })],
    [mapping({ serial: "" }), mapping({ id: secondId, serial: "", companyName: " SAMPLE COMPANY " })],
  ]) {
    const h = harness();
    assert.equal((await h.route.PUT({ body: body(mappings) })).status, 400);
    assert.equal(h.queries.length, 0);
  }
});

test("same company with different serials and one company-only fallback is allowed", () => {
  const rows = [
    mapping(),
    mapping({ id: "bbbbbbbb-0000-4000-8000-000000000002", serial: "456" }),
    mapping({ id: "cccccccc-0000-4000-8000-000000000003", serial: "" }),
  ];
  const parsed = helper.parseCustomerMappingsReplacement(body(rows));
  assert.equal(parsed.mappings.length, 3);
  assert.equal(parsed.mappings[1].serial, "LO456");
});

test("empty replacement is accepted only with an explicit boolean confirmation", async () => {
  for (const allowEmpty of [undefined, false, "true", null]) {
    const h = harness();
    assert.equal((await h.route.PUT({ body: body([], { allowEmpty }) })).status, 400);
    assert.equal(h.queries.length, 0);
  }
  const h = harness({ data: { mappings: [], revision: nextRevision }, error: null });
  assert.equal((await h.route.PUT({ body: body([], { allowEmpty: true }) })).status, 200);
  assert.equal(h.queries[0].parameters.p_mappings.length, 0);
  assert.equal(h.queries[0].parameters.p_allow_empty, true);
});

test("revision or ownership conflict is reported without a retry or separate delete", async () => {
  for (const message of ["CUSTOMER_MAPPINGS_CONFLICT", "CUSTOMER_MAPPING_ID_CONFLICT"]) {
    const h = harness({ data: null, error: { code: "PT409", message } });
    const response = await h.route.PUT({ body: body() });
    assert.equal(response.status, 409); assert.equal(response.body.code, message);
    assert.equal(h.queries.length, 1);
  }
});

test("missing migration fails closed and permission errors cannot fake a successful save", async () => {
  for (const code of ["PGRST202", "42883", "42P01", "42501", "23514"]) {
    const h = harness({ data: null, error: { code, message: "permission denied for customer_mail_mappings" } });
    const response = await h.route.PUT({ body: body() });
    assert.equal(response.status, ["PGRST202", "42883", "42P01"].includes(code) ? 503 : 500);
    assert.equal(h.queries.length, 1);
  }
});

test("transport failure or malformed success response is not shown as confirmed persistence", async () => {
  for (const result of [new Error("transport lost"), { data: null }, { data: { mappings: [], revision: "" } },
    { data: { mappings: [{}], revision } }]) {
    const h = harness(result);
    assert.ok((await h.route.PUT({ body: body() })).status >= 500);
    assert.equal(h.queries.length, 1);
  }
});
