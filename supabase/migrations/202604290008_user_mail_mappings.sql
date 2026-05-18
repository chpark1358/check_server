alter table public.user_preferences
add column if not exists mail_body_template text not null default '';

create table if not exists public.customer_mail_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_name text not null default '',
  company_name_key text not null default '',
  serial text not null default '',
  serial_key text not null default '',
  zendesk_org_id text not null,
  requester_name text not null default '',
  requester_email text not null,
  cc_emails text not null default '',
  default_engineer_name text not null default '',
  memo text not null default '',
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (company_name_key <> '' or serial_key <> '')
);

alter table public.customer_mail_mappings enable row level security;

drop policy if exists "customer_mail_mappings_owner_select" on public.customer_mail_mappings;
create policy "customer_mail_mappings_owner_select"
on public.customer_mail_mappings
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "customer_mail_mappings_owner_insert" on public.customer_mail_mappings;
create policy "customer_mail_mappings_owner_insert"
on public.customer_mail_mappings
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "customer_mail_mappings_owner_update" on public.customer_mail_mappings;
create policy "customer_mail_mappings_owner_update"
on public.customer_mail_mappings
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "customer_mail_mappings_owner_delete" on public.customer_mail_mappings;
create policy "customer_mail_mappings_owner_delete"
on public.customer_mail_mappings
for delete
to authenticated
using (user_id = auth.uid());

create index if not exists customer_mail_mappings_user_updated_at_idx
on public.customer_mail_mappings (user_id, updated_at desc);

create unique index if not exists customer_mail_mappings_user_serial_key_idx
on public.customer_mail_mappings (user_id, serial_key)
where serial_key <> '';

create unique index if not exists customer_mail_mappings_user_company_key_idx
on public.customer_mail_mappings (user_id, company_name_key)
where company_name_key <> '' and serial_key = '';
