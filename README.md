# Check Server Site

Next.js App Router + TypeScript 기반 운영자용 웹 콘솔. OfficeKeeper 정기점검 결과를 Zendesk 티켓으로 발송합니다.

## Development

```bash
npm install
npm run dev
```

## Validation

```bash
npm run lint
npm run typecheck
npm run build
```

## Environment

`.env.example`을 `.env.local`로 복사하세요. 서버 전용 값에는 절대 `NEXT_PUBLIC_` 접두사를 붙이지 마세요 — Zendesk API 토큰과 Supabase service role key가 브라우저 번들에 포함되면 안 됩니다.

### 필수 (앱 부팅 시 검증)

- `ZENDESK_SUBDOMAIN`, `ZENDESK_EMAIL`, `ZENDESK_API_TOKEN` — Zendesk Basic auth (이메일/토큰)
- `SUPABASE_SERVICE_ROLE_KEY` — RLS bypass용 서버 클라이언트
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — 브라우저 인증

### 발송 동작 게이트

- `ALLOW_REAL_ZENDESK_SEND=true` **AND** `VERCEL_ENV=production` — 둘 다 true일 때만 실제 Zendesk 티켓 생성. 그 외는 dry-run (UI 상단에 `DRY-RUN` 배지로 표시).

### 운영 기본값 (Supabase `app_settings.zendesk`로 덮어쓰기 가능)

- `ZENDESK_DEFAULT_GROUP_ID`, `ZENDESK_DEFAULT_GROUP_NAME` — 티켓 그룹
- `ZENDESK_FIXED_ASSIGNEE_EMAIL` — 고정 담당자 (없으면 `ZENDESK_EMAIL` 사용)
- `ZENDESK_SUPPORT_ADDRESS` — 표시용
- `SOLUTION_API_BASE_URL`, `SOLUTION_API_TOKEN` — OfficeKeeper 점검 수집 API

### Rate limit (선택)

요청 횟수 제한은 Vercel KV(또는 Upstash Redis)에 카운트를 보관합니다. 미설정 시 in-process fallback으로 작동하나 서버리스 환경(Vercel functions)에서는 인스턴스마다 카운트가 분리되어 효력이 약해집니다. 운영에서 의미 있는 제한이 필요하면 KV를 연결하세요.

- `KV_REST_API_URL`, `KV_REST_API_TOKEN` — Vercel KV 연결 시 자동 주입
- 또는 `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — Upstash Redis 직접 사용 시
- KV 호출 자체가 실패해도(네트워크/할당량) 운영을 막지 않도록 자동으로 메모리 fallback. 다만 분산 보호 효력은 그 동안 약화됨

### PDF 변환 (선택)

확인서 PDF는 [ConvertAPI](https://www.convertapi.com)의 DOCX → PDF 엔드포인트(`POST https://v2.convertapi.com/convert/docx/to/pdf`)로 위임합니다. 미설정 시 PDF 생성은 자동 비활성화되고 DOCX만 제공됩니다 (사용자에게 안내됨).

- `CONVERTAPI_TOKEN` — ConvertAPI 콘솔의 *API Credentials → Tokens*에서 발급한 Bearer 토큰. 서버 전용 (NEXT_PUBLIC_ 금지)

요금/한도:
- 무료 티어: 250 변환/월. 정기점검 발송이 일 수 건 수준이면 무료 한도 내.
- 초과 시 패키지 결제 ([https://www.convertapi.com/a/pricing](https://www.convertapi.com/a/pricing))

운영 메모:
- 한글 폰트는 ConvertAPI가 자체 처리(별도 폰트 설치 필요 없음)
- 어댑터(60초 abort) → ConvertAPI는 보통 2–10초 응답
- 토큰 노출 시 즉시 콘솔에서 revoke + 재발급

## Supabase 마이그레이션

`supabase/migrations/` 순서대로 적용:

1. `202604290001_security_foundation.sql` — `profiles`, `app_settings`, `ticket_sends`, `audit_logs` 테이블 + RLS 정책 + role 함수
2. `202604290002_profile_bootstrap.sql` — 신규 가입자 자동 viewer 부여 트리거
3. `202604290003_drop_ticket_drafts.sql` — 미사용 schema 정리
4. `202604290004_generated_documents.sql` — 점검 확인서 영속화: `generated_documents` 테이블 + RLS + private storage bucket(`generated-documents`) + storage 정책
5. `202604290005_engineer_signatures.sql` — 점검자 서명 PNG 영속화: `engineer_signatures` 테이블 + RLS (operator+ select, admin write) + private bucket(`engineer-signatures`)

### 점검자 서명 일괄 업로드 (선택)

새 점검자 PNG들을 한 번에 등록할 때 사용. 로컬 디렉토리에 PNG 파일들을 두고:

```bash
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/upload-signatures.mjs ./path/to/signature-pngs
```

파일 이름 → 점검자 이름 매핑 (예: `김기홍.png` → `name="김기홍"`). Storage 키는 한글 키 제약 때문에 UTF-8 hex로 자동 인코딩됩니다 (DB의 `storage_path`에 hex 그대로 저장). 운영 중 일반 추가는 `POST /api/engineer-signatures`(admin) 사용.

### 점검자 서명 운영 (admin)

업로드/교체: `POST /api/engineer-signatures` (multipart `name`, `file`) — admin 전용
삭제: `DELETE /api/engineer-signatures/{id}` — admin 전용
조회: `GET /api/engineer-signatures` — operator 이상

### 생성 문서 보관 정책

- 기본 30일 (`generated_documents.expires_at = created_at + 30 days`)
- 다운로드/메일 첨부 모두 본인 또는 admin만 가능 (RLS + 코드 게이트 2중 방어)
- 만료된 문서는 `supabase/maintenance/cleanup_expired_documents.sql` 스크립트로 수동 정리 (1차 운영). cron 자동화는 트래픽 보고 추후 도입.
- Storage 객체 삭제는 DB row와 함께 운영자가 수동 진행

## 첫 admin 부트스트랩

신규 가입자는 트리거에 의해 자동으로 `viewer` 역할이 부여됩니다. 첫 admin은 직접 SQL로 승급해야 합니다:

```sql
update public.profiles
set role = 'admin'
where email = 'your-admin@example.com';
```

이후 admin은 `app_settings.zendesk`에 운영 설정을 저장하고, 다른 사용자의 role(`operator`/`admin`)을 SQL로 부여합니다 (UI에는 권한 관리 화면 없음).

## 권한 체계

| 역할 | 가능한 작업 |
|---|---|
| `viewer` | 조직/사용자/그룹 검색, OfficeKeeper 점검 수집, health |
| `operator` | viewer + 발송 (POST tickets), 첨부 업로드, 발송 이력 조회 |
| `admin` | operator + 설정 변경, audit log 조회 |

서버는 `requireRole()`로 코드 레벨 검증, DB는 RLS로 2차 방어. 서버는 service role key로 RLS를 우회하지만 코드 레벨 게이트가 1차 방어선입니다.

## Vercel 배포

1. Vercel 프로젝트 생성 후 Node 22 런타임 지정 (`engines.node`와 일치)
2. 환경 변수: 위 "필수"와 "운영 기본값" 모두 production scope에 입력
3. `ALLOW_REAL_ZENDESK_SEND`는 production scope에서만 `true`. preview/development는 비워두면 dry-run 강제됨
4. 배포 후 `/api/health`로 `zendeskSendMode`, `missingServerEnv`(admin) 확인
