create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  default_engineer_name text,
  default_server_model text not null default 'auto',
  default_iptables_status text not null default 'auto' check (default_iptables_status in ('auto', 'Y', 'N')),
  default_send_mode text not null default 'dry-run' check (default_send_mode in ('dry-run', 'real')),
  default_auto_solved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

drop policy if exists "user_preferences_owner_select" on public.user_preferences;
create policy "user_preferences_owner_select"
on public.user_preferences
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "user_preferences_owner_insert" on public.user_preferences;
create policy "user_preferences_owner_insert"
on public.user_preferences
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "user_preferences_owner_update" on public.user_preferences;
create policy "user_preferences_owner_update"
on public.user_preferences
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create index if not exists user_preferences_updated_at_idx
on public.user_preferences (updated_at desc);
