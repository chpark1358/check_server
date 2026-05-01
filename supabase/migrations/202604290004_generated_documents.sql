-- generated_documents: 점검 확인서 DOCX/PDF 메타데이터.
-- 실제 파일 바이트는 Storage bucket 'generated-documents'에 service role로 저장한다.
create table if not exists public.generated_documents (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  company_name text not null,
  serial text not null,
  engineer_name text,
  docx_path text not null,
  pdf_path text,
  pdf_status text not null check (pdf_status in ('success', 'failed', 'unavailable', 'not_requested')),
  pdf_error_summary text,
  attached_to_mail boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create index if not exists generated_documents_created_by_idx
  on public.generated_documents (created_by, created_at desc);
create index if not exists generated_documents_expires_at_idx
  on public.generated_documents (expires_at);

alter table public.generated_documents enable row level security;

drop policy if exists "generated_documents_owner_or_admin_select" on public.generated_documents;
create policy "generated_documents_owner_or_admin_select"
on public.generated_documents
for select
to authenticated
using (created_by = auth.uid() or public.current_profile_role() = 'admin');

drop policy if exists "generated_documents_owner_or_admin_update" on public.generated_documents;
create policy "generated_documents_owner_or_admin_update"
on public.generated_documents
for update
to authenticated
using (created_by = auth.uid() or public.current_profile_role() = 'admin')
with check (created_by = auth.uid() or public.current_profile_role() = 'admin');

drop policy if exists "generated_documents_admin_delete" on public.generated_documents;
create policy "generated_documents_admin_delete"
on public.generated_documents
for delete
to authenticated
using (public.current_profile_role() = 'admin');

-- INSERT는 service role(서버 API)만 수행. 별도 INSERT 정책을 만들지 않으면 authenticated에는 거부됨.

-- private storage bucket
insert into storage.buckets (id, name, public)
values ('generated-documents', 'generated-documents', false)
on conflict (id) do nothing;

-- bucket 객체는 service role로만 read/write. authenticated 클라이언트가 직접 다운로드하지 못하게 한다.
drop policy if exists "generated_documents_storage_service_select" on storage.objects;
create policy "generated_documents_storage_service_select"
on storage.objects
for select
to authenticated
using (false);

drop policy if exists "generated_documents_storage_no_anon" on storage.objects;
create policy "generated_documents_storage_no_anon"
on storage.objects
for all
to anon
using (false)
with check (false);
