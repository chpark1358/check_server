alter table public.user_preferences
add column if not exists default_agent_status text not null default 'auto'
check (default_agent_status in ('auto', 'Y', 'N'));
