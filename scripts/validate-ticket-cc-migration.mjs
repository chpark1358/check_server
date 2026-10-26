// Offline verification in a disposable PostgreSQL 17 cluster; no env files or remote URLs.
// node scripts/validate-ticket-cc-migration.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const outputRoot = path.join(root, "test-results", "cc-support-20261021");
const runDir = path.join(outputRoot, `postgres-local-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const dataDir = path.join(runDir, "pgdata");
const bin = "C:/Program Files/PostgreSQL/17/bin";
const migrationPath = "supabase/migrations/202610210002_ticket_cc_snapshot.sql";
const migration = readFileSync(path.join(root, migrationPath), "utf8");
const foundation = readFileSync(path.join(root, "supabase/migrations/202604290001_security_foundation.sql"), "utf8");
const solveMigration = readFileSync(path.join(root, "supabase/migrations/202610210001_ticket_auto_solve_result.sql"), "utf8");
const hardening = readFileSync(path.join(root, "supabase/migrations/202610160002_document_access_hardening.sql"), "utf8");
const policy = hardening.match(/drop policy if exists "ticket_sends_operator_select"[\s\S]*?\n\);/i)?.[0];
assert.ok(policy, "Load the current ownership policy verbatim");
const env = Object.fromEntries(["SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH"]
  .filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(env, { PGCLIENTENCODING: "UTF8", PGAPPNAME: "check-server-local-cc-migration-test" });
const checks = [];
let started = false;
let port;
const report = {
  operation: "local-postgresql17-cc-snapshot-migration-verification",
  remoteDatabaseAccessed: false, productionModified: false, realZendeskCalls: 0,
  migration: migrationPath, migrationSha256: hash(migration),
  startedAt: new Date().toISOString(), status: "running", checks,
  runDirectory: path.relative(root, runDir).replaceAll("\\", "/"),
};
mkdirSync(outputRoot, { recursive: true });
mkdirSync(runDir);

function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function run(name, args, input = undefined, expectFailure = false) {
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
  return run("psql", ["--no-psqlrc", "--no-password", "--host=127.0.0.1", `--port=${port}`,
    "--username=fixture_owner", "--dbname=postgres", "--quiet", "--tuples-only", "--no-align",
    "--set=ON_ERROR_STOP=1", "--set=VERBOSITY=verbose", "--file=-"], text, expectFailure);
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
function newRow(key, cc) {
  return `INSERT INTO public.ticket_sends (sent_by,idempotency_key,subject,requester_email,status,cc_emails)
    VALUES ('${users.operator}','${key}','Synthetic CC fixture','requester@example.invalid','pending',${cc});`;
}
function reject(name, expression) {
  const result = sql(`BEGIN; ${newRow(`invalid-${checks.length}`, expression)} COMMIT;`, true);
  assert.match(result.err, /23514/, name);
  assert.match(result.err, /ticket_sends_cc_snapshot_check/, name);
  pass(name);
}
const baseSnapshot = `SELECT coalesce(jsonb_agg(to_jsonb(t)-'cc_emails' ORDER BY id), '[]'::jsonb) FROM public.ticket_sends t WHERE idempotency_key LIKE 'legacy-%';`;
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
  const identity = json("SELECT jsonb_build_object('version',current_setting('server_version'),'address',host(inet_server_addr()),'port',inet_server_port(),'dataDirectory',current_setting('data_directory'));");
  assert.equal(identity.address, "127.0.0.1");
  assert.equal(identity.port, port);
  assert.equal(path.resolve(identity.dataDirectory).toLowerCase(), dataDir.toLowerCase());
  report.serverVersion = identity.version;
  report.bindAddress = identity.address;
  pass("Disposable PostgreSQL binds loopback and uses only the task's data directory");
  sql(`CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    ${foundation}
    ${policy}
    ${solveMigration}
    GRANT USAGE ON SCHEMA public TO authenticated,anon,service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated,anon,service_role;
    INSERT INTO auth.users VALUES ${Object.values(users).map(id => `('${id}')`).join(",")};
    INSERT INTO public.profiles(id,email,role) VALUES ${Object.entries(users).map(([name,id]) => `('${id}','${name}@example.invalid','${name === "other" ? "operator" : name}')`).join(",")};
    INSERT INTO public.ticket_sends (sent_by,idempotency_key,subject,requester_email,status,auto_solved,zendesk_ticket_id,error_summary)
      SELECT '${users.operator}', 'legacy-'||i, 'Synthetic previous history '||i, 'requester@example.invalid',
        CASE WHEN i<=30 THEN 'dry_run' WHEN i<=40 THEN 'success' WHEN i<=45 THEN 'failed' ELSE 'pending' END,
        i%2=0, CASE WHEN i BETWEEN 31 AND 40 THEN (1000+i)::text ELSE NULL END,
        CASE WHEN i BETWEEN 41 AND 45 THEN 'Synthetic legacy failure' ELSE NULL END
      FROM generate_series(1,47) i;
    UPDATE public.ticket_sends SET auto_solve_status='not_requested',auto_solve_recorded_at='2026-10-21T02:55:37Z' WHERE idempotency_key='legacy-1';`);
  const beforeLegacy = json(baseSnapshot);
  assert.equal(beforeLegacy.length, 47);
  const beforeAccess = json(policySnapshot);
  sql(migration);
  assert.deepEqual(json(baseSnapshot), beforeLegacy);
  assert.equal(sql("SELECT count(*) FROM public.ticket_sends WHERE cc_emails IS NOT NULL;").out, "0");
  pass("All 47 synthetic historical rows preserve every value and retain NULL CC snapshots", { legacyRowCount: 47, legacySha256: hash(JSON.stringify(beforeLegacy)) });
  assert.deepEqual(json(policySnapshot), beforeAccess);
  pass("RLS policies and table ACL remain unchanged");
  assert.deepEqual(json("SELECT json_build_object('type',data_type,'udt',udt_name,'nullable',is_nullable,'default',column_default) FROM information_schema.columns WHERE table_schema='public' AND table_name='ticket_sends' AND column_name='cc_emails';"),
    { type: "ARRAY", udt: "_text", nullable: "YES", default: null });
  pass("CC column is nullable text[] with no default or legacy backfill");
  sql(migration);
  assert.deepEqual(json(baseSnapshot), beforeLegacy);
  assert.equal(sql("SELECT count(*) FROM pg_constraint WHERE conrelid='public.ticket_sends'::regclass AND conname='ticket_sends_cc_snapshot_check' AND convalidated;").out, "1");
  pass("Repeated migration is idempotent with one validated constraint");
  for (const [name, expression, expected] of [
    ["no-cc", "ARRAY[]::text[]", []],
    ["one-cc", "ARRAY['cc@example.invalid']", ["cc@example.invalid"]],
    ["48-cc", "ARRAY(SELECT 'cc'||i||'@example.invalid' FROM generate_series(1,48) i)", Array.from({ length: 48 }, (_, i) => `cc${i+1}@example.invalid`)],
  ]) {
    sql(`SET ROLE service_role; ${newRow(`recorded-${name}`, expression)} RESET ROLE;`);
    assert.deepEqual(json(`SELECT to_json(cc_emails) FROM public.ticket_sends WHERE idempotency_key='recorded-${name}';`), expected);
    pass(`Server persists ${name} snapshot exactly`);
  }
  for (const [name, expression] of [
    ["49 recipients exceed the supported limit", "ARRAY(SELECT 'cc'||i||'@example.invalid' FROM generate_series(1,49) i)"],
    ["NULL element is rejected", "ARRAY['cc@example.invalid',NULL]"],
    ["Empty element is rejected", "ARRAY['cc@example.invalid','']"],
    ["Two-dimensional array is rejected", "ARRAY[['one@example.invalid','two@example.invalid']]"],
    ["Zero lower bound is rejected", "'[0:0]={cc@example.invalid}'::text[]"],
    ["Negative lower bound is rejected", "'[-1:-1]={cc@example.invalid}'::text[]"],
    ["Non-one positive lower bound is rejected", "'[2:2]={cc@example.invalid}'::text[]"],
  ]) reject(name, expression);
  sql(`SET ROLE service_role;
    INSERT INTO public.ticket_sends(sent_by,idempotency_key,subject,status) VALUES('${users.operator}','old-writer','Old writer rollback fixture','pending');
    UPDATE public.ticket_sends SET status='success',zendesk_ticket_id='12345' WHERE idempotency_key='old-writer';
    UPDATE public.ticket_sends SET subject='Old writer preserves columns it does not know' WHERE idempotency_key='recorded-one-cc';
    RESET ROLE;`);
  assert.equal(sql("SELECT cc_emails IS NULL FROM public.ticket_sends WHERE idempotency_key='old-writer';").out, "t");
  pass("Old writer can insert and update without CC; its snapshot remains unknown");
  assert.deepEqual(json("SELECT to_json(cc_emails) FROM public.ticket_sends WHERE idempotency_key='recorded-one-cc';"), ["cc@example.invalid"]);
  pass("Old writer updating known columns preserves an existing CC snapshot");
  const countAll = Number(sql("SELECT count(*) FROM public.ticket_sends;").out);
  for (const [role, expected] of [["operator",countAll],["other",0],["admin",countAll],["viewer",0]]) {
    const output = sql(roleSession(users[role], "SELECT count(*) FROM public.ticket_sends;")).out.split(/\r?\n/).at(-1);
    assert.equal(Number(output), expected);
    pass(`Authenticated ${role} retains the existing history scope`, { visibleRows: expected });
  }
  assert.equal(sql("SET ROLE anon; SELECT count(*) FROM public.ticket_sends; RESET ROLE;").out, "0");
  pass("Anonymous users cannot read history or CC snapshots");
  for (const name of ["operator", "admin"]) {
    const insert = sql(roleSession(users[name], newRow(`forged-${name}`, "ARRAY['forged@example.invalid']")), true);
    assert.match(insert.err, /42501/);
    sql(roleSession(users[name], `DO $$DECLARE changed integer; BEGIN
      BEGIN UPDATE public.ticket_sends SET cc_emails=ARRAY['forged@example.invalid'] WHERE idempotency_key='recorded-one-cc';
        GET DIAGNOSTICS changed = ROW_COUNT; IF changed<>0 THEN RAISE EXCEPTION 'browser update escaped RLS'; END IF;
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN DELETE FROM public.ticket_sends WHERE idempotency_key='recorded-one-cc';
        GET DIAGNOSTICS changed = ROW_COUNT; IF changed<>0 THEN RAISE EXCEPTION 'browser delete escaped RLS'; END IF;
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END$$;`));
    pass(`Browser ${name} cannot forge, alter or delete CC snapshots`);
  }
  assert.deepEqual(json(baseSnapshot), beforeLegacy);
  const persistedBefore = json("SELECT jsonb_agg(to_jsonb(t) ORDER BY idempotency_key) FROM public.ticket_sends t;");
  stop(); start();
  const persistedAfter = json("SELECT jsonb_agg(to_jsonb(t) ORDER BY idempotency_key) FROM public.ticket_sends t;");
  assert.deepEqual(persistedAfter, persistedBefore);
  assert.deepEqual(json(baseSnapshot), beforeLegacy);
  assert.deepEqual(json(policySnapshot), beforeAccess);
  pass("Committed CC snapshots, legacy history and access rules survive PostgreSQL restart", { rowCount: persistedAfter.length, sha256: hash(JSON.stringify(persistedAfter)) });
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
