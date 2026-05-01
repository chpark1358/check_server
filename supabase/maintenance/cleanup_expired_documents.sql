-- 만료(expires_at < now)된 generated_documents 정리.
-- 이 스크립트는 Storage 객체는 함께 삭제하지 않습니다 -- DB row만 정리합니다.
-- Storage 정리는 운영자가 별도로 진행하세요:
--   1) 아래 쿼리로 정리 대상 paths 확인
--   2) Supabase 대시보드 > Storage > generated-documents에서 동일 path 수동 삭제
--      또는 supabase CLI: supabase storage rm "generated-documents/<path>"

-- 1. 만료된 row와 storage path 출력 (DELETE 전 검토용)
select
  id,
  created_by,
  company_name,
  serial,
  docx_path,
  pdf_path,
  expires_at
from public.generated_documents
where expires_at < now()
order by expires_at asc;

-- 2. 실제 삭제 (검토 후 실행)
-- delete from public.generated_documents
-- where expires_at < now();
