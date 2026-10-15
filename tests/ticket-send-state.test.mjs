import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
function loadTs(file, imports = {}) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      assert.ok(Object.hasOwn(imports, name), "Unexpected dependency: " + name);
      return imports[name];
    },
    console: { error() {} },
  });
  return exports;
}
const policy = loadTs("../src/lib/server/ticket-send-state.ts");
const conflict = { operation: "insert", error: { code: "23505" } };
const inserted = { operation: "insert", error: null };
const updated = { operation: "update", data: { id: "reservation" }, error: null };
const existing = (status, error_summary = null, ticketId = null) => ({
  status, error_summary, zendesk_ticket_id: ticketId, zendesk_ticket_url: ticketId ? "https://example.test/" + ticketId : null,
});
const lookup = (data, error = null) => ({ operation: "lookup", data, error });
class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function harness(plan, options = {}) {
  const queries = [], audits = [];
  let creates = 0;
  const queue = [...plan];
  async function consume(query) {
    queries.push(query);
    const next = queue.shift();
    assert.ok(next, "Unexpected database operation: " + query.operation);
    assert.equal(query.operation, next.operation);
    if (next.throws) throw new Error("database transport unavailable");
    return { data: next.data ?? null, error: next.error ?? null };
  }
  const supabase = {
    from(table) {
      assert.equal(table, "ticket_sends");
      const query = { operation: "lookup", filters: [], row: null };
      const builder = {
        insert(row) { return consume({ ...query, operation: "insert", row }); },
        update(row) { query.operation = "update"; query.row = row; return builder; },
        select(columns) { query.columns = columns; return builder; },
        eq(key, value) { query.filters.push(["eq", key, value]); return builder; },
        is(key, value) { query.filters.push(["is", key, value]); return builder; },
        maybeSingle() { return consume(query); },
      };
      return builder;
    },
  };
  const route = loadTs("../src/app/api/zendesk/tickets/route.ts", {
    "@/lib/server/api": {
      ApiError,
      apiOk: (requestId, body, status = 200) => ({ status, body: { ok: true, requestId, ...body } }),
      readJsonObject: async (request) => request.body,
      requireRole: async () => ({ supabase, user: { id: "operator" } }),
      withApiHandler: async (_, handler) => {
        try { return await handler("request-test"); }
        catch (error) {
          if (!(error instanceof ApiError)) throw error;
          return { status: error.status, body: { ok: false, code: error.code, message: error.message } };
        }
      },
    },
    "@/lib/server/audit": {
      writeAuditLog: async (...args) => {
        audits.push(args);
        if (options.auditThrows) throw new Error("audit unavailable");
      },
    },
    "@/lib/server/rate-limit": { enforceRateLimit: async () => {} },
    "@/lib/server/settings": { getZendeskSettings: async () => ({}) },
    "@/lib/server/ticket-send-state": policy,
    "@/lib/server/zendesk": {
      buildTicketDraft: (body) => body,
      createZendeskTicket: async () => {
        creates++;
        if (options.sendError) throw options.sendError;
        return options.result ?? {
          dryRun: false, ticketId: "123", ticketUrl: "https://example.test/123",
          autoSolveStatus: "not_requested", autoSolveError: null, payload: null,
        };
      },
    },
  });
  return {
    async run() {
      const response = await route.POST({ body: {
        idempotencyKey: "stable-key", organizationId: "org", requesterEmail: "recipient@example.test",
        groupId: "group", assigneeEmail: "operator@example.test", subject: "Inspection",
        uploadTokens: [], autoSolve: false, dryRun: options.dryRun ?? false,
      } });
      assert.equal(queue.length, 0, "Expected database operations were not consumed");
      return response;
    },
    queries, audits, get creates() { return creates; },
  };
}

test("only proven pre-creation failures are retryable; generic upstream failures are unknown", () => {
  for (const code of ["ZENDESK_NOT_CONFIGURED", "ZENDESK_ASSIGNEE_NOT_FOUND", "ZENDESK_FIELD_OPTION_NOT_FOUND"]) {
    assert.equal(policy.classifyTicketSendFailure(code, false).status, "failed");
  }
  for (const code of [null, "ZENDESK_REQUEST_FAILED", "ZENDESK_AUTH_FAILED", "NETWORK_TIMEOUT"]) {
    assert.equal(policy.classifyTicketSendFailure(code, false).status, "pending");
  }
  assert.equal(policy.classifyTicketSendFailure(null, true).retrySafe, true);
});

test("ticket references and legacy failure text never authorize retry", () => {
  const safe = policy.RETRY_SAFE_PREFIX + "ZENDESK_ASSIGNEE_NOT_FOUND";
  assert.equal(policy.ticketSendDisposition(existing("failed", safe)), "retry-safe");
  assert.equal(policy.ticketSendDisposition(existing("failed", safe, "123")), "unknown");
  assert.equal(policy.ticketSendDisposition(existing("failed", "timeout")), "unknown");
  assert.equal(policy.ticketSendDisposition(existing("success")), "unknown");
});

test("unique conflict with lookup error or missing row fails closed without sending", async () => {
  for (const result of [lookup(null, { message: "read failed" }), lookup(null)]) {
    const h = harness([conflict, result]);
    const response = await h.run();
    assert.equal(response.body.code, "TICKET_SEND_STATE_UNAVAILABLE");
    assert.equal(h.creates, 0);
    assert.equal(h.queries.some(q => q.operation === "update"), false);
  }
});

test("reservation transport failure never reaches Zendesk", async () => {
  const h = harness([{ operation: "insert", throws: true }]);
  assert.equal((await h.run()).body.code, "TICKET_SEND_STATE_UNAVAILABLE");
  assert.equal(h.creates, 0);
});

test("old pending and unclassified failed reservations are never reclaimed", async () => {
  for (const status of ["pending", "failed"]) {
    const h = harness([conflict, lookup({ ...existing(status, "legacy timeout"), created_at: "2020-01-01T00:00:00Z" })]);
    assert.equal((await h.run()).body.code, "TICKET_SEND_RESULT_UNKNOWN");
    assert.equal(h.creates, 0);
    assert.equal(h.queries.length, 2);
  }
});

test("confirmed ticket is replayed without a second external create", async () => {
  const h = harness([conflict, lookup(existing("success", null, "123"))]);
  const response = await h.run();
  assert.equal(response.body.duplicate, true);
  assert.equal(response.body.ticketId, "123");
  assert.equal(h.creates, 0);
});

test("confirmed external create with failed history write retains a pending reservation and reports unknown", async () => {
  const h = harness([inserted, { operation: "update", error: { message: "write unavailable" } }, updated]);
  const response = await h.run();
  assert.equal(response.body.code, "TICKET_SEND_RESULT_UNKNOWN");
  assert.match(response.body.message, /123/);
  assert.equal(h.creates, 1);
  assert.equal(h.queries[2].row.status, "pending");
  assert.equal(h.queries[2].row.zendesk_ticket_id, "123");
  assert.ok(h.queries[2].row.error_summary.startsWith(policy.RESULT_UNKNOWN_PREFIX));
  assert.ok(h.queries[2].filters.some(x => x[1] === "status" && x[2] === "pending"));
});

test("zero-row history writes are not treated as confirmed success", async () => {
  const h = harness([inserted, { operation: "update", data: null }, { operation: "update", data: null }]);
  assert.equal((await h.run()).body.code, "TICKET_SEND_RESULT_UNKNOWN");
  assert.equal(h.creates, 1);
});

test("network failure after entering create persists unknown instead of retryable failed", async () => {
  const h = harness([inserted, updated], { sendError: new Error("connection reset after POST") });
  assert.equal((await h.run()).body.code, "TICKET_SEND_RESULT_UNKNOWN");
  assert.equal(h.queries[1].row.status, "pending");
  assert.ok(h.queries[1].row.error_summary.startsWith(policy.RESULT_UNKNOWN_PREFIX));
});

test("missing ticket ID in a real-send response never becomes success", async () => {
  const h = harness([inserted, updated], { result: { dryRun: false, ticketId: null, ticketUrl: null } });
  assert.equal((await h.run()).body.code, "TICKET_SEND_RESULT_UNKNOWN");
  assert.equal(h.queries[1].row.status, "pending");
});

test("known pre-send error is marked failed and a single compare-and-set retry can claim it", async () => {
  const failed = harness([inserted, updated], {
    sendError: new ApiError(502, "ZENDESK_ASSIGNEE_NOT_FOUND", "Missing assignee"),
  });
  assert.equal((await failed.run()).body.code, "ZENDESK_ASSIGNEE_NOT_FOUND");
  const summary = failed.queries[1].row.error_summary;
  assert.equal(failed.queries[1].row.status, "failed");
  const retried = harness([conflict, lookup(existing("failed", summary)), updated, updated]);
  assert.equal((await retried.run()).status, 201);
  assert.equal(retried.creates, 1);
  assert.ok(retried.queries[2].filters.some(x => x[1] === "error_summary" && x[2] === summary));
  assert.ok(retried.queries[2].filters.some(x => x[0] === "is" && x[1] === "zendesk_ticket_id" && x[2] === null));
});

test("losing a retry claim and failing to re-read cannot fall through to create", async () => {
  const h = harness([
    conflict, lookup(existing("failed", policy.RETRY_SAFE_PREFIX + "safe")),
    { operation: "update", data: null }, lookup(null, { message: "unavailable" }),
  ]);
  assert.equal((await h.run()).body.code, "TICKET_SEND_STATE_UNAVAILABLE");
  assert.equal(h.creates, 0);
});

test("audit failure does not turn a recorded send into a retriable error", async () => {
  const h = harness([inserted, updated], { auditThrows: true });
  assert.equal((await h.run()).status, 201);
  assert.equal(h.creates, 1);
});

test("dry-run completion does not require a real ticket ID", async () => {
  const h = harness([inserted, updated], { dryRun: true, result: {
    dryRun: true, ticketId: null, ticketUrl: null, autoSolveStatus: "not_requested", autoSolveError: null, payload: {},
  } });
  assert.equal((await h.run()).status, 202);
  assert.equal(h.queries[1].row.status, "dry_run");
});
