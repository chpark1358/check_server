-- LOCAL SCRATCH DATABASE ONLY. Never run against shared Preview/Production.
-- Requires the existing customer_mail_mappings schema and the new migration.
-- All fixture rows, trigger/function objects, and changes are rolled back.
-- psql -v ON_ERROR_STOP=1 -f tests/sql/customer-mappings-atomic.sql <local DB>
begin;
set local statement_timeout = '15s';
set local lock_timeout = '3s';

do $$
begin
  if exists (
    select 1 from auth.users
    where id in ('ed000001-0000-4000-8000-000000000001'::uuid, 'ed000002-0000-4000-8000-000000000002'::uuid)
  ) then raise exception 'Fixture IDs already exist; refusing to run'; end if;
  if has_function_privilege('anon', 'public.customer_mail_mappings_state(uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.customer_mail_mappings_state(uuid)', 'execute')
    or has_function_privilege('anon', 'public.replace_customer_mail_mappings(uuid,jsonb,text,boolean)', 'execute')
    or has_function_privilege('authenticated', 'public.replace_customer_mail_mappings(uuid,jsonb,text,boolean)', 'execute')
    or not has_function_privilege('service_role', 'public.replace_customer_mail_mappings(uuid,jsonb,text,boolean)', 'execute') then
    raise exception 'Function execute grants are unsafe';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('customer_mail_mappings_state', 'replace_customer_mail_mappings')
      and p.prosecdef
  ) then raise exception 'Functions must be SECURITY INVOKER'; end if;
end $$;

insert into auth.users (id) values
  ('ed000001-0000-4000-8000-000000000001'),
  ('ed000002-0000-4000-8000-000000000002');
insert into public.customer_mail_mappings (
  id, user_id, company_name, company_name_key, serial, serial_key,
  zendesk_org_id, requester_email, created_at
) values (
  'ed000011-0000-4000-8000-000000000011', 'ed000001-0000-4000-8000-000000000001',
  'Synthetic owner', 'synthetic owner', 'LO123', '123', 'fixture', 'nobody@example.invalid', '2000-01-01Z'
), (
  'ed000022-0000-4000-8000-000000000022', 'ed000002-0000-4000-8000-000000000002',
  'Synthetic other', 'synthetic other', 'LO987', '987', 'fixture', 'nobody@example.invalid', '2000-01-01Z'
);

create function pg_temp.reject_synthetic_mapping() returns trigger
language plpgsql as $$
begin
  if new.memo = '__force_failure__' then
    raise exception 'Synthetic failure after DELETE, before INSERT completes' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger customer_mapping_synthetic_failure before insert on public.customer_mail_mappings
for each row execute function pg_temp.reject_synthetic_mapping();

create function pg_temp.assert_mapping_rejected(
  p_rows jsonb, p_revision text, p_empty boolean, p_expected_code text
) returns void language plpgsql as $$
declare
  v_before jsonb := public.customer_mail_mappings_state('ed000001-0000-4000-8000-000000000001');
  v_other jsonb := public.customer_mail_mappings_state('ed000002-0000-4000-8000-000000000002');
  v_failed boolean := false;
begin
  begin
    perform public.replace_customer_mail_mappings(
      'ed000001-0000-4000-8000-000000000001', p_rows, p_revision, p_empty
    );
  exception when others then
    if sqlstate <> p_expected_code then
      raise exception 'Expected %, got %', p_expected_code, sqlstate;
    end if;
    v_failed := true;
  end;
  if not v_failed then raise exception 'Expected rejection but write succeeded'; end if;
  if public.customer_mail_mappings_state('ed000001-0000-4000-8000-000000000001') <> v_before
    or public.customer_mail_mappings_state('ed000002-0000-4000-8000-000000000002') <> v_other then
    raise exception 'Rejected write changed existing data';
  end if;
end $$;

set local role service_role;
do $$
declare
  v_owner constant uuid := 'ed000001-0000-4000-8000-000000000001';
  v_before jsonb := public.customer_mail_mappings_state(v_owner);
  v_other jsonb := public.customer_mail_mappings_state('ed000002-0000-4000-8000-000000000002');
  v_revision text := v_before->>'revision';
  v_row jsonb := jsonb_build_object(
    'id', 'ed000011-0000-4000-8000-000000000011', 'companyName', 'Synthetic owner',
    'serial', 'LO123', 'zendeskOrgId', 'fixture', 'requesterName', '',
    'requesterEmail', 'nobody@example.invalid', 'ccEmails', '', 'defaultEngineerName', '', 'memo', 'changed'
  );
  v_saved jsonb;
begin
  perform pg_temp.assert_mapping_rejected('[{}]', v_revision, false, 'PT400');
  perform pg_temp.assert_mapping_rejected(jsonb_build_array(v_row || '{"serial":"invalid"}'), v_revision, false, 'PT400');
  perform pg_temp.assert_mapping_rejected(jsonb_build_array(v_row, null), v_revision, false, 'PT400');
  perform pg_temp.assert_mapping_rejected('{}', v_revision, false, 'PT400');
  perform pg_temp.assert_mapping_rejected(
    (select jsonb_agg(v_row) from generate_series(1, 201)), v_revision, false, 'PT400'
  );
  perform pg_temp.assert_mapping_rejected(jsonb_build_array(v_row), null, false, 'PT428');
  perform pg_temp.assert_mapping_rejected('[]', v_revision, false, 'PT400');
  perform pg_temp.assert_mapping_rejected(jsonb_build_array(
    v_row, v_row || '{"serial":"LO456"}'
  ), v_revision, false, 'PT400');
  perform pg_temp.assert_mapping_rejected(jsonb_build_array(
    v_row, v_row || '{"id":"ed000033-0000-4000-8000-000000000033","serial":"123"}'
  ), v_revision, false, 'PT400');
  perform pg_temp.assert_mapping_rejected(jsonb_build_array(
    v_row || '{"serial":""}',
    v_row || '{"id":"ed000033-0000-4000-8000-000000000033","serial":"","companyName":" SYNTHETIC OWNER "}'
  ), v_revision, false, 'PT400');
  perform pg_temp.assert_mapping_rejected(jsonb_build_array(
    v_row || '{"id":"ed000022-0000-4000-8000-000000000022"}'
  ), v_revision, false, 'PT409');
  -- This fault is injected after DELETE. Transaction rollback must restore exact old rows.
  perform pg_temp.assert_mapping_rejected(jsonb_build_array(
    v_row || '{"memo":"__force_failure__"}'
  ), v_revision, false, '23514');

  v_saved := public.replace_customer_mail_mappings(v_owner, jsonb_build_array(v_row), v_revision, false);
  if v_saved->>'revision' = v_revision or v_saved->'mappings'->0->>'memo' <> 'changed' then
    raise exception 'Successful replacement did not return its committed state';
  end if;
  if (select created_at from public.customer_mail_mappings where id = (v_row->>'id')::uuid) <> '2000-01-01Z'::timestamptz then
    raise exception 'Original creation timestamp was lost';
  end if;
  perform pg_temp.assert_mapping_rejected(jsonb_build_array(v_row), v_revision, false, 'PT409');

  -- Same company, different serials and a company-only fallback are valid.
  v_saved := public.replace_customer_mail_mappings(v_owner, jsonb_build_array(
    v_row,
    v_row || '{"id":"ed000033-0000-4000-8000-000000000033","serial":"LO456"}',
    v_row || '{"id":"ed000044-0000-4000-8000-000000000044","serial":""}'
  ), v_saved->>'revision', false);
  if jsonb_array_length(v_saved->'mappings') <> 3 then raise exception 'Valid mapping rows were lost'; end if;
  v_saved := public.replace_customer_mail_mappings(v_owner, '[]', v_saved->>'revision', true);
  if v_saved->'mappings' <> '[]'::jsonb then raise exception 'Explicit clear failed'; end if;
  if public.customer_mail_mappings_state('ed000002-0000-4000-8000-000000000002') <> v_other then
    raise exception 'Other owner was modified';
  end if;
  raise notice 'PASS: validation, owner isolation, failed-insert rollback, stale revision, successful replacement, explicit clear';
end $$;

reset role;
set local role authenticated;
do $$
begin
  begin
    perform public.customer_mail_mappings_state('ed000001-0000-4000-8000-000000000001');
    raise exception 'Authenticated role unexpectedly executed server-only RPC';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
