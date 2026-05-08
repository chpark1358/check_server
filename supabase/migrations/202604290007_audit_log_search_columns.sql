alter table public.audit_logs
  add column if not exists serial text,
  add column if not exists company_name text,
  add column if not exists search_text text;

update public.audit_logs
set
  serial = nullif(coalesce(metadata->>'serial', target_id), ''),
  company_name = nullif(metadata->>'companyName', ''),
  search_text = lower(
    concat_ws(
      ' ',
      action,
      target_type,
      target_id,
      metadata->>'actorEmail',
      metadata->>'serial',
      metadata->>'companyName',
      metadata->>'companyId',
      metadata->>'requesterEmail',
      metadata->>'errorSummary'
    )
  )
where search_text is null;

create index if not exists audit_logs_actor_created_at_idx
on public.audit_logs (actor_id, created_at desc);

create index if not exists audit_logs_actor_action_created_at_idx
on public.audit_logs (actor_id, action, created_at desc);

create index if not exists audit_logs_serial_idx
on public.audit_logs (serial);

create index if not exists audit_logs_company_name_idx
on public.audit_logs (company_name);
