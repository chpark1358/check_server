create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  role text not null default 'viewer' check (role in ('admin', 'operator', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.ticket_drafts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id),
  organization_id text,
  requester_email text,
  subject text not null,
  body text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ticket_sends (
  id uuid primary key default gen_random_uuid(),
  sent_by uuid not null references auth.users(id),
  idempotency_key text not null,
  zendesk_ticket_id text,
  zendesk_ticket_url text,
  organization_id text,
  requester_email text,
  group_id text,
  assignee_email text,
  subject text not null,
  attachment_count int not null default 0,
  auto_solved boolean not null default false,
  status text not null check (status in ('pending', 'success', 'failed', 'dry_run')),
  error_summary text,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.ticket_drafts enable row level security;
alter table public.ticket_sends enable row level security;
alter table public.audit_logs enable row level security;

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.current_profile_rank()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case public.current_profile_role()
    when 'admin' then 3
    when 'operator' then 2
    when 'viewer' then 1
    else 0
  end
$$;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.current_profile_role() = 'admin');

drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update"
on public.profiles
for update
to authenticated
using (public.current_profile_role() = 'admin')
with check (public.current_profile_role() = 'admin');

drop policy if exists "app_settings_authenticated_select" on public.app_settings;
create policy "app_settings_authenticated_select"
on public.app_settings
for select
to authenticated
using (true);

drop policy if exists "app_settings_admin_write" on public.app_settings;
create policy "app_settings_admin_write"
on public.app_settings
for all
to authenticated
using (public.current_profile_role() = 'admin')
with check (public.current_profile_role() = 'admin');

drop policy if exists "ticket_drafts_owner_select" on public.ticket_drafts;
create policy "ticket_drafts_owner_select"
on public.ticket_drafts
for select
to authenticated
using (created_by = auth.uid() or public.current_profile_rank() >= 2);

drop policy if exists "ticket_drafts_operator_write" on public.ticket_drafts;
create policy "ticket_drafts_operator_write"
on public.ticket_drafts
for all
to authenticated
using (created_by = auth.uid() and public.current_profile_rank() >= 2)
with check (created_by = auth.uid() and public.current_profile_rank() >= 2);

drop policy if exists "ticket_sends_operator_select" on public.ticket_sends;
create policy "ticket_sends_operator_select"
on public.ticket_sends
for select
to authenticated
using (public.current_profile_rank() >= 2);

drop policy if exists "audit_logs_admin_select" on public.audit_logs;
create policy "audit_logs_admin_select"
on public.audit_logs
for select
to authenticated
using (public.current_profile_role() = 'admin');

create index if not exists ticket_sends_created_at_idx
on public.ticket_sends (created_at desc);

create unique index if not exists ticket_sends_sent_by_idempotency_key_idx
on public.ticket_sends (sent_by, idempotency_key);

create index if not exists audit_logs_created_at_idx
on public.audit_logs (created_at desc);
