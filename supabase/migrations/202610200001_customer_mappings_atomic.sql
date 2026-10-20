-- Additive: no existing rows, indexes, policies, or table grants are changed.
-- Deploy the API together with the revision-aware client after installing these functions.
-- Advisory locks serialize this RPC's writers only. Legacy APIs/direct table writes do
-- not participate; do not mix old and new writers for the same user during validation.
begin;

create or replace function public.customer_mail_mappings_state(p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
set timezone = 'UTC'
as $function$
  select jsonb_build_object(
    'mappings', coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id,
      'companyName', m.company_name,
      'serial', m.serial,
      'zendeskOrgId', m.zendesk_org_id,
      'requesterName', m.requester_name,
      'requesterEmail', m.requester_email,
      'ccEmails', m.cc_emails,
      'defaultEngineerName', m.default_engineer_name,
      'memo', m.memo
    ) order by m.updated_at desc, m.id), '[]'::jsonb),
    'revision', encode(extensions.digest(
      coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb)::text,
      'sha256'
    ), 'hex')
  )
  from public.customer_mail_mappings m
  where m.user_id = p_user_id;
$function$;

create or replace function public.replace_customer_mail_mappings(
  p_user_id uuid,
  p_mappings jsonb,
  p_expected_revision text,
  p_allow_empty boolean default false
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_item jsonb;
  v_field text;
  v_id uuid;
  v_company text;
  v_serial_key text;
  v_rows jsonb := '[]'::jsonb;
  v_now timestamptz;
  v_created_at timestamptz;
  v_last_used_at timestamptz;
  v_current jsonb;
begin
  if p_user_id is null then
    raise sqlstate 'PT400' using message = 'INVALID_CUSTOMER_MAPPINGS';
  end if;
  if p_expected_revision is null or p_expected_revision !~ '^[0-9a-f]{64}$' then
    raise sqlstate 'PT428' using message = 'CUSTOMER_MAPPINGS_REVISION_REQUIRED';
  end if;
  if p_mappings is null or jsonb_typeof(p_mappings) <> 'array' then
    raise sqlstate 'PT400' using message = 'INVALID_CUSTOMER_MAPPINGS';
  end if;
  if jsonb_array_length(p_mappings) > 200
    or (jsonb_array_length(p_mappings) = 0 and p_allow_empty is distinct from true) then
    raise sqlstate 'PT400' using message = 'INVALID_CUSTOMER_MAPPINGS';
  end if;

  -- This lock also works when the owner currently has no rows.
  perform pg_advisory_xact_lock(hashtextextended('customer_mail_mappings:' || p_user_id::text, 0));
  v_current := public.customer_mail_mappings_state(p_user_id);
  if v_current->>'revision' <> p_expected_revision then
    raise sqlstate 'PT409' using message = 'CUSTOMER_MAPPINGS_CONFLICT';
  end if;
  v_now := clock_timestamp();

  for v_item in select value from jsonb_array_elements(p_mappings) loop
    if jsonb_typeof(v_item) <> 'object'
      or jsonb_typeof(v_item->'id') is distinct from 'string'
      or (v_item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise sqlstate 'PT400' using message = 'INVALID_CUSTOMER_MAPPINGS';
    end if;
    foreach v_field in array array[
      'companyName', 'serial', 'zendeskOrgId', 'requesterName', 'requesterEmail',
      'ccEmails', 'defaultEngineerName', 'memo'
    ] loop
      if jsonb_typeof(v_item->v_field) is distinct from 'string'
        or length(v_item->>v_field) > 8192 then
        raise sqlstate 'PT400' using message = 'INVALID_CUSTOMER_MAPPINGS';
      end if;
    end loop;
    v_id := (v_item->>'id')::uuid;
    v_company := btrim(v_item->>'companyName');
    v_serial_key := regexp_replace(v_item->>'serial', '[^0-9]', '', 'g');
    if (v_company = '' and v_serial_key = '')
      or (btrim(v_item->>'serial') <> '' and v_serial_key = '')
      or btrim(v_item->>'zendeskOrgId') = '' or btrim(v_item->>'requesterEmail') = '' then
      raise sqlstate 'PT400' using message = 'INVALID_CUSTOMER_MAPPINGS';
    end if;
    if exists (
      select 1 from public.customer_mail_mappings
      where id = v_id and user_id <> p_user_id
    ) then
      raise sqlstate 'PT409' using message = 'CUSTOMER_MAPPING_ID_CONFLICT';
    end if;
    v_created_at := null;
    v_last_used_at := null;
    select created_at, last_used_at into v_created_at, v_last_used_at
    from public.customer_mail_mappings where id = v_id and user_id = p_user_id;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'id', v_id, 'user_id', p_user_id,
      'company_name', v_company, 'company_name_key', lower(v_company),
      'serial', case when v_serial_key = '' then '' else 'LO' || v_serial_key end,
      'serial_key', v_serial_key,
      'zendesk_org_id', btrim(v_item->>'zendeskOrgId'),
      'requester_name', btrim(v_item->>'requesterName'),
      'requester_email', btrim(v_item->>'requesterEmail'),
      'cc_emails', btrim(v_item->>'ccEmails'),
      'default_engineer_name', btrim(v_item->>'defaultEngineerName'),
      'memo', btrim(v_item->>'memo'),
      'created_at', coalesce(v_created_at, v_now),
      'updated_at', v_now,
      'last_used_at', v_last_used_at
    ));
  end loop;

  if exists (select 1 from jsonb_array_elements(v_rows) r group by r->>'id' having count(*) > 1)
    or exists (
      select 1 from jsonb_array_elements(v_rows) r where r->>'serial_key' <> ''
      group by r->>'serial_key' having count(*) > 1
    ) or exists (
      select 1 from jsonb_array_elements(v_rows) r
      where r->>'serial_key' = '' and r->>'company_name_key' <> ''
      group by r->>'company_name_key' having count(*) > 1
    ) then
    raise sqlstate 'PT400' using message = 'INVALID_CUSTOMER_MAPPINGS';
  end if;

  -- No API/network boundary may occur between these statements.
  delete from public.customer_mail_mappings where user_id = p_user_id;
  insert into public.customer_mail_mappings (
    id, user_id, company_name, company_name_key, serial, serial_key,
    zendesk_org_id, requester_name, requester_email, cc_emails,
    default_engineer_name, memo, created_at, updated_at, last_used_at
  )
  select r.id, r.user_id, r.company_name, r.company_name_key, r.serial, r.serial_key,
    r.zendesk_org_id, r.requester_name, r.requester_email, r.cc_emails,
    r.default_engineer_name, r.memo, r.created_at, r.updated_at, r.last_used_at
  from jsonb_to_recordset(v_rows) as r(
    id uuid, user_id uuid, company_name text, company_name_key text,
    serial text, serial_key text, zendesk_org_id text, requester_name text,
    requester_email text, cc_emails text, default_engineer_name text, memo text,
    created_at timestamptz, updated_at timestamptz, last_used_at timestamptz
  );
  return public.customer_mail_mappings_state(p_user_id);
exception when unique_violation then
  -- A cross-owner UUID collision racing the ownership check must roll back too.
  raise sqlstate 'PT409' using message = 'CUSTOMER_MAPPING_ID_CONFLICT';
end;
$function$;

revoke all on function public.customer_mail_mappings_state(uuid) from public, anon, authenticated;
revoke all on function public.replace_customer_mail_mappings(uuid, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.customer_mail_mappings_state(uuid) to service_role;
grant execute on function public.replace_customer_mail_mappings(uuid, jsonb, text, boolean) to service_role;

comment on function public.replace_customer_mail_mappings(uuid, jsonb, text, boolean)
  is 'Server-only atomic owner-scoped replacement with an expected snapshot revision; legacy direct writers do not take its advisory lock.';
commit;
