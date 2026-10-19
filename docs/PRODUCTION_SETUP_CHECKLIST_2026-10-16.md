# 운영 반영 전 설정·계정·복구 준비 — 2026-10-16

## 2026-10-19 최신 확인과 다음 작업

사용자가 로컬 입력 페이지에 저장한 `check_server_recover` 연결 정보로 대상 PostgreSQL 17.11 접속을 확인했다. `scripts/recovery-preflight.mjs --target-only`는 원본 연결값을 읽지 않고, 명시적인 `BEGIN TRANSACTION READ ONLY` 안에서 고정 SELECT를 실행한 뒤 `ROLLBACK`으로 종료한다. Session pooler가 접속 시 PGOPTIONS의 읽기 전용 설정을 적용하지 않는 것을 확인해 SQL 트랜잭션에서도 이를 강제했다.

실제 결과는 public 업무 테이블 0개, Auth 사용자 0명, Storage 버킷 0개·객체 0개였다. `targetReady=true`이며 원본을 검사하지 않았으므로 `fullRecoveryReady=false`, `safeReady=false`를 유지한다. 실제 복원·DDL·DML은 실행하지 않았다. 대상 정보의 추가 입력은 필요하지 않다. 검사 도구의 관련 회귀 테스트 10개와 ESLint를 통과했다.

추가로 `scripts/export-recovery-app-data.mjs`를 이용해 원본 Data API에 GET 요청만 보내고 **public 업무 테이블 8개, 총 967행·552,226 bytes**를 로컬에 백업했다. 두 차례 조회에서 모든 테이블의 건수와 내용 SHA-256이 일치했다. 관련 회귀 테스트 **11개**를 통과했다. 원본·대상 DB 쓰기, 원격 DB·Storage 복원, main 반영·Production 배포는 수행하지 않았다.

이 부분 백업의 10개 파일을 **97,331 bytes ZIP**으로 묶고 별도 로컬 폴더에 실제로 풀어 모든 파일의 해시 일치를 확인했다. 또한 이번 업무 데이터가 참조하는 문서 185개·서명 11개, **총 196개 참조**를 10월 16일 Storage 백업의 manifest 및 로컬 파일 해시와 대조해 누락 0개·불일치 0개를 확인했다. 이는 로컬 백업 간 정합성 검사이며 현재 원격 Storage를 다시 조회한 검사나 DB·Storage의 원자적 시점 일관성 검사는 아니다. ZIP 로컬 복원도 Supabase DB·Storage 원격 복원을 뜻하지 않는다.

| 백업한 업무 테이블 | 행 수 |
| --- | ---: |
| `app_settings` | 0 |
| `audit_logs` | 770 |
| `customer_mail_mappings` | 40 |
| `engineer_signatures` | 11 |
| `generated_documents` | 94 |
| `profiles` | 10 |
| `ticket_sends` | 41 |
| `user_preferences` | 1 |

이 사본은 **부분 업무 데이터 백업**이다. PostgreSQL 스키마·함수·권한·RLS·확장, Auth 인증 정보, 관리 스키마, Storage 파일 내용은 포함하지 않는다. 두 번 읽은 내용이 같더라도 테이블 전체를 하나의 트랜잭션에서 확보한 시점 일관성은 증명하지 않는다. 사용자 ID 참조를 보존했으나 로그인 사용자 자체를 복원할 수 있는 사본은 아니다. API에 노출되지 않은 `ticket_drafts`의 실제 DB 존재 여부도 이번 검사로 확정하지 않았다. 데이터 행·개인정보·키는 이 문서에 싣지 않고, 원본 NDJSON은 로컬 제한 보관 자료로 취급한다.

원본 `check_server`의 Aside Supabase 로그인과 실제 Dashboard 접근을 확인했다. **2026-10-19 확인한 최근 백업 7개는 모두 Physical이며 Restore만 있고 Download는 없었다. 최신 시각은 2026-10-19 03:34:40 KST다.** 아래 10월 16일 백업 시각은 과거 기록으로 유지한다. 원본 Connect에서 싱가포르 Session pooler `aws-1-ap-southeast-1`·포트 `5432`·DB `postgres`·원본 ref를 확인했지만 DB 비밀번호는 placeholder여서 확보되지 않았다.

현재 필요한 것은 **[원본 전용 로컬 입력 페이지](http://127.0.0.1:8800/)에 기존 check_server DB 비밀번호만 저장**하는 것이다. 주소와 원본 연결 정보는 미리 채웠고, 저장된 복구 대상 정보는 보존한다. 대상 비밀번호 재입력은 필요 없다. 원본 전용 입력 도구의 가상 입력 검사 14개를 통과했으며, 별도로 백업 도구 11개·복구 사전 검사 10개 합계 21개와 대상 lint를 통과했다. 이를 10월 16일 Preview 전체 214개 테스트와 합산하지 않는다.

전체 스키마·Auth 백업 확보 → 빈 대상 재검사·복원 → Auth·RLS·Storage 검증 → 발송 차단 Production 후보 검증 순서다. 전체 백업 확보 전에는 대상에 부분 데이터를 먼저 넣지 않는다. 원본·대상 데이터 쓰기나 원격 복원은 실행하지 않았다.

공식 Dashboard 다운로드는 기존 logical backup에 한정되며 physical backup은 직접 다운로드할 수 없다. 현재 원본 화면에서도 Physical 백업만 확인돼 원본 PostgreSQL 연결로 전체 백업을 확보할 경로를 준비했다. API 연결 정보와 PostgreSQL 접속 정보는 서로 다르며, 기존 비밀번호를 임의로 재설정하지 않는다. [Supabase Dashboard 백업 복원](https://supabase.com/docs/guides/platform/migrating-within-supabase/dashboard-restore), [Supabase DB 백업](https://supabase.com/docs/guides/platform/backups)

이번 증거는 HTML 보고서 폴더 기준 `main-readiness/source-backup-access-2026-10-19.json`, `main-readiness/app-data-backup-2026-10-19/manifest.json` 및 `main-readiness/app-data-local-restore-verification-2026-10-19.json`, 구현은 `scripts/export-recovery-app-data.mjs`, 검사는 `tests/recovery-app-data-export.test.mjs`에 있다. 아래 10월 16일 기록의 대상 연결 대기 상태는 이 최신 확인으로 대체한다.

이 문서는 `d294d6b1ae5e7402d71b10a66055feaa5aa961a3`를 기준으로 시작한 운영 전 준비사항이다. 실제 원격 main 반영·Production 배포는 수행하지 않았다. 사용자가 Production OAuth 변수를 추가했고, 후속 준비 과정에서 Production 발송 설정을 `false`로 변경한 뒤 재확인했다. 발송 이력 보완과 서명 등록의 이번 작업 결과를 아래에 구분한다.

## 현재 확인 결과

| 우선순위 | 항목 | 상태 | 다음 완료 기준 |
| --- | --- | --- | --- |
| P0 | 발송 이력의 서버 소유자 제한 | 별도 main 후보 `c062d7a`에 최소 수정·14개 테스트. 테스트·타입·lint·독립 빌드 통과 | Preview 실제 검증 결과 확인 후 원격 main 반영 범위 결정. 원격 main에는 아직 미반영 |
| P0 | Production OAuth 변수 | 사용자 추가 후 **2개 등록 재확인**, 민감 정보 보호 유형 유지. 새 Preview 자동 인증·조회 6개 통과 | 실제 Production 런타임 인증은 운영 환경 후보 배포에서 확인 필요 |
| P0 | 실발송 차단 | 프로젝트 Production 설정을 **`false`로 변경 후 재확인** | 첫 운영 후보 빌드에서 차단 동작 확인. 과거 배포에 소급되지 않음 |
| P1 | 정상 경로의 이석진 서명 | 정상 경로·메타데이터·앱 목록 확인, 이미지 해시 일치·기존 10개 행/선택값 유지 | 이번 새 DOCX는 재생성하지 않음. 이전 동일 이미지 문서 증거 보존, Production 후보에서 문서 확인 |
| P1 | 실제 역할 계정 | 기존 admin·viewer 유지. 지정된 별도 operator 프로필 1개 설정. **admin·operator·viewer 실제 로그인 각 11/11, 총 33/33 통과** | 본인 양성 행·역할 강등·장기 세션 등 추가 사례는 별도 검증 |
| P1 | main 소스 백업 | **bundle 재검증·복원 SHA 재확인 완료** | PC 밖 안전한 사본과 복구 담당자 지정 |
| P1 | DB·Storage 복구 | 10/16 Storage 198개 백업·로컬 복원 통과. 10/19 대상 DB 인증·빈 상태 확인, **8테이블·967행 부분 백업·ZIP 로컬 복원·기존 Storage 참조 196개 대조 통과** | 대상 재입력 불필요. Physical 백업만 확인돼 원본 DB 비밀번호를 8800 입력 페이지에 저장 필요. 전체 스키마/Auth 백업 → 빈 대상 복원 → Auth/RLS/Storage 검증·PC 외부 사본 필요 |

이 검토의 변수 조회에는 `vercel env ls production`과 `vercel env ls preview codex/preview-sandbox`를 사용했다. `env pull`과 비밀값 복사는 하지 않았다. 후속 준비에서 발송 boolean만 `false`로 변경하고 목록에서 확인했다. 변수의 등록은 인증 성공을 뜻하지 않으며 현재 프로젝트 설정이 과거 배포에 고정된 환경까지 증명하지 않는다.

## 등록을 마친 설정과 남은 런타임 검증

Vercel의 **`check-server-site` → Settings → Environment Variables → Production**에서 아래 설정을 확인했다. `codex/preview-sandbox`는 Preview 전용 브랜치 범위여서 기존 Preview 항목과 별도로 Production 항목을 등록했다.

| 변수 | 필요한 값 / 조치 | 현재 Production |
| --- | --- | --- |
| `ZENDESK_SUBDOMAIN` | `jiransoft` — 전체 URL이 아닌 서브도메인 문자열 | 등록됨 |
| `ZENDESK_OAUTH_CLIENT_ID` | Zendesk OAuth 클라이언트의 **Identifier** 값 | 사용자 추가 후 등록 확인 |
| `ZENDESK_OAUTH_CLIENT_SECRET` | 해당 클라이언트의 **전체 Secret**. Vercel의 비밀 변수 입력란에 직접 입력 | 사용자 재발급·추가 후 등록 확인 |
| `ALLOW_REAL_ZENDESK_SEND` | 첫 운영 후보 빌드는 문자열 **`false`** | `false` 변경·재확인 완료 |

`NEXT_PUBLIC_` 접두사가 붙은 변수로 Secret을 등록하지 않는다. 화면의 클라이언트 이름이나 숫자 ID를 Identifier로 대체하지 않는다. 앞서 제공한 스크린샷의 이름 `check_server`만으로 실제 Identifier도 같다고 확정할 수 없으므로 Zendesk 설정의 Identifier 항목 자체를 확인한다. 비밀번호·Secret을 채팅이나 HTML 보고서로 전달할 필요는 없다.

사용자의 설정 완료 통보 후 다시 조회한 목록에서 Production OAuth 2개는 `Encrypted`였다. 당시 발송값은 `true`였으며 이후 `false`로 변경하고 재확인했다. 목록의 `created` 필드만으로 Secret 수정 여부를 단정하지 않고 새 Preview `2ac8a44`에서 관리자 실제 화면으로 자동 연결·조회 6개 성공과 실발송 차단을 확인했다. 관리자 세션도 복구했다.

Production OAuth 2개는 `type=sensitive`, `target=[production]`, 브랜치 제한 없음으로 확인했다. CLI의 `env run` 진단은 민감 변수를 프로세스에 전달받지 못해 **토큰 발급 요청 전에 종료**했다. 이는 Zendesk의 인증 거부 결과가 아니며 Secret 보호를 낮추지 않았다. 따라서 Production 변수의 등록과 Preview 성공은 확인했지만 **Production 런타임 인증은 운영 환경 후보 배포에서 별도로 확인해야 한다.** 비밀값을 재전달하거나 보호 유형을 바꿀 필요는 없다.

Production 변수는 새 Production 빌드에 적용된다. Preview 성공이나 Preview 변수 등록만으로 자동 승계되지 않는다. 변수 저장 후 자동으로 운영 배포를 실행하지 않고, 준비 완료 사실만 알려주면 운영 도메인 전환 전 검증 단계를 이어갈 수 있다. [Vercel 환경변수 문서](https://vercel.com/docs/environment-variables)

새 코드의 실발송 조건은 `VERCEL_ENV === "production" && ALLOW_REAL_ZENDESK_SEND === "true"`다. Vercel이 설정하는 `VERCEL_ENV`는 직접 추가할 필요가 없다. `false` 상태에서 새 운영 후보를 만들면 티켓·첨부 발송을 차단한 상태로 먼저 검사할 수 있다. 현재 동작 중인 과거 배포는 변수 저장만으로 바뀌지 않는다.

### Zendesk에서 확인할 항목

**Admin Center → Apps and integrations → APIs → OAuth clients**에서 이 앱에 사용 중인 클라이언트를 확인한다.

1. **Client kind = Confidential / 기밀**.
2. Identifier와 전체 Secret이 Vercel에 등록한 값과 같은 클라이언트의 값인지 확인.
3. 첫 조회 검증에 필요한 Allowed scopes에 **`read`** 포함. 실제 발송 전에는 **`read tickets:write ticket_attachments:write`**를 허용해야 한다. 이 문자열은 현재 코드의 요청 범위이며, 지금 쓰기 권한의 실사용까지 검증한 것은 아니다.
4. 클라이언트에 연결된 Zendesk 업무 계정이 활성이고 필요한 그룹·조직·수신자·티켓에 접근 가능한지 확인.

현재 코드는 `client_credentials` 방식이므로 사용자마다 Zendesk 로그인·동의 화면을 거칠 필요가 없다. Redirect URI와 refresh token도 사용하지 않는다. 서버가 30분 수명의 토큰을 요청하고 만료 전 다시 발급받는다. 해당 OAuth 클라이언트에 연결된 사용자의 권한은 여전히 적용된다. [Zendesk 서버 간 OAuth 안내](https://developer.zendesk.com/documentation/authentication/api-tokens-to-oauth/)

**같은 점검 사이트와 같은 Zendesk 계정에 연결하는 경우, Preview에서 검증한 기존 Confidential 클라이언트를 Production에서도 재사용하는 것은 현재 코드 구조상 가능하다.** 다만 Secret 변경·클라이언트 중지 시 두 환경이 함께 영향을 받으므로 운영 자격증명을 별도로 관리하려면 별도 클라이언트를 선택할 수 있다. 새 클라이언트가 반드시 필요한 것은 아니다. 이 판단은 동일한 앱·조직에 한정한다. 저장된 Secret 전체를 찾을 수 없다면 무작정 재발급하지 말고 기존 Preview와 함께 교체할 범위를 먼저 정한다.

Allowed scopes는 요청 가능한 범위의 상한이며, 요청한 범위를 포함하지 않으면 토큰 발급이 거부된다. 범위는 코드의 허용 목록으로 결정하므로 **`ZENDESK_OAUTH_SCOPES` 같은 추가 환경변수는 필요 없다.** [Zendesk OAuth 전환·범위 문서](https://developer.zendesk.com/documentation/authentication/oauth-migration/)

새 Preview에서 자동 연결과 다음 6개 조회가 모두 통과했다: 담당 그룹, 고객 조직 자동완성, 시리얼 기반 조직 검색, 수신자, 최근 티켓 이력·수신자 추천, 티켓 필드. `users/me` 성공만으로 전체 권한을 통과 처리하지 않았다. 실제 쓰기 권한 검증은 하지 않았으며 연결 확인은 외부 티켓을 만들지 않았다. 운영 후보 빌드에서는 같은 조회와 문서·첨부 dry-run을 다시 확인한다.

## 필요한 실제 계정과 검증 범위

필요한 것은 **점검 사이트의 Supabase 계정**이며 Zendesk 최종 사용자 계정이 아니다. 처음 실제 프로필을 조회했을 때 지정 계정은 유일한 admin이어서 그대로 유지했다. 이후 사용자가 별도 operator 계정을 지정했고 기본 viewer였던 그 프로필 1개만 operator로 설정했다. 기존 admin·viewer 역할은 유지했다. 사용자가 각각 로그인한 뒤 operator·viewer와 복구한 admin 세션 모두 실제 API/RLS 검사 11/11, 합계 33/33을 통과했다. operator는 관리자 조회·타인 문서 파일 발급 403과 타인 문서 직접 DB 조회 0행을 확인했고, viewer의 문서 목록·통합/발송 이력은 403이었다. admin의 조회·소유 문서 URL 발급·직접 DB 1행도 재확인했다. 계정 존재·프로필 조회와 실제 로그인/API 검증은 구분하며 비밀번호는 공유하지 않는다. 이 검토에서는 실제 초대 메일 발송이나 계정 생성을 실행하지 않았다.

| 확인 동작 | operator | viewer | admin |
| --- | --- | --- | --- |
| 발송 이력 API | 본인 발송만, 타인·소유자 없는 행 제외 | 403 | 전체 확인 가능 |
| 개인 문서 목록·업무 이력 | 본인 데이터 | 403 | 개인 목록은 본인, 관리 조회는 별도 경로 |
| 개별 문서 다운로드 | 본인만 | 소유 문서가 있으면 본인만 | 소유자와 관계없이 권한 확인 후 허용 |
| 문서 생성·PDF 재시도·업무 실행 | 허용 범위 내 가능 | 403 | 가능 |
| 관리자 페이지·사용자 초대·설정 | 403 | 403 | 가능 |
| 브라우저의 문서 메타 직접 수정·삭제 | DB 권한 차단 | DB 권한 차단 | 브라우저 자격증명은 동일하게 차단 |

실제 검증 시작 시 DB 집계는 전체 발송 이력 41개, 새 operator 소유 0개였다. 이 상태로 실제 API에서 0개가 반환되는 검증은 타인·소유자 없는 이력 차단을 확인하며 본인 행 조회의 양성 검증까지 증명하지는 않는다. 본인·타인 혼합 경계는 14개 모의 경로 테스트로 별도 검증했다. 서로 다른 operator 사이의 양방향 검증까지 하려면 두 번째 operator가 추가로 필요하다. viewer는 문서를 생성할 수 없으므로 본인 다운로드 양성 검증에 사용할 기존 소유 문서가 없다면 그 검사는 미검증으로 남기며, 검사를 위해 운영 자료의 소유자를 바꾸지 않는다.

화면에서 버튼이 숨겨지는 것뿐 아니라 API 직접 요청, 로그인 변경 후 기존 화면, 로그아웃, 역할 변경 뒤 다음 요청, 브라우저 직접 DB 접근을 비교한다. 서버는 요청마다 사용자와 프로필 역할을 다시 확인한다. 모의 역할 테스트나 관리자·비로그인 검증은 실제 operator/viewer 로그인 검증을 대체하지 않는다.

## 백업과 복구 확인

기존 `main-918cdf8.bundle`을 이번 검토에서 다시 검증했다. complete history와 `refs/heads/main`을 확인했으며 별도 `restore-check` 저장소 HEAD도 `918cdf8920b022839150fde46f13b66fea5e5ed3`와 일치한다. bundle SHA-256은 `00cede95a41062f76dd78420ff274384f14caad592bc232d9521b3c2cb1e6a4c`다. 이는 Git 소스 복구 증거이며 앱 실행·DB·Storage 복구 시험은 아니다.

DB·Storage 담당자에게 필요한 정보는 아래와 같다. 연결 비밀번호나 서비스 키를 채팅에 보낼 필요는 없다. 2026-10-16 17:21 KST에 Aside로 확인한 백업 목록에는 물리 백업 7개가 있었다. 최신은 2026-10-16 03:34:17 KST, 가장 오래된 표시는 2026-10-10 03:33:35 KST이며 별도 보관기간 설정값까지 확인한 것은 아니다. PITR은 꺼져 있었다. 최신 복원점은 이날 오후의 서명·역할·정책 변경을 포함한 시점이라고 볼 수 없다. 실제 Restore나 유료 기능 활성화는 실행하지 않았다.

사용자가 **`check_server_recover` — `https://svbxgzgdvrrsjzeyrfsc.supabase.co`**를 별도 복구 대상으로 제공했다. 첫 접근 실패는 사용자 로그인으로 해결됐다. 10월 16일 17:56 KST에는 이름·프로젝트 ref·도쿄 리전 `ap-northeast-1`과 public 테이블 0개·뷰 0개를 UI에서 확인했다. 당시 UI 검사는 Auth 사용자·Storage 객체까지 확인한 검사가 아니었으며, 10월 19일 저장된 연결 정보로 PostgreSQL에 직접 접속해 public 업무 테이블·Auth 사용자·Storage 버킷/객체가 모두 0개임을 읽기 전용으로 추가 확인했다. 다른 관리 스키마나 함수 전체가 없다는 뜻은 아니다. 원본이나 대상에 DB 쓰기·원격 복구는 실행하지 않았다.

복구 대상 연결 정보는 **저장·인증 확인을 마쳤으므로 재입력하지 않는다.** 현재 입력은 [원본 전용 로컬 페이지](http://127.0.0.1:8800/)의 check_server DB 비밀번호 한 항목이다. 미리 채운 원본 Session pooler 연결값을 사용하고 기존 복구 대상 값은 보존한다. 저장만으로 복원을 실행하지 않는다.

1. 입력 페이지는 loopback에만 열리고 CSRF 보호를 사용한다. 연결 정보는 프로젝트의 Git 무시 파일 `.env.recovery.local`에 보존한다. 현재 원본 PostgreSQL 접속 정보까지 확보된 상태는 아니며, 저장된 대상 정보는 유지한다. 서버가 실행 중인 현재 PC에서 사용하는 임시 주소다.
2. 원본 Dashboard에서 다운로드 가능한 logical backup이 없음을 실제 확인했으므로 기존 원본 DB 비밀번호만 로컬로 추가한다. 주소·DB·사용자/ref는 확인한 Session pooler 값으로 미리 채웠다. 비밀번호나 전체 연결 URL을 채팅으로 보내거나 복구 대상 값을 다시 입력하지 않는다.

`pg_dump`·`psql` 17.9 도구와 읽기 전용 `scripts/recovery-preflight.mjs`를 준비했고, 대상의 실제 PostgreSQL 인증은 완료했다. 원본 연결이 확보되면 원본/대상 ref·버전·빈 대상 등을 다시 확인한다. 10월 16일 Supabase의 Restore to new project UI에서는 완료된 물리 백업 7개와 Restore 버튼만 확인했다. 이 기능은 기존 지정 대상에 쓰는 경로가 아니라 별도 프로젝트를 만드는 기능이며 추가 비용과 복제된 작업의 실행 가능성이 있어 이번 작업에서 누르지 않았다. 전체 백업이 확보되지 않은 동안에는 대상에 스키마나 부분 데이터를 먼저 만들지 않는다. [Supabase 복제 안내](https://supabase.com/docs/guides/platform/clone-project)

| 대상 | 확인할 정보 | 완료 증거 |
| --- | --- | --- |
| Supabase DB | 최신 변경을 담은 전체 백업, 실제 보관 정책·복구 권한 담당자 | 10/16 물리 백업 7개·PITR 꺼짐 기록 보존. 10/19 Physical 7개·최신 03:34:40 KST·Download 없음 확인, 업무 데이터 967행 부분 백업 완료. 전체 DB/Auth/정책 백업·복구는 남음 |
| Storage | PC 외부 별도 보관 위치·보관기간·담당자 | 3개 버킷 198개·15,239,392 bytes 백업과 ZIP 로컬 복원·파일 해시 대조 통과. 원격 복구는 미검증 |
| 실제 복구 시험 | 지정된 별도 복구 대상, 허용 중단시간과 허용 데이터 손실 | 대상 PostgreSQL 인증·빈 상태 읽기 전용 검사 완료. 전체 복원 후 주요 테이블/RLS·로그인·문서 다운로드·서명 검증 필요 |
| 배포·비밀 관리 | 이전 배포 ID·운영 별칭, 복구용 자격증명의 조직 내 관리 위치 | 비밀값 없이 복구 담당자·절차 확인 |

DB 자동 백업에는 Storage 파일 내용이 포함되지 않는다. DB 복구는 운영 기록도 과거로 되돌릴 수 있으므로 UI 배포 실패의 첫 대응으로 실행하지 않는다. [Supabase 백업 문서](https://supabase.com/docs/guides/platform/backups)

이번 Storage 백업은 `generated-documents` 185개, `engineer-signatures` 12개, `public-assets` 1개다. 메타데이터 참조 197개에서 누락은 없고 백업 전후 객체 목록·참조는 안정적이었다. ZIP은 13,749,443 bytes, SHA-256은 `ab6d765b3a2f8947ada354921ea5b9fddf90cbe886c9ab87401f97c66b743e7f`다. 별도 로컬 디렉터리로 안전하게 풀어 198개 객체와 증거 파일의 해시를 다시 대조했다. 고객 문서가 포함되므로 조직의 접근이 제한된 백업 위치에 보관해야 한다. **로컬 파일 복원 통과와 원격 Supabase DB·Storage 복구 시험은 다르다.** DB·Storage의 원자적인 단일 시점 스냅샷은 아니며 원격 복구는 수행하지 않았다.

최신 확인 Preview `2ac8a44`는 Ready이고 이 배포는 테스트·검증 스크립트 변경으로 업무 실행 코드는 유지됐다. Preview 전체 214개 테스트를 통과했으며 기존 main 문제 재현 TAP·최소 수정 patch·실제 3역할 결과·Storage 복원 JSON을 HTML 보고서의 `main-readiness/`에 보존했다. main 최소 수정 커밋 `c062d7a`는 로컬 후보로만 존재하고 원격 main에는 반영하지 않았다.

현재 알려진 이력 소유자 제한 결함이 있는 이전 main 배포로 되돌리는 것만으로 안전한 복구가 완성되지 않는다. 최소 보안 보완이 포함된 복구 후보도 검증해야 한다. 기존 API token 폐기는 OAuth 전환·운영 안정화·복구 기간 종료 후 검토한다.

## 운영 후보 검증 순서

1. 완료: 발송 이력 최소 후보 `c062d7a`의 14개·타입·lint·독립 빌드. Preview 전체 214개와 admin·operator·viewer 실제 각 11개, 총 33개 검증. 후보는 원격 main에 미반영이다. **이 최소 후보만 Production에 재배포해도 현재 준비된 `ALLOW_REAL_ZENDESK_SEND=false`가 새 빌드에 적용되므로 메일 발송 가능 상태가 달라진다.** 소스 변경 범위가 작다는 이유로 운영 영향이 없다고 보지 않고 발송 차단 시간과 작업 창을 정해야 한다. 기존 배포에는 새 변수값이 소급되지 않는다.
2. 완료: Production OAuth 등록·발송 false와 새 Preview OAuth 자동 연결·조회 6개 확인. Production 런타임 검증은 다음 단계다.
3. 완료: 정상 서명·앱 목록, Storage 198개 백업·로컬 복원, check_server_recover의 연결 저장·PostgreSQL 인증·public/Auth/Storage 빈 상태 읽기 전용 검사. 추가로 업무 데이터 8개 테이블·967행 부분 백업·두 차례 조회 대조, 10파일 ZIP 로컬 복원, 기존 Storage 사본에 대한 196개 참조 대조를 완료했다. **대상 정보 재입력은 불필요**하며 원본 대시보드 로그인도 완료됐다. Physical 백업만 확인돼 원본 DB 비밀번호 입력이 필요하다. 이후 전체 스키마/Auth 백업 확보·빈 대상 복원·Auth/RLS/Storage 검증·PC 외부 사본을 준비한다. 부분 백업만으로 전체 복구 통과나 main 반영 준비 완료로 처리하지 않는다.
4. 별도 승인된 운영 반영 단계에서 Production 환경의 후보 빌드를 만들고 운영 별칭 전환 전 연결·검색·문서·서명·PDF·dry-run을 검사한다.
5. 실제 발송은 별도 샌드박스가 없으므로 지정된 테스트 수신처와 실행 범위를 확정한 뒤에만 검증한다. 이후 운영 별칭 전환·실발송 활성 여부를 결정한다.

## 확인 근거

- `src/lib/env.ts:7`, `:20`: OAuth 필수 변수와 실발송 gate.
- `src/lib/server/zendesk-oauth.ts:7`, `:16`, `:41`, `:124`: 변수명·코드 고정 scope·client credentials 요청·자동 토큰 재발급.
- `src/lib/server/zendesk.ts:61`: 별도 쓰기 없이 6개 조회 권한 검사.
- `src/app/api/zendesk/connection/route.ts:12`: 관리자 연결 확인.
- `src/lib/server/api.ts:76`: 실제 인증과 profile 역할 재조회.
- `src/app/api/history/ticket-sends/route.ts:9`, `:18`: operator 이상·admin 외 소유자 필터(검토 시작 기준).
- `src/app/api/documents/route.ts:27`, `src/app/api/documents/[id]/download/route.ts:28`, `:53`: 목록과 개별 다운로드의 역할/소유권 경계.
- `src/app/api/admin/invitations/route.ts:21`, `:116`: 관리자 초대·초대 URL 선택. 계정 준비가 필요하면 초대 메일의 실제 전송과 redirect 허용 목록도 따로 확인한다.
- `docs/MAIN_ROLLOUT_REVIEW_2026-10-16.md`: 기존 운영 배포, 공유 DB, 백업, 단계별 전환 검토.
- `scripts/export-recovery-app-data.mjs`, `tests/recovery-app-data-export.test.mjs`: 2026-10-19 원본 GET 전용 부분 백업과 11개 회귀 검사.
- HTML 보고서 폴더의 `main-readiness/app-data-backup-2026-10-19/manifest.json`: 8개 테이블 건수·SHA-256·두 차례 대조·백업 범위와 한계. 실제 데이터 행은 이 문서에 포함하지 않음.
- 같은 폴더의 `main-readiness/app-data-local-restore-verification-2026-10-19.json`: 부분 백업 ZIP 10파일의 별도 로컬 복원·해시 일치 및 기존 Storage 사본과 196개 참조 대조. 원격 복원·현재 원격 Storage 재조회는 포함하지 않음.

위 행 번호는 `d294d6b` 기준이며 후속 보완으로 달라질 수 있다. PKM 프로젝트 조회는 미등록(null)이어서 별도 지식 기록을 생성하지 않았다.
