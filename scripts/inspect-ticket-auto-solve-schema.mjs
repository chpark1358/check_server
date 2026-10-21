// Read-only inventory of the approved source project. Never prints connection details.
// node --env-file=.env.recovery.local scripts/inspect-ticket-auto-solve-schema.mjs
import { spawnSync } from "node:child_process";

const expectedRef = "ypszaogebsbynwzbatse";
const sql = `BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='3s';
SELECT json_build_object(
  'checkedAt', now(), 'readOnly', current_setting('transaction_read_only')='on',
  'rowCount', (SELECT count(*) FROM public.ticket_sends),
  'existingDataDigest', (SELECT md5(coalesce(string_agg((to_jsonb(t)-'auto_solve_status'-'auto_solve_error'-'auto_solve_recorded_at')::text, '|' ORDER BY id),'')) FROM public.ticket_sends t),
  'recordedCount', (SELECT count(*) FROM public.ticket_sends t WHERE to_jsonb(t)->>'auto_solve_status' IS NOT NULL),
  'columns', (SELECT coalesce(json_agg(json_build_object('name',column_name,'type',data_type,'nullable',is_nullable)), '[]') FROM information_schema.columns WHERE table_schema='public' AND table_name='ticket_sends' AND column_name IN ('auto_solve_status','auto_solve_error','auto_solve_recorded_at')),
  'constraints', (SELECT coalesce(json_agg(json_build_object('name',conname,'validated',convalidated)), '[]') FROM pg_constraint WHERE conrelid='public.ticket_sends'::regclass AND conname='ticket_sends_auto_solve_result_check'),
  'rls', (SELECT relrowsecurity FROM pg_class WHERE oid='public.ticket_sends'::regclass),
  'writePolicyCount', (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='ticket_sends' AND cmd IN ('INSERT','UPDATE','DELETE','ALL'))
); ROLLBACK;`;

try {
  const url = new URL(process.env.RECOVERY_SOURCE_DB_URL ?? "");
  const user = decodeURIComponent(url.username), password = decodeURIComponent(url.password);
  const allowedHost = (url.hostname === `db.${expectedRef}.supabase.co` && user === "postgres") ||
    (/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) && user === `postgres.${expectedRef}`);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !allowedHost || !password ||
      decodeURIComponent(url.pathname) !== "/postgres" || (url.port && url.port !== "5432") || url.hash ||
      [...url.searchParams].some(([key,value]) => key !== "sslmode" || !["require","verify-full"].includes(value))) throw new Error("INVALID_SOURCE_CONFIG");
  const env = Object.fromEntries(["SystemRoot","SYSTEMROOT","WINDIR","TEMP","TMP"].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  Object.assign(env,{PGHOST:url.hostname,PGPORT:"5432",PGUSER:user,PGPASSWORD:password,PGDATABASE:"postgres",
    PGSSLMODE:url.searchParams.get("sslmode") || "require",PGCLIENTENCODING:"UTF8",PGCONNECT_TIMEOUT:"10",PGAPPNAME:"check-server-solve-schema-readonly"});
  const r = spawnSync("C:/Program Files/PostgreSQL/17/bin/psql.exe",["-X","-w","-qAt","-v","ON_ERROR_STOP=1","-c",sql],
    {env,encoding:"utf8",windowsHide:true,timeout:25000,maxBuffer:200000});
  if(r.error || r.status!==0) throw new Error("READ_ONLY_PREFLIGHT_FAILED");
  const result=JSON.parse(r.stdout.trim());
  if(result.readOnly!==true) throw new Error("READ_ONLY_GUARD_FAILED");
  console.log(JSON.stringify(result,null,2));
} catch (error) {
  console.error(JSON.stringify({ok:false,code:["INVALID_SOURCE_CONFIG","READ_ONLY_PREFLIGHT_FAILED","READ_ONLY_GUARD_FAILED"].includes(error.message)?error.message:"INVALID_SOURCE_CONFIG"}));
  process.exitCode=1;
}
