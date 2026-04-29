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
- `SOLUTION_API_BASE_URL`, `SOLUTION_API_TOKEN` — 고객사/시리얼 조회 API

## Supabase 마이그레이션

`supabase/migrations/` 순서대로 적용:

1. `202604290001_security_foundation.sql` — `profiles`, `app_settings`, `ticket_sends`, `audit_logs` 테이블 + RLS 정책 + role 함수
2. `202604290002_profile_bootstrap.sql` — 신규 가입자 자동 viewer 부여 트리거
3. `202604290003_drop_ticket_drafts.sql` — 미사용 schema 정리

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
| `viewer` | 조직/사용자/그룹 검색, 고객사 조회, health |
| `operator` | viewer + 발송 (POST tickets), 첨부 업로드, 발송 이력 조회 |
| `admin` | operator + 설정 변경, audit log 조회 |

서버는 `requireRole()`로 코드 레벨 검증, DB는 RLS로 2차 방어. 서버는 service role key로 RLS를 우회하지만 코드 레벨 게이트가 1차 방어선입니다.

## Vercel 배포

1. Vercel 프로젝트 생성 후 Node 22 런타임 지정 (`engines.node`와 일치)
2. 환경 변수: 위 "필수"와 "운영 기본값" 모두 production scope에 입력
3. `ALLOW_REAL_ZENDESK_SEND`는 production scope에서만 `true`. preview/development는 비워두면 dry-run 강제됨
4. 배포 후 `/api/health`로 `zendeskSendMode`, `missingServerEnv`(admin) 확인
