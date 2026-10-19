import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../scripts/recovery-preflight.mjs", import.meta.url), "utf8");
// Execute the CLI entry point with isolated process state and mocked psql. No
// local env file, real credentials, executable, or network is accessed here.
const body = source
  .replace('import { spawn } from "node:child_process";', "")
  .replace('import { access } from "node:fs/promises";', "");
assert.doesNotMatch(body, /^import /m, "new imports require an explicit test double");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction("spawn", "access", "process", "console", body);
const SOURCE_REF = "ypszaogebsbynwzbatse";
const TARGET_REF = "svbxgzgdvrrsjzeyrfsc";
const PASSWORD = "fixture-secret-DoNotPrint";
const targetUrl = `postgresql://postgres.${TARGET_REF}:${PASSWORD}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require`;
const sourceUrl = `postgresql://postgres:${PASSWORD}@db.${SOURCE_REF}.supabase.co:5432/postgres`;
const empty = () => ({
  serverVersion: "17.6", serverVersionNum: 170006, transactionReadOnly: true,
  publicTables: [], authUserCount: 0, storageBucketCount: 0, storageObjectCount: 0,
});

async function harness(options = {}) {
  const output = [], calls = [], accessCalls = [];
  const env = { RECOVERY_TARGET_DB_URL: targetUrl, ...options.env };
  if (options.forbidSourceRead) Object.defineProperty(env, "RECOVERY_SOURCE_DB_URL", {
    get() { throw new Error("Source configuration must not be accessed"); },
  });
  const proc = { argv: ["node", "recovery-preflight.mjs", ...(options.args ?? ["--target-only"])], env };
  await run((executable, args, config) => {
    const index = calls.length;
    calls.push({ executable, args, config });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => child.emit("close", 1);
    queueMicrotask(() => {
      if (options.stderr) child.stderr.emit("data", Buffer.from(options.stderr));
      const row = options.rows?.[index] ?? empty();
      child.stdout.emit("data", Buffer.from(options.raw ?? JSON.stringify(row)));
      child.emit("close", options.status ?? 0);
    });
    return child;
  }, async executable => { accessCalls.push(executable); }, proc, {
    log(message) { output.push(message); },
  });
  assert.equal(output.length, 1, "only a single safe JSON report is printed");
  assert.doesNotMatch(output[0], new RegExp(PASSWORD));
  assert.ok(!output[0].includes(targetUrl) && !output[0].includes(sourceUrl));
  return { report: JSON.parse(output[0]), calls, accessCalls, exitCode: proc.exitCode ?? 0, raw: output[0] };
}

function assertStopped(result, phase, code) {
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.safeReady, false);
  assert.equal(result.report.fullRecoveryReady, false);
  assert.deepEqual(result.report.errors, [{ phase, code }]);
}

test("target-only checks an empty destination without claiming full recovery readiness", async () => {
  const result = await harness();
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.mode, "target-only");
  assert.equal(result.report.targetReady, true);
  assert.equal(result.report.safeReady, false);
  assert.equal(result.report.fullRecoveryReady, false);
  assert.equal(result.report.source, null);
  assert.deepEqual(result.report.target, empty());
  assert.deepEqual(result.report.errors, []);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].config.env.PGUSER, `postgres.${TARGET_REF}`);
});

test("target-only never reads even an invalid or forbidden source configuration", async () => {
  const result = await harness({ forbidSourceRead: true });
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.source, null);
  assert.equal(result.calls.length, 1);
});

test("unknown, duplicate, and combined mode arguments fail before any connection", async () => {
  for (const args of [["--source-only"], ["--target-only=true"], ["--target-only", "--target-only"], ["--target-only", sourceUrl], ["--full"]]) {
    const result = await harness({ args });
    assertStopped(result, "config", "UNEXPECTED_ARGUMENTS");
    assert.equal(result.calls.length, 0);
    assert.equal(result.accessCalls.length, 0);
  }
});

test("default full mode still requires the source URL and checks target before source", async () => {
  const missing = await harness({ args: [] });
  assertStopped(missing, "source-config", "DB_URL_REQUIRED");
  assert.equal(missing.calls.length, 0);
  const result = await harness({ args: [], env: { RECOVERY_SOURCE_DB_URL: sourceUrl }, rows: [empty(), { ...empty(), publicTables: ["profiles"], authUserCount: 3 }] });
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.mode, "full");
  assert.equal(result.report.targetReady, true);
  assert.equal(result.report.fullRecoveryReady, true);
  assert.equal(result.report.safeReady, true);
  assert.equal(result.calls.length, 2);
  assert.equal(result.calls[0].config.env.PGUSER, `postgres.${TARGET_REF}`);
  assert.equal(result.calls[1].config.env.PGHOST, `db.${SOURCE_REF}.supabase.co`);
});

test("target-only rejects the source project or unapproved destination settings", async () => {
  const cases = [
    [sourceUrl, "PROJECT_ENDPOINT_MISMATCH"],
    [targetUrl.replace(TARGET_REF, "unexpectedproject"), "PROJECT_ENDPOINT_MISMATCH"],
    [targetUrl.replace(":5432/", ":6543/"), "SESSION_POOLER_PORT_REQUIRED"],
    [targetUrl.replace("sslmode=require", "sslmode=disable"), "DB_URL_OPTIONS_NOT_ALLOWED"],
    [targetUrl + "&options=-c%20default_transaction_read_only%3Doff", "DB_URL_OPTIONS_NOT_ALLOWED"],
    [undefined, "DB_URL_REQUIRED"],
  ];
  for (const [value, code] of cases) {
    const result = await harness({ env: { RECOVERY_TARGET_DB_URL: value } });
    assertStopped(result, "target-config", code);
    assert.equal(result.calls.length, 0);
  }
});

test("occupied targets fail for each inventory category and never trigger a source read", async () => {
  for (const occupancy of [{ publicTables: ["profiles"] }, { authUserCount: 1 }, { storageBucketCount: 1 }, { storageObjectCount: 1 }]) {
    for (const args of [["--target-only"], []]) {
      const result = await harness({ args, env: { RECOVERY_SOURCE_DB_URL: sourceUrl }, rows: [{ ...empty(), ...occupancy }] });
      assertStopped(result, "target-check", "TARGET_NOT_EMPTY");
      assert.equal(result.report.targetReady, false);
      assert.equal(result.report.source, null);
      assert.equal(result.calls.length, 1);
    }
  }
});

test("psql enforces a read-only SQL transaction even if a pooler ignores startup settings", async () => {
  const result = await harness({ env: {
    PGOPTIONS: "-c default_transaction_read_only=off", PGSERVICEFILE: "untrusted-service", SUPABASE_SERVICE_ROLE_KEY: "private-fixture",
  } });
  const call = result.calls[0];
  assert.match(call.config.env.PGOPTIONS, /default_transaction_read_only=on/);
  assert.match(call.config.env.PGOPTIONS, /statement_timeout=15000/);
  assert.equal(call.config.env.PGSSLMODE, "require");
  assert.equal(call.config.env.PGPASSWORD, PASSWORD);
  assert.equal(call.config.env.PGSERVICEFILE, undefined);
  assert.equal(call.config.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(call.config.env.RECOVERY_TARGET_DB_URL, undefined);
  assert.equal(call.config.windowsHide, true);
  assert.ok(call.args.includes("--no-psqlrc") && call.args.includes("--no-password"));
  assert.ok(!JSON.stringify(call.args).includes(PASSWORD));
  assert.ok(!JSON.stringify(call.args).includes(targetUrl));
  const query = call.args[call.args.indexOf("--command") + 1];
  assert.match(query, /^\s*BEGIN TRANSACTION READ ONLY;/);
  assert.match(query, /SET LOCAL statement_timeout = '15s';/);
  assert.match(query, /SET LOCAL lock_timeout = '3s';/);
  assert.match(query, /SELECT json_build_object/);
  assert.match(query, /ROLLBACK;\s*$/);
  assert.doesNotMatch(query, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|COPY|TRUNCATE)\b/i);
  assert.match(query, /transaction_read_only/);
});

test("non-read-only or malformed inventories are rejected without exposing raw output", async () => {
  for (const row of [{ ...empty(), transactionReadOnly: false }, { ...empty(), authUserCount: -1 }, { ...empty(), publicTables: ["bad\nname"] }, { ...empty(), serverVersion: "private-fixture" }]) {
    const result = await harness({ rows: [row] });
    assertStopped(result, "target-read", row.transactionReadOnly === false ? "READ_ONLY_SESSION_NOT_ENFORCED" : "INVENTORY_RESPONSE_INVALID");
    assert.equal(result.report.target, null);
    assert.equal(result.report.targetReady, false);
  }
  const result = await harness({ raw: `unexpected private-fixture ${PASSWORD}` });
  assertStopped(result, "target-read", "INVENTORY_RESPONSE_INVALID");
  assert.ok(!result.raw.includes("private-fixture"));
});

test("inventory output omits arbitrary fields and provider errors never expose secrets", async () => {
  const success = await harness({ rows: [{ ...empty(), credential: PASSWORD, row: "private-fixture" }] });
  assert.equal(success.exitCode, 0);
  assert.deepEqual(success.report.target, empty());
  assert.ok(!success.raw.includes("private-fixture"));
  for (const [message, code] of [["password authentication failed", "AUTHENTICATION_FAILED"], ["permission denied", "READ_PERMISSION_DENIED"], ["provider private failure", "PSQL_READ_FAILED"]]) {
    const result = await harness({ status: 1, stderr: `${message} ${PASSWORD} ${targetUrl.split("?")[0]}` });
    assertStopped(result, "target-read", code);
  }
});

test("full mode preserves version compatibility checks", async () => {
  const result = await harness({ args: [], env: { RECOVERY_SOURCE_DB_URL: sourceUrl }, rows: [empty(), { ...empty(), serverVersion: "18.0", serverVersionNum: 180000 }] });
  assertStopped(result, "compatibility", "POSTGRES_VERSION_REVIEW_REQUIRED");
  assert.equal(result.report.targetReady, true);
  assert.equal(result.calls.length, 2);
});
