// Read-only readiness check. No dump, restore, DDL, DML or fallback .env loading.
// node --env-file=.env.recovery.local scripts/recovery-preflight.mjs
// Append --target-only to check just the recovery destination; this never marks
// the full recovery as ready and does not read the source connection setting.
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";

const PSQL = "C:/Program Files/PostgreSQL/17/bin/psql.exe";
const SOURCE_REF = "ypszaogebsbynwzbatse";
const TARGET_REF = "svbxgzgdvrrsjzeyrfsc";
// Session poolers may discard startup PGOPTIONS. Enforce read-only execution in
// the SQL transaction itself, and verify it in the inventory response.
const QUERY = `
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';
SELECT json_build_object(
  'serverVersion', current_setting('server_version'),
  'serverVersionNum', current_setting('server_version_num')::integer,
  'transactionReadOnly', current_setting('transaction_read_only') = 'on',
  'publicTables', COALESCE((
    SELECT json_agg(t.relname ORDER BY t.relname)
    FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relkind IN ('r', 'p', 'f')
  ), '[]'::json),
  'authUserCount', (SELECT count(*) FROM auth.users),
  'storageBucketCount', (SELECT count(*) FROM storage.buckets),
  'storageObjectCount', (SELECT count(*) FROM storage.objects)
);
ROLLBACK;`;

const report = {
  operation: "read-only-recovery-preflight",
  sourceProject: SOURCE_REF,
  targetProject: TARGET_REF,
  mode: "full",
  targetReady: false,
  fullRecoveryReady: false,
  safeReady: false,
  source: null,
  target: null,
  errors: [],
};

class SafeFailure extends Error {
  constructor(phase, code) {
    super("Recovery preflight stopped");
    this.phase = phase;
    this.code = code;
  }
}

function fail(phase, code) {
  throw new SafeFailure(phase, code);
}

function parseConnection(value, expectedRef, phase) {
  if (!value?.trim()) fail(phase, "DB_URL_REQUIRED");
  let url;
  try { url = new URL(value); } catch { fail(phase, "DB_URL_INVALID"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) fail(phase, "DB_PROTOCOL_INVALID");
  let user, password, database;
  try {
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch { fail(phase, "DB_URL_ENCODING_INVALID"); }
  if (!password || /[\u0000-\u001f\u007f]/.test(password)) fail(phase, "DB_PASSWORD_REQUIRED_OR_INVALID");
  if (url.hash) fail(phase, "DB_URL_FRAGMENT_NOT_ALLOWED");
  if (database !== "postgres") fail(phase, "DB_NAME_NOT_ALLOWED");
  if (url.port && url.port !== "5432") fail(phase, "SESSION_POOLER_PORT_REQUIRED");
  // A plain direct endpoint uses postgres; a session pooler requires a tenant-
  // qualified username. No password or host from the URL is ever printed.
  const direct = url.hostname === `db.${expectedRef}.supabase.co` && user === "postgres";
  const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) && user === `postgres.${expectedRef}`;
  if (!direct && !pooler) fail(phase, "PROJECT_ENDPOINT_MISMATCH");
  for (const [key, option] of url.searchParams) {
    if (key !== "sslmode" || !["require", "verify-full"].includes(option)) fail(phase, "DB_URL_OPTIONS_NOT_ALLOWED");
  }
  return { host: url.hostname, port: "5432", user, password, database, sslMode: url.searchParams.get("sslmode") ?? "require" };
}

function childEnvironment(connection) {
  // Do not forward inherited PG*, service files, project secrets or DB URLs.
  const env = {};
  for (const key of ["SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return {
    ...env,
    PGHOST: connection.host,
    PGPORT: connection.port,
    PGUSER: connection.user,
    PGPASSWORD: connection.password,
    PGDATABASE: connection.database,
    PGSSLMODE: connection.sslMode,
    PGCONNECT_TIMEOUT: "10",
    PGAPPNAME: "check-server-recovery-preflight",
    PGOPTIONS: "-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=3000",
    PGCLIENTENCODING: "UTF8",
    LC_ALL: "C",
  };
}

function summarizeFailure(stderr) {
  // psql errors can contain connection details; emit only known categories.
  if (/password authentication failed|wrong password|authentication failed/i.test(stderr)) return "AUTHENTICATION_FAILED";
  if (/permission denied/i.test(stderr)) return "READ_PERMISSION_DENIED";
  if (/timeout|timed out/i.test(stderr)) return "CONNECTION_OR_QUERY_TIMEOUT";
  if (/could not translate host|could not resolve|name or service not known/i.test(stderr)) return "DNS_LOOKUP_FAILED";
  if (/SSL|certificate/i.test(stderr)) return "TLS_CONNECTION_FAILED";
  if (/does not exist/i.test(stderr)) return "EXPECTED_MANAGED_SCHEMA_MISSING";
  return "PSQL_READ_FAILED";
}

async function readInventory(connection, phase) {
  const result = await new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(PSQL, ["--no-psqlrc", "--no-password", "--quiet", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1", "--command", QUERY], {
        env: childEnvironment(connection), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      reject(new SafeFailure(phase, "PSQL_START_FAILED"));
      return;
    }
    let stdout = "", stderr = "", tooLarge = false, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 30_000);
    const capture = stream => chunk => {
      if (stream === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
      if (stdout.length + stderr.length > 1_000_000) { tooLarge = true; child.kill(); }
    };
    child.stdout.on("data", capture("stdout"));
    child.stderr.on("data", capture("stderr"));
    child.on("error", () => { clearTimeout(timer); reject(new SafeFailure(phase, "PSQL_START_FAILED")); });
    child.on("close", code => {
      clearTimeout(timer);
      if (timedOut) reject(new SafeFailure(phase, "PREFLIGHT_TIMEOUT"));
      else if (tooLarge) reject(new SafeFailure(phase, "PREFLIGHT_OUTPUT_TOO_LARGE"));
      else if (code !== 0) reject(new SafeFailure(phase, summarizeFailure(stderr)));
      else resolve(stdout);
    });
  });
  let row;
  try { row = JSON.parse(result.trim()); } catch { fail(phase, "INVENTORY_RESPONSE_INVALID"); }
  if (row && typeof row === "object" && row.transactionReadOnly !== true) fail(phase, "READ_ONLY_SESSION_NOT_ENFORCED");
  if (!row || typeof row !== "object" ||
      typeof row.serverVersion !== "string" || !/^\d+(?:\.\d+)*(?: \([^\r\n]*\))?$/.test(row.serverVersion) ||
      !Number.isSafeInteger(row.serverVersionNum) || row.serverVersionNum < 100000 ||
      !Array.isArray(row.publicTables) || row.publicTables.some(name => typeof name !== "string" || name.length > 63 || /[\u0000-\u001f\u007f]/.test(name)) ||
      [row.authUserCount, row.storageBucketCount, row.storageObjectCount].some(count => !Number.isSafeInteger(count) || count < 0)) {
    fail(phase, "INVENTORY_RESPONSE_INVALID");
  }
  // Allowlisted fields only; never include psql stdout/stderr or arbitrary JSON.
  return {
    serverVersion: row.serverVersion, serverVersionNum: row.serverVersionNum,
    transactionReadOnly: true, publicTables: row.publicTables,
    authUserCount: row.authUserCount, storageBucketCount: row.storageBucketCount,
    storageObjectCount: row.storageObjectCount,
  };
}

let sourceConnection, targetConnection;
try {
  const args = process.argv.slice(2);
  const targetOnly = args.length === 1 && args[0] === "--target-only";
  if (args.length && !targetOnly) fail("config", "UNEXPECTED_ARGUMENTS");
  report.mode = targetOnly ? "target-only" : "full";
  if (SOURCE_REF === TARGET_REF) fail("config", "SOURCE_TARGET_MUST_DIFFER");
  if (!targetOnly) sourceConnection = parseConnection(process.env.RECOVERY_SOURCE_DB_URL, SOURCE_REF, "source-config");
  targetConnection = parseConnection(process.env.RECOVERY_TARGET_DB_URL, TARGET_REF, "target-config");
  if (sourceConnection && sourceConnection.host === targetConnection.host && sourceConnection.user === targetConnection.user) fail("config", "SOURCE_TARGET_MUST_DIFFER");
  try { await access(PSQL); } catch { fail("tooling", "PSQL_NOT_AVAILABLE"); }
  // Check the destination first; do not read source data if the target is occupied.
  report.target = await readInventory(targetConnection, "target-read");
  if (report.target.publicTables.length || report.target.authUserCount || report.target.storageObjectCount || report.target.storageBucketCount) {
    fail("target-check", "TARGET_NOT_EMPTY");
  }
  report.targetReady = true;
  if (!targetOnly) {
    report.source = await readInventory(sourceConnection, "source-read");
    if (report.source.serverVersionNum >= 180000 || report.target.serverVersionNum < report.source.serverVersionNum - (report.source.serverVersionNum % 10000)) {
      fail("compatibility", "POSTGRES_VERSION_REVIEW_REQUIRED");
    }
    report.fullRecoveryReady = true;
    report.safeReady = true;
  }
} catch (error) {
  report.errors.push(error instanceof SafeFailure ? { phase: error.phase, code: error.code } : { phase: "preflight", code: "PREFLIGHT_FAILED" });
  process.exitCode = 1;
} finally {
  if (sourceConnection) sourceConnection.password = "";
  if (targetConnection) targetConnection.password = "";
  console.log(JSON.stringify(report));
}
