// Explicit, offline migration verification against a disposable local PostgreSQL 17.
// No .env files or remote database URLs are loaded. Cluster files are retained for review.
// node scripts/validate-ticket-auto-solve-migration.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const outputRoot = path.join(root, "test-results", "solve-persistence-20261021");
const runDir = path.join(outputRoot, `postgres-local-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const dataDir = path.join(runDir, "pgdata");
const bin = "C:/Program Files/PostgreSQL/17/bin";
const migrationPath = "supabase/migrations/202610210001_ticket_auto_solve_result.sql";
const migration = readFileSync(path.join(root, migrationPath), "utf8");
const foundation = readFileSync(path.join(root, "supabase/migrations/202604290001_security_foundation.sql"), "utf8");
const hardening = readFileSync(path.join(root, "supabase/migrations/202610160002_document_access_hardening.sql"), "utf8");
const policy = hardening.match(/drop policy if exists "ticket_sends_operator_select"[\s\S]*?\n\);/i)?.[0];
assert.ok(policy, "The existing ticket ownership policy must be loaded verbatim");
const env = Object.fromEntries(["SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
env.PGCLIENTENCODING = "UTF8";
env.PGAPPNAME = "check-server-local-migration-test";
const checks = [];
let started = false;
let port;
const report = {
  operation: "local-postgresql17-auto-solve-migration-verification",
  remoteDatabaseAccessed: false, productionModified: false, realZendeskCalls: 0,
  migration: migrationPath, migrationSha256: hash(migration),
  startedAt: new Date().toISOString(), status: "running", checks,
  runDirectory: path.relative(root, runDir).replaceAll("\\", "/"),
};
mkdirSync(outputRoot, { recursive: true });
mkdirSync(runDir);

function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function run(name, args, input = undefined, expectFailure = false) {
  // Windows postgres children can inherit pg_ctl's stdout handle. A regular
  // logfile avoids waiting for a pipe's EOF until the database server exits.
  const redirect = name === "pg_ctl" && ["start", "stop"].includes(args[0]);
  const controlLog = path.join(runDir, `pg-ctl-${args[0]}.log`);
  const descriptor = redirect ? openSync(controlLog, "w") : undefined;
  let result;
  try {
    result = spawnSync(path.join(bin, `${name}.exe`), args, {
      env, cwd: root, input, encoding: "utf8", windowsHide: true, timeout: 45_000, maxBuffer: 2 * 1024 * 1024,
      ...(redirect ? { stdio: ["ignore", descriptor, descriptor] } : {}),
    });
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
  if (redirect) result.stdout = readFileSync(controlLog, "utf8");
  if (result.error || (expectFailure ? result.status === 0 : result.status !== 0)) {
    writeFileSync(path.join(runDir, "tool-failure.log"), `${name}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    throw new Error(`${name} ${result.error?.code ?? `exit_${result.status}`} (${expectFailure ? "expected failure" : "expected success"})`);
  }
  return { out: (result.stdout ?? "").trim(), err: result.stderr ?? "" };
}
function sql(text, expectFailure = false) {
  return run("psql", ["--no-psqlrc", "--no-password", "--host=127.0.0.1", `--port=${port}`, "--username=fixture_owner", "--dbname=postgres", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1", "--set=VERBOSITY=verbose", "--file=-"], text, expectFailure);
}
function json(text) { return JSON.parse(sql(text).out); }
function pass(name, details = {}) { checks.push({ name, passed: true, ...details }); }
function start() {
  started = true;
  run("pg_ctl", ["start", "--wait", "--timeout=30", "--pgdata", dataDir, "--log", path.join(runDir, "postgres.log"), "--options", `-h 127.0.0.1 -p ${port}`]);
}
function stop() { run("pg_ctl", ["stop", "--wait", "--timeout=30", "--mode=fast", "--pgdata", dataDir]); started = false; }
function roleSession(userId, statement) {
  return `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${userId}', true); ${statement} ROLLBACK;`;
}
const users = {
  operator: "11111111-1111-4111-8111-111111111111",
  other: "22222222-2222-4222-8222-222222222222",
  admin: "33333333-3333-4333-8333-333333333333",
  viewer: "44444444-4444-4444-8444-444444444444",
};
const columns = "sent_by,idempotency_key,subject,auto_solved,status,zendesk_ticket_id,error_summary";
function newRow(key, { requested = true, send = "success", ticket = "'12345'", outcome = "'solved'", error = "NULL", recorded = "'2026-10-21T01:00:00Z'" } = {}) {
  return `INSERT INTO public.ticket_sends (${columns},auto_solve_status,auto_solve_error,auto_solve_recorded_at)
    VALUES ('${users.operator}','${key}','Synthetic migration fixture',${requested},'${send}',${ticket},NULL,${outcome},${error},${recorded});`;
}
function expectedCheckFailure(name, overrides) {
  const result = sql(`BEGIN; ${newRow(`invalid-${checks.length}`, overrides)} COMMIT;`, true);
  assert.match(result.err, /23514/, name);
  pass(name);
}
const baseSnapshot = `SELECT coalesce(jsonb_agg(to_jsonb(t) - 'auto_solve_status' - 'auto_solve_error' - 'auto_solve_recorded_at' ORDER BY id), '[]'::jsonb) FROM public.ticket_sends t WHERE idempotency_key LIKE 'legacy-%';`;
const policySnapshot = `SELECT jsonb_build_object('rls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.ticket_sends'::regclass),'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='ticket_sends'),'acl',(SELECT relacl::text FROM pg_class WHERE oid='public.ticket_sends'::regclass));`;
try {
  for (const tool of ["initdb", "pg_ctl", "psql"]) assert.match(run(tool, ["--version"]).out, /\b17\./);
  const server = net.createServer();
  port = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const value = server.address().port; server.close(error => error ? reject(error) : resolve(value)); });
  });
  run("initdb", ["--pgdata", dataDir, "--username=fixture_owner", "--auth=trust", "--encoding=UTF8", "--locale=C", "--no-instructions"]);
  start();
  const serverIdentity = json("SELECT jsonb_build_object('version',current_setting('server_version'),'address',host(inet_server_addr()),'port',inet_server_port(),'dataDirectory',current_setting('data_directory'));");
  assert.equal(serverIdentity.address, "127.0.0.1");
  assert.equal(serverIdentity.port, port);
  assert.equal(path.resolve(serverIdentity.dataDirectory).toLowerCase(), dataDir.toLowerCase());
  report.serverVersion = serverIdentity.version;
  report.bindAddress = serverIdentity.address;
  pass("Disposable PostgreSQL 17 binds only loopback and uses the task's data directory");
  sql(`CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    ${foundation}
    ${policy}
    GRANT USAGE ON SCHEMA public TO authenticated,anon,service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated,anon,service_role;
    INSERT INTO auth.users VALUES ${Object.values(users).map(id => `('${id}')`).join(",")};
    INSERT INTO public.profiles(id,email,role) VALUES ${Object.entries(users).map(([name,id]) => `('${id}','${name}@example.invalid','${name === "other" ? "operator" : name}')`).join(",")};
    INSERT INTO public.ticket_sends (${columns}) VALUES
      ('${users.operator}','legacy-requested','Legacy request only',true,'success','1001',NULL),
      ('${users.operator}','legacy-failed-solve','Legacy solve warning',true,'success','1002','Synthetic solve error'),
      ('${users.operator}','legacy-not-requested','Legacy no solve',false,'success','1003',NULL),
      ('${users.operator}','legacy-dry-run','Legacy dry run',true,'dry_run',NULL,NULL),
      ('${users.operator}','legacy-pending','Legacy pending',true,'pending',NULL,'Unconfirmed');`);
  const beforeLegacy = json(baseSnapshot);
  const beforeAccess = json(policySnapshot);
  sql(migration);
  assert.deepEqual(json(baseSnapshot), beforeLegacy);
  assert.equal(sql("SELECT count(*) FROM public.ticket_sends WHERE auto_solve_status IS NOT NULL OR auto_solve_error IS NOT NULL OR auto_solve_recorded_at IS NOT NULL;").out, "0");
  assert.deepEqual(json(policySnapshot), beforeAccess);
  pass("Migration preserves every legacy column value and leaves all new legacy fields NULL", { legacyRowCount: beforeLegacy.length, legacySha256: hash(JSON.stringify(beforeLegacy)) });
  pass("Existing RLS policies and table grants remain unchanged");
  sql(migration);
  assert.deepEqual(json(baseSnapshot), beforeLegacy);
  assert.equal(sql("SELECT count(*) FROM pg_constraint WHERE conrelid='public.ticket_sends'::regclass AND conname='ticket_sends_auto_solve_result_check';").out, "1");
  pass("Migration can be applied twice without duplicate constraints or data changes");
  for (const [name, values] of [
    ["solved", {}], ["failed", { outcome: "'failed'", error: "'Synthetic solve failure'" }],
    ["not-requested", { requested: false, outcome: "'not_requested'" }],
    ["dry-run", { send: "dry_run", ticket: "NULL", outcome: "'not_requested'" }],
    ["unknown", { outcome: "'unknown'", error: "'Synthetic uncertain result'" }],
  ]) { sql(`SET ROLE service_role; ${newRow(`recorded-${name}`, values)} RESET ROLE;`); pass(`Server writer persists ${name} result`); }
  for (const [name, values] of [
    ["Invalid result status is rejected", { outcome: "'invented'" }],
    ["Result without recorded timestamp is rejected", { recorded: "NULL" }],
    ["Infinite recorded timestamp is rejected", { recorded: "'infinity'" }],
    ["Error without result status is rejected", { outcome: "NULL", error: "'orphan'", recorded: "NULL" }],
    ["Timestamp without result status is rejected", { outcome: "NULL" }],
    ["Solved result cannot carry an error", { error: "'not empty'" }],
    ["Failed result requires a nonempty error", { outcome: "'failed'", error: "NULL" }],
    ["Whitespace-only failed error is rejected", { outcome: "'failed'", error: "'  '" }],
    ["Solved result requires the request flag", { requested: false }],
    ["Solved result requires a confirmed send", { send: "pending" }],
    ["Solved result requires a ticket ID", { ticket: "NULL" }],
    ["Blank ticket ID is rejected for solved results", { ticket: "'  '" }],
    ["Dry-run cannot be recorded as solved", { send: "dry_run" }],
    ["Requested real solve cannot be recorded as not requested", { outcome: "'not_requested'" }],
  ]) expectedCheckFailure(name, values);
  sql(`SET ROLE service_role;
    INSERT INTO public.ticket_sends (${columns}) VALUES ('${users.operator}','old-writer-after-migration','Old writer after rollback',true,'pending',NULL,NULL);
    UPDATE public.ticket_sends SET status='success',zendesk_ticket_id='1004' WHERE idempotency_key='old-writer-after-migration';
    RESET ROLE;`);
  assert.equal(sql("SELECT count(*) FROM public.ticket_sends WHERE idempotency_key='old-writer-after-migration' AND auto_solve_status IS NULL AND auto_solve_error IS NULL AND auto_solve_recorded_at IS NULL;").out, "1");
  pass("Old writer insert/update remains compatible and leaves results unrecorded");
  const countAll = Number(sql("SELECT count(*) FROM public.ticket_sends;").out);
  for (const [role, expected] of [["operator",countAll],["other",0],["admin",countAll],["viewer",0]]) {
    const output = sql(roleSession(users[role], "SELECT count(*) FROM public.ticket_sends;")).out.split(/\r?\n/).at(-1);
    assert.equal(Number(output), expected);
    pass(`Authenticated ${role} retains the existing history read scope`, { visibleRows: expected });
  }
  for (const name of ["operator", "admin"]) {
    const result = sql(roleSession(users[name], newRow(`forged-${name}`)), true);
    assert.match(result.err, /42501/);
    sql(roleSession(users[name], `DO $$DECLARE changed integer; BEGIN
      BEGIN UPDATE public.ticket_sends SET auto_solve_status='solved',auto_solve_recorded_at=now() WHERE idempotency_key='legacy-requested';
        GET DIAGNOSTICS changed = ROW_COUNT; IF changed <> 0 THEN RAISE EXCEPTION 'browser update escaped RLS'; END IF;
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN DELETE FROM public.ticket_sends WHERE idempotency_key='legacy-requested';
        GET DIAGNOSTICS changed = ROW_COUNT; IF changed <> 0 THEN RAISE EXCEPTION 'browser delete escaped RLS'; END IF;
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END$$;`));
    pass(`Browser ${name} cannot forge, update or delete persisted outcomes`);
  }
  assert.deepEqual(json(baseSnapshot), beforeLegacy);
  const persistedBefore = json("SELECT jsonb_agg(to_jsonb(t) ORDER BY idempotency_key) FROM public.ticket_sends t;");
  stop();
  start();
  const persistedAfter = json("SELECT jsonb_agg(to_jsonb(t) ORDER BY idempotency_key) FROM public.ticket_sends t;");
  assert.deepEqual(persistedAfter, persistedBefore);
  assert.deepEqual(json(policySnapshot), beforeAccess);
  pass("Committed outcomes and unchanged legacy history survive a PostgreSQL restart", { rowCount: persistedAfter.length, sha256: hash(JSON.stringify(persistedAfter)) });
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = error instanceof Error ? error.message : "Unknown local verification failure";
  process.exitCode = 1;
} finally {
  if (started) {
    try { stop(); report.clusterStopped = true; }
    catch (error) { report.clusterStopped = false; report.status = "failed"; report.stopFailure = error.message; process.exitCode = 1; }
  } else report.clusterStopped = true;
  report.finishedAt = new Date().toISOString();
  report.checkCount = checks.length;
  writeFileSync(path.join(runDir, "verification.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(outputRoot, "local-postgres-verification.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
