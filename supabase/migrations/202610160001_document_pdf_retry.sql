-- PDF 재시도는 기존 문서 행의 조건부 UPDATE로 한 작업만 선점한다.
-- started_at은 15분간 유효하다. 5분 route 제한보다 길게 설정하고,
-- 다음 명시적 재시도만 오래된 선점을 교체한다. token이 fencing key다.
alter table public.generated_documents
  add column if not exists pdf_retry_token uuid,
  add column if not exists pdf_retry_started_at timestamptz;

comment on column public.generated_documents.pdf_retry_token is
  'Server-only PDF retry fencing token. Finalize/release must compare this exact token.';
comment on column public.generated_documents.pdf_retry_started_at is
  'Server-only retry claim time. A new explicit retry may reclaim after 15 minutes.';

-- 기존 owner UPDATE 정책이 있어도 브라우저가 선점을 해제/교체할 수 없다.
create or replace function public.protect_document_pdf_retry_claim()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.pdf_retry_token is distinct from old.pdf_retry_token
      or new.pdf_retry_started_at is distinct from old.pdf_retry_started_at)
    and current_user not in ('postgres', 'supabase_admin', 'service_role')
    and coalesce(auth.role(), '') <> 'service_role'
  then
    raise exception 'PDF retry claims are managed by the server only' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_document_pdf_retry_claim on public.generated_documents;
create trigger protect_document_pdf_retry_claim
before update on public.generated_documents
for each row execute function public.protect_document_pdf_retry_claim();

notify pgrst, 'reload schema';
