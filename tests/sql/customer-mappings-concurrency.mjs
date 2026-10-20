// Explicit local scratch test, not part of the ordinary unit-test discovery.
// Requires the synthetic fixture and migration. Never accepts a remote DB URL.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";

const executable = "C:/Program Files/PostgreSQL/17/bin/psql.exe";
const args = ["-X", "--host=127.0.0.1", "--port=55439", "--username=postgres",
  "--dbname=postgres", "--no-password", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-At"];
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
const ownerA = "ed000101-0000-4000-8000-000000000101";
const ownerB = "ed000102-0000-4000-8000-000000000102";
const idA = "ed000111-0000-4000-8000-000000000111";
const idB = "ed000112-0000-4000-8000-000000000112";
const collisionId = "ed000113-0000-4000-8000-000000000113";
const quote = (value) => "'" + String(value).replace(/'/g, "''") + "'";
const guard = `do $$ begin if inet_server_addr() <> '127.0.0.1'::inet or inet_server_port() <> 55439
  then raise exception 'Refusing non-local scratch target'; end if; end $$;`;
function sql(statement) {
  return execFileSync(executable, [...args, "-c", statement], {
    env, encoding: "utf8", windowsHide: true, timeout: 15000,
  }).trim();
}
function state(owner) {
  return JSON.parse(sql(`select public.customer_mail_mappings_state(${quote(owner)});`));
}
function row(id, serial, memo) {
  return { id, companyName: "Synthetic race", serial, zendeskOrgId: "fixture", requesterName: "",
    requesterEmail: "nobody@example.invalid", ccEmails: "", defaultEngineerName: "", memo };
}
function replace(owner, rows, revision) {
  return `select public.replace_customer_mail_mappings(${quote(owner)},${quote(JSON.stringify(rows))}::jsonb,${quote(revision)},false);`;
}
function run(statement) {
  const child = spawn(executable, args, { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  let releaseMarker;
  let markerSeen = false;
  const marker = new Promise((resolve, reject) => {
    releaseMarker = resolve;
    child.once("error", reject);
    child.once("close", (code) => { if (!markerSeen) reject(new Error(`Lock holder exited before marker: ${code} ${stderr}`)); });
  });
  // Consumers that do not need the marker still handle its eventual rejection.
  marker.catch(() => {});
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (!markerSeen && stdout.includes("LOCK_HELD")) { markerSeen = true; releaseMarker(); }
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
  const timer = setTimeout(() => child.kill(), 15000);
  done.finally(() => clearTimeout(timer));
  child.stdin.end(statement);
  return { marker, done };
}
const evidence = { target: "127.0.0.1:55439/postgres", syntheticOnly: true, remoteDbAccess: false, checks: [] };
let seeded = false;
try {
  sql(guard);
  assert.equal(sql(`select count(*) from auth.users where id in (${quote(ownerA)},${quote(ownerB)});`), "0");
  sql(`insert into auth.users(id) values (${quote(ownerA)}),(${quote(ownerB)});`);
  seeded = true;
  const initial = state(ownerA);
  const first = run(`begin; set local role service_role; ${replace(ownerA, [row(idA, "LO111", "first-writer")], initial.revision)}
    select 'LOCK_HELD'; select pg_sleep(1.5); commit;`);
  await first.marker;
  const started = performance.now();
  const second = run(`begin; set local role service_role; ${replace(ownerA, [row(idA, "LO111", "stale-writer")], initial.revision)} commit;`);
  const [firstResult, secondResult] = await Promise.all([first.done, second.done]);
  assert.equal(firstResult.code, 0);
  assert.notEqual(secondResult.code, 0);
  assert.match(secondResult.stderr, /PT409.*CUSTOMER_MAPPINGS_CONFLICT/);
  assert.equal(state(ownerA).mappings[0].memo, "first-writer");
  evidence.checks.push({ name: "same-owner concurrent stale writer is rejected after the lock", passed: true,
    waitedMs: Math.round(performance.now() - started), sqlstate: "PT409", finalWinner: "first-writer" });

  sql(`set role service_role; ${replace(ownerB, [row(idB, "LO222", "preserve-other")], state(ownerB).revision)}`);
  const beforeB = state(ownerB);
  const third = run(`begin; set local role service_role;
    ${replace(ownerA, [row(collisionId, "LO333", "collision-winner")], state(ownerA).revision)}
    select 'LOCK_HELD'; select pg_sleep(1.5); commit;`);
  await third.marker;
  const fourth = run(`begin; set local role service_role;
    ${replace(ownerB, [row(collisionId, "LO444", "collision-loser")], beforeB.revision)} commit;`);
  const [thirdResult, fourthResult] = await Promise.all([third.done, fourth.done]);
  assert.equal(thirdResult.code, 0);
  assert.notEqual(fourthResult.code, 0);
  assert.match(fourthResult.stderr, /PT409.*CUSTOMER_MAPPING_ID_CONFLICT/);
  assert.deepEqual(state(ownerB), beforeB);
  assert.equal(state(ownerA).mappings[0].memo, "collision-winner");
  evidence.checks.push({ name: "cross-owner UUID race rolls the losing owner's delete back", passed: true,
    sqlstate: "PT409", originalLosingOwnerStatePreserved: true });
} finally {
  if (seeded) {
    sql(`${guard} delete from auth.users where id in (${quote(ownerA)},${quote(ownerB)});`);
    assert.equal(sql(`select count(*) from public.customer_mail_mappings where user_id in (${quote(ownerA)},${quote(ownerB)});`), "0");
    evidence.syntheticRowsCleaned = true;
  }
}
console.log(JSON.stringify(evidence, null, 2));
