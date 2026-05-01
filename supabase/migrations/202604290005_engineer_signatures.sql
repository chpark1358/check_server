-- engineer_signatures: 점검자 이름과 Storage 서명 PNG 매핑.
-- 실제 PNG는 Storage bucket 'engineer-signatures'에 service role로 저장한다.
create table if not exists public.engineer_signatures (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  storage_path text not null,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists engineer_signatures_name_idx
  on public.engineer_signatures (name);

alter table public.engineer_signatures enable row level security;

drop policy if exists "engineer_signatures_operator_select" on public.engineer_signatures;
create policy "engineer_signatures_operator_select"
on public.engineer_signatures
for select
to authenticated
using (public.current_profile_rank() >= 2);

drop policy if exists "engineer_signatures_admin_write" on public.engineer_signatures;
create policy "engineer_signatures_admin_write"
on public.engineer_signatures
for all
to authenticated
using (public.current_profile_role() = 'admin')
with check (public.current_profile_role() = 'admin');

-- private storage bucket
insert into storage.buckets (id, name, public)
values ('engineer-signatures', 'engineer-signatures', false)
on conflict (id) do nothing;

-- bucket 객체 접근은 service role만 (직접 다운로드 금지). 기존 generated_documents와 동일한 패턴.
-- 별도 policy를 추가하지 않으면 authenticated/anon은 거부됨.
