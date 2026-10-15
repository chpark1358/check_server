import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
function loadTypescript(path, mocks = {}) {
  const output = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", output)(
    (name) => name in mocks ? mocks[name] : require(name), compiledModule, compiledModule.exports,
  );
  return compiledModule.exports;
}
const h = loadTypescript("../src/lib/server/history-query.ts");
const KEY = "history-test-signing-key";
const NOW = new Date("2026-10-14T15:30:00.000Z"); // Oct 15, 00:30 KST
const OWNER = "11111111-1111-4111-8111-111111111111";
const id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const parse = (params = {}, owner = OWNER, now = NOW) =>
  h.parseHistoryQuery(new URLSearchParams(params), owner, KEY, now);
function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof h.HistoryQueryError && error.code === code);
}

test("KST calendar ranges include today, independently of host timezone", () => {
  const expectations = {
    today: "2026-10-14T15:00:00.000Z",
    "7d": "2026-10-08T15:00:00.000Z",
    "30d": "2026-09-15T15:00:00.000Z",
    "90d": "2026-07-17T15:00:00.000Z",
    "365d": "2025-10-15T15:00:00.000Z",
  };
  for (const [range, from] of Object.entries(expectations)) {
    const result = parse({ range });
    assert.equal(result.fromInclusive, from, range);
    assert.equal(result.toExclusive, "2026-10-15T15:00:00.000Z");
    assert.equal(result.filters.timezone, "Asia/Seoul");
  }
  assert.equal(parse({ range: "today" }, OWNER, new Date("2026-10-14T14:59:59Z")).filters.from, "2026-10-14");
});

test("all has no lower date bound; custom end day is inclusive", () => {
  assert.equal(parse({ range: "all" }).fromInclusive, null);
  assert.equal(parse({ range: "all" }).toExclusive, null);
  const result = parse({ range: "custom", from: "2024-02-29", to: "2024-02-29" });
  assert.equal(result.fromInclusive, "2024-02-28T15:00:00.000Z");
  assert.equal(result.toExclusive, "2024-02-29T15:00:00.000Z");
});

test("invalid filters, impossible dates, reversed dates and limits are rejected", () => {
  for (const range of ["year", "", "90"]) expectCode(() => parse({ range }), "INVALID_HISTORY_FILTER");
  expectCode(() => parse({ sort: "relevance" }), "INVALID_HISTORY_FILTER");
  expectCode(() => parse({ includeSummary: "0" }), "INVALID_HISTORY_FILTER");
  expectCode(() => parse({ range: "custom", from: "2026-02-29", to: "2026-03-01" }), "INVALID_HISTORY_DATE");
  expectCode(() => parse({ range: "custom", from: "2026-10-15", to: "2026-10-14" }), "INVALID_HISTORY_DATE_RANGE");
  expectCode(() => parse({ range: "custom", from: "2026-10-14" }), "INVALID_HISTORY_DATE_RANGE");
  expectCode(() => parse({ range: "all", from: "2026-10-14" }), "INVALID_HISTORY_DATE_RANGE");
  for (const limit of ["0", "-1", "1.5", "NaN"]) expectCode(() => parse({ limit }), "INVALID_HISTORY_LIMIT");
  assert.equal(parse({ limit: "999" }).filters.limit, 200);
  assert.equal(parse().includeSummary, true);
  assert.equal(parse({ includeSummary: "false" }).includeSummary, false);
});

test("signed cursor binds owner and filters but permits summary-only preference changes", () => {
  const query = parse({ range: "7d", limit: "2" });
  const cursor = h.createHistoryCursor(query, { createdAt: "2026-10-14T15:10:00.000001+00:00", type: "document", id: id(3) }, KEY);
  const next = parse({ range: "7d", limit: "2", cursor, includeSummary: "false" }, OWNER, new Date("2026-10-16T01:00:00Z"));
  assert.equal(next.filters.asOf, NOW.toISOString());
  assert.equal(next.filters.from, query.filters.from);
  assert.equal(next.cursor.createdAt, "2026-10-14T15:10:00.000001+00:00");
  for (const change of [{ range: "30d" }, { q: "changed" }, { type: "mail" }, { status: "failed" }, { sort: "oldest" }, { limit: "3" }]) {
    expectCode(() => parse({ range: "7d", limit: "2", cursor, ...change }), "HISTORY_CURSOR_FILTER_MISMATCH");
  }
  expectCode(() => parse({ range: "7d", limit: "2", cursor }, "another-user"), "HISTORY_CURSOR_FILTER_MISMATCH");
  const [encoded, signature] = cursor.split(".");
  const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(encoded, "base64url")), asOf: "2027-01-01T00:00:00Z" })).toString("base64url");
  expectCode(() => parse({ range: "7d", limit: "2", cursor: tampered + "." + signature }), "INVALID_HISTORY_CURSOR");
  expectCode(() => parse({ cursor: "x".repeat(2049) }), "INVALID_HISTORY_CURSOR");
});

test("timestamps keep Postgres microseconds and normalize timezone offsets", () => {
  assert.equal(h.timestampMicros("2026-10-14T12:00:00.123456+09:00"), h.timestampMicros("2026-10-14T03:00:00.123456Z"));
  assert.equal(h.timestampMicros("2026-10-14T03:00:00.123457Z") - h.timestampMicros("2026-10-14T03:00:00.123456Z"), BigInt(1));
});

test("all three sources paginate timestamp ties without duplicates or omissions in either order", () => {
  const sameTime = "2026-10-14T10:00:00.000001Z";
  const rows = h.historyTypes.flatMap((type) => [1, 2, 3, 4].map((n) => ({ type, id: id(n), createdAt: sameTime })));
  rows.push({ type: "check", id: id(90), createdAt: "2026-10-14T10:00:00.000002Z" });
  rows.push({ type: "mail", id: id(91), createdAt: "2026-10-14T10:00:00.000000Z" });
  const newest = ["check:90", ...["mail", "document", "check"].flatMap((type) => [4, 3, 2, 1].map((n) => type + ":" + n)), "mail:91"];
  for (const sort of ["newest", "oldest"]) {
    for (const limit of [1, 2, 5, 20]) {
      const found = [];
      let cursor;
      do {
        const query = parse({ range: "all", sort, limit: String(limit), ...(cursor ? { cursor } : {}) });
        const candidates = h.historyTypes.flatMap((type) => rows
          .filter((row) => row.type === type && (!query.cursor || h.compareHistoryPositions(row, query.cursor, sort) > 0))
          .sort((a, b) => h.compareHistoryPositions(a, b, sort))
          .slice(0, limit + 1));
        const page = h.paginateHistory(candidates, query, KEY);
        found.push(...page.items.map((row) => row.type + ":" + Number(row.id.slice(-12))));
        cursor = page.nextCursor;
        assert.ok(found.length <= rows.length, "cursor must advance");
      } while (cursor);
      assert.deepEqual(found, sort === "newest" ? newest : [...newest].reverse());
    }
  }
});

test("source keyset SQL matches the cross-source tie order; count ignores cursor", () => {
  const first = parse({ range: "all", q: 'hello"),or(id.neq.x', limit: "2" });
  const cursor = h.createHistoryCursor(first, { createdAt: "2026-10-14T10:00:00.000001Z", type: "document", id: id(2) }, KEY);
  const query = parse({ range: "all", q: 'hello"),or(id.neq.x', limit: "2", cursor });
  assert.match(h.historyFilterExpression("check", query), /created_at\.lte\./);
  assert.match(h.historyFilterExpression("mail", query), /created_at\.lt\./);
  assert.match(h.historyFilterExpression("document", query), /id\.lt\.00000000/);
  assert.ok(h.historyFilterExpression("check", query).includes('hello\\"'));
  assert.ok(!h.historyFilterExpression("check", query, true).includes("created_at."));
  const ascending = parse({ range: "all", sort: "oldest" });
  ascending.cursor = query.cursor;
  assert.match(h.historyFilterExpression("mail", ascending), /created_at\.gte\./);
  assert.match(h.historyFilterExpression("check", ascending), /created_at\.gt\./);
  assert.match(h.historyFilterExpression("document", ascending), /id\.gt\./);
});

function makeRouteHarness() {
  const calls = [];
  const supabase = createClient("https://example.invalid", "not-a-real-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, method: init?.method, prefer: new Headers(init?.headers).get("prefer") });
      return new Response(init?.method === "HEAD" ? null : "[]", {
        status: 200, headers: { "content-type": "application/json", "content-range": "0-0/0" },
      });
    } },
  });
  class ApiError extends Error {
    constructor(status, code, message) { super(message); this.status = status; this.code = code; }
  }
  const route = loadTypescript("../src/app/api/history/overview/route.ts", {
    "@/lib/server/history-query": h,
    "@/lib/server/api": {
      ApiError, apiOk: (_id, result) => result,
      requireRole: async (_request, _id, role) => {
        assert.equal(role, "operator");
        return { user: { id: OWNER }, supabase };
      },
      withApiHandler: (_request, handler) => handler("test-request"),
    },
  });
  return { calls, invoke: (query) => route.GET({ nextUrl: new URL("https://example.invalid/api/history/overview?" + query) }) };
}

test("route list-only makes bounded owner-scoped requests and no count requests", async () => {
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
  try {
    const { calls, invoke } = makeRouteHarness();
    const result = await invoke("range=all&limit=50&includeSummary=false");
    assert.equal(result.summary, null);
    assert.equal(result.hasMore, false);
    assert.equal(result.nextCursor, null);
    assert.equal(calls.length, 3);
    for (const { url, method, prefer } of calls) {
      const ownerColumn = url.pathname.endsWith("audit_logs") ? "actor_id" : url.pathname.endsWith("ticket_sends") ? "sent_by" : "created_by";
      assert.equal(url.searchParams.get(ownerColumn), "eq." + OWNER);
      assert.equal(url.searchParams.get("limit"), "51");
      assert.equal(url.searchParams.get("order"), "created_at.desc,id.desc");
      assert.ok(url.searchParams.get("created_at").startsWith("lte."));
      assert.notEqual(method, "HEAD");
      assert.ok(!prefer?.includes("count=exact"));
    }
  } finally {
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test("route remains summary-compatible and invalid cursors never query history tables", async () => {
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
  try {
    const { calls, invoke } = makeRouteHarness();
    const result = await invoke("range=30d");
    assert.deepEqual(result.summary, { checks: 0, documents: 0, mails: 0, failures: 0 });
    assert.equal(calls.filter((call) => call.method === "HEAD").length, 6);
    calls.length = 0;
    await assert.rejects(() => invoke("range=all&cursor=invalid"), (error) => error.status === 400);
    assert.equal(calls.length, 0);
    await invoke("range=all&type=mail&status=pending&includeSummary=false");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.searchParams.get("status"), "eq.pending");
  } finally {
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});


function evaluateKeyset(expression, row) {
  if (!expression) return true;
  const group = /^(and|or)\((.*)\)$/.exec(expression);
  if (group) {
    const parts = [];
    let depth = 0, start = 0;
    for (let index = 0; index < group[2].length; index++) {
      const char = group[2][index];
      if (char === "(") depth++;
      if (char === ")") depth--;
      if (char === "," && depth === 0) {
        parts.push(group[2].slice(start, index));
        start = index + 1;
      }
    }
    parts.push(group[2].slice(start));
    const values = parts.map((part) => evaluateKeyset(part, row));
    return group[1] === "and" ? values.every(Boolean) : values.some(Boolean);
  }
  const leaf = /^(created_at|id)\.(lt|lte|gt|gte|eq)\.(.+)$/.exec(expression);
  assert.ok(leaf, "expected a PostgREST keyset predicate");
  const left = leaf[1] === "created_at" ? h.timestampMicros(row.createdAt) : row.id;
  const right = leaf[1] === "created_at" ? h.timestampMicros(leaf[3]) : leaf[3];
  return { lt: left < right, lte: left <= right, gt: left > right, gte: left >= right, eq: left === right }[leaf[2]];
}

test("generated per-table predicates select exactly the remaining global suffix at every cursor", () => {
  const rows = ["check", "document", "mail"].flatMap((type) =>
    [1, 2].flatMap((number) => [0, 1].map((micro) => ({
      type, id: id(number), createdAt: "2026-10-14T10:00:00.00000" + micro + "Z",
    }))),
  );
  // Expected order is defined independently of the production comparator.
  const descending = [...rows].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt) || b.type.localeCompare(a.type) || b.id.localeCompare(a.id));
  for (const sort of ["newest", "oldest"]) {
    const ordered = sort === "newest" ? descending : [...descending].reverse();
    for (let index = 0; index < ordered.length; index++) {
      const query = parse({ range: "all", sort });
      query.cursor = ordered[index];
      const actual = ordered.filter((row) => evaluateKeyset(h.historyFilterExpression(row.type, query), row));
      assert.deepEqual(actual, ordered.slice(index + 1));
    }
  }
});
