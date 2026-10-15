# 점검 사이트 UI Preview 변경·검증 기록

> 이 문서는 UI 1차 프리뷰 기준이다. 이후 OAuth 전환으로 신규 서버 환경변수 2개와 관리자 연결 패널이 추가됐다. 최신 배포와 인증 설정 상태는 [OAuth 전환 안내](ZENDESK_OAUTH_MIGRATION.md)를 참조한다.

## 현재 상태

- 기록일: 2026-10-15, Asia/Seoul 기준.
- 작업 브랜치: `codex/ui-preview-20261015`.
- 상태: 프리뷰 구현·로컬 UI 검증·최적화 빌드·Vercel Preview 배포 완료. Vercel CLI readyState=READY 확인.
- 운영 `main` 브랜치와 Production 배포는 변경하지 않았다. 이 문서는 운영에 적용된 기능 목록이 아니다.
- Preview UI: https://check-server-site-8dab7vdny-chpark425-3494s-projects.vercel.app/ui-preview
- Vercel 배포: `dpl_455jTyz5fd4mWiDk9aqtUkHRaKqp`, Preview, READY.
- 검증 기반: HEAD `918cdf8`에서 분리한 작업 브랜치의 현재 변경분. 커밋·push·운영 승격은 수행하지 않았다.

## Preview 경계

`/ui-preview`는 점검 데이터·일괄 점검·메일 발송·이력·문서함·설정·관리자의 실제 화면 컴포넌트에 가상 API 어댑터를 연결한다. 가상 데이터는 어댑터 인스턴스의 메모리에만 유지하며, 이 경로에서는 Supabase 클라이언트 생성·인증 구독, CRM 조회, PDF 변환, 파일 다운로드, 외부 업로드, Zendesk 발송, 사용자 초대를 실행하지 않는다. Preview의 설정·매핑은 실제 사용자 localStorage와 분리한다.

- 가상 API는 지원한 경로와 메서드만 처리한다. 미지원 요청은 오류로 끝나며 실제 API로 넘기지 않는다.
- `dryRun: false`를 입력하더라도 가상 발송·업로드 응답은 테스트 모드로 유지한다.
- 고객 A/B/C의 시리얼, 조직 `101/102/103`, 서로 다른 예시 수신자를 일관되게 연결한다.
- 실제 문서가 없으므로 다운로드·미리보기는 안내만 표시한다. “문서 생성”은 가상 메타데이터 생성이다.
- `VERCEL_ENV=production`이면 `/ui-preview`는 `notFound()`로 차단한다. 이 조건은 Vercel 배포 환경을 기준으로 한다.
- `/`는 기존 로그인 화면이다. 해당 경로에 로그인하면 환경변수에 설정된 기존 백엔드를 사용할 수 있으므로, `/ui-preview`의 가상 동작과 구분한다. 기존 실제 발송 환경 게이트도 유지한다.

## 이번 변경

### P0: 고객·계정 경계와 불확정 발송 보호

- 계정·고객 변경 시 문서·조직·요청자 등 이전 작업 상태를 초기화하고 늦게 도착한 이전 범위의 응답이 새 작업을 덮어쓰지 않도록 처리한다.
- 생성 PDF의 자동 첨부는 문서·발송 모드별로 한 번 시도하고, 실패 후 상태 변화에 따라 반복 실행하지 않는다.
- 동일 발송 키의 예약 충돌 후 기존 이력을 읽을 수 없으면 `TICKET_SEND_STATE_UNAVAILABLE`로 중단한다. 조회 실패를 신규 발송 가능 상태로 해석하지 않는다.
- 오래된 `pending` 예약을 시간만으로 회수하지 않는다. 전송 결과가 불명확하거나 기존 `failed`의 실패 단계를 확인할 수 없으면 `TICKET_SEND_RESULT_UNKNOWN`으로 기존 결과 확인을 안내한다.
- 네트워크·일반 upstream 오류는 `pending`과 `[TICKET_SEND_RESULT_UNKNOWN]` 오류 요약으로 남긴다. 티켓 생성 전에 실패한 것이 확인된 경우만 `failed`와 `[TICKET_SEND_RETRY_SAFE]` 표식을 사용하고, 조건부 갱신으로 한 요청만 재시도 예약을 얻도록 한다.
- Zendesk 티켓 생성 후 이력 저장이 실패하거나 갱신된 행이 없으면 성공 응답을 반환하지 않는다. 중복 방지 키를 유지하고, 가능한 티켓 ID를 보존해 재발송 대신 기존 결과를 확인하도록 한다.
- 감사 로그 전송 실패가 확정된 티켓 생성을 전체 발송 실패로 바꾸지 않도록 분리한다.
- CRM 쿠키를 앱 사용자 ID·CRM 토큰 및 타입·만료 시각에 HMAC으로 연결한다. 소유자 정보가 없는 기존 쿠키, 다른 계정의 쿠키, 변조된 쿠키는 거절한다. 앱 인증 만료나 감사 기록 실패로 로그아웃 응답이 오류여도 CRM 쿠키를 삭제한다.

### P1: 검색·상태 정확성과 화면별 복구

- 내 이력은 기간 지정·전체 범위, 검색어 정규화, 서버 페이지 이동, 상세 확인, 목록과 집계 응답 구분을 지원하도록 변경했다. 실제 API의 커서는 사용자와 조회 조건에 연결하며, 가상 API는 화면 검증용 로컬 커서를 사용한다.
- 이력 응답의 `appliedFilters`에 정규화된 검색어, KST 기간 경계, 정렬, 표시 개수, 조회 기준 시각을 포함한다.
- 문서함은 생성 상태·만료 예정·만료를 구분한다. 만료 문서의 다운로드·미리보기·메일 연결 동작을 비활성화하며, 첨부 준비와 실제 발송 완료를 같은 상태로 취급하지 않는다.
- 설정의 미저장 변경·되돌리기·저장 중 상태를 구분하고, 관리자 화면에서 감사 기록·발송 기록·사용자 정보를 확인할 수 있게 정리했다.
- 사용하지 않는 탭의 데이터를 모두 초기 로딩에서 기다리지 않도록 조회 시점을 분리했다.
- 가상 응답도 실제 API 계약에 맞췄다. 문서 생성의 `pdfStatus`는 객체, 문서 목록의 저장 상태는 문자열로 구분한다. 메일 미리보기는 `preview: { dryRunOnly, ticket }`, 관리자 metadata는 화면이 읽는 camelCase 필드를 사용한다.

## 검증 완료 범위

### 집중 테스트: 45개 통과

| 테스트 파일 | 개수 | 주요 확인 내용 |
|---|---:|---|
| `tests/ticket-send-state.test.mjs` | 14 | 예약 조회 실패 차단, stale pending 회수 금지, 전송 결과 불명, 이력 저장 실패·0행 갱신, 안전한 실패 재시도, 감사 실패 분리 |
| `tests/solution-session-owner.test.mjs` | 7 | CRM 소유자·토큰·만료 서명, 구형 쿠키 차단, 계정 간 재사용 차단, 인증 실패 시 로그아웃 쿠키 삭제 |
| `tests/preview-api.test.mjs` | 11 | 고객·조직·수신자 일치, 응답 형식, `appliedFilters`, 어댑터 인스턴스·응답 객체 격리, 미지원 요청 차단, 외부 호출 없음 |
| `tests/history-query.test.mjs` | 10 | 기간·검색·커서·안정된 페이지 이동과 사용자·조건 경계 |
| `tests/preview-route.test.mjs` | 3 | production 404 게이트, preview/development에서 가상 화면 렌더 |

이 테스트는 Node의 테스트 실행기, 순수 함수, VM 및 모의 의존성을 사용한다. 실제 Supabase DB, CRM, Zendesk, PDF 변환 서비스를 대상으로 수행한 통합 테스트가 아니다. 테스트 통과는 실DB 쿼리 속도나 운영 네트워크 동작을 증명하지 않는다.

재실행 명령:

```powershell
node --test tests/*.test.mjs
```

### 브라우저에서 확인한 가상 UI 동작

| 화면 | 확인한 동작 | 검증 경계 |
|---|---|---|
| 이력 | 전체 기간, 대문자 `LO` 검색, 다음 페이지 `20 + 16`건, 이전 페이지, 이벤트 상세 | 가상 36건 기준. 실DB 조회 성능 측정 아님 |
| 문서함 | 만료 문서 상세에서 다운로드·PDF 미리보기·메일 연결 동작 비활성화 | 실제 파일 접근이나 Storage 삭제를 실행하지 않음 |
| 설정 | 변경 시 미저장 상태 표시, 되돌리기 | 가상 설정 기준. 실사용자 설정 변경 아님 |
| 관리자 | 감사·발송·사용자 화면 확인 | 가상 데이터 기준. 실제 초대·권한 변경 없음 |
| 고객 전환·메일 | 고객 A에서 B로 전환 후 제목·수신자·생성 문서가 B에 맞는지 확인하고 가상 테스트 발송 | 실제 메일·Zendesk 티켓·첨부 업로드 없음 |
| 일괄 점검 | 시리얼 2개 조회·PDF 생성 후 매핑된 1건만 전송 가능 표시 | 전체 일괄 외부 처리나 중단 후 복구 보장을 검증한 것은 아님 |
| 모바일 | 390px viewport에서 7개 탭 모두 document scrollWidth=clientWidth=375px 확인 | 표·탭 목록의 내부 가로 스크롤은 유지. 모든 키보드 흐름 전수 검사 아님 |
| 초기 화면·로그아웃 | 새 브라우저 세션 console error 0개, 로그아웃 후 로그인 화면 및 초안 초기화 확인 | 외부 서비스의 지연·실패는 모의 테스트 범위로 구분 |

전체 ESLint, 독립 typecheck, 최적화 build 및 diff 검사는 통과했다. Vercel 원격 build도 완료됐다. 배포 URL의 실제 페이지를 재조회하지 않고 CLI의 READY 결과로 배포 완료를 확인했다.

## 최종 검증 범위와 남은 과제

| 항목 | 현재 기록 |
|---|---|
| 모바일·좁은 화면·키보드 전체 흐름 | 모바일 7탭 가로 넘침 없음. 키보드 전체 흐름 전수 검사는 미수행 |
| 최종 통합 lint·typecheck·build | lint·독립 typecheck·Next.js 최적화 build 통과 (Windows SWC 경로 제한 때문에 build는 샌드박스 외 실행) |
| Preview 배포·배포 후 URL 검증 | CLI Preview READY 확인. 배포 페이지 재조회는 수행하지 않음 |
| `VERCEL_ENV=production`의 `/ui-preview` 404 | 실제 route 소스를 VM에서 검사한 3개 테스트 통과. production 환경에서 화면 렌더 이전 notFound 호출 확인 |
| 실제 로그인·CRM 조회·문서 변환·Zendesk 발송 | 이번 가상 UI 검증에서 실행하지 않음 |
| 실DB 검색 benchmark·실행계획·추가 인덱스 효과 | 미수행. 속도 배율이나 p95 개선 수치를 주장하지 않음 |
| 정책·보관 변경 마이그레이션 | 추가하지 않음. 기존 운영 정책과 스키마를 유지함 |
| Jev/Laya·검색엔진 추가 | 추가하지 않음 |

## 적용 시 유의점

- 신규 필수 환경변수와 DB 스키마·마이그레이션은 없다. 서명에는 기존 서버 전용 `SUPABASE_SERVICE_ROLE_KEY`를 사용한다. 키 교체 시 기존 서명은 유효하지 않으므로 CRM 재로그인이 필요하다.
- 소유자 서명이 없는 기존 CRM 쿠키는 한 번 다시 로그인해야 한다. 브라우저 세션 표시도 `SOLUTION_SESSION_MISMATCH`에서 초기화한다.
- 기존 `pending` 및 실패 단계가 불명확한 `failed` 발송은 자동으로 다시 보내지 않는다. 실제 발송 결과를 확인하는 운영 절차가 필요하다.
- 문서의 기본 30일 접근 만료와 5분 signed URL 유효기간을 변경하지 않았다. 이력 조회 기간 확대는 파일 보관 연장이나 로그 삭제 정책 변경이 아니다.
- 정상 판정·자동선택 예외, Iptables·에이전트 문서 적용값, CPU·Load 표시 보정, DOCX 템플릿 출력 정책은 이번 프리뷰 작업에서 임의 변경하지 않는다.

## 관련 파일

- Preview 진입·어댑터: `src/app/ui-preview/page.tsx`, `src/lib/preview/api.ts`
- 화면: `src/components/mail-console.tsx`, `src/components/check-flow/check-flow-panel.tsx`, `src/components/history-panel.tsx`, `src/components/document-library-panel.tsx`, `src/components/admin-console.tsx`
- 발송 보호: `src/app/api/zendesk/tickets/route.ts`, `src/lib/server/ticket-send-state.ts`
- CRM 바인딩: `src/lib/server/solution-auth.ts`, `src/app/api/solution/login/route.ts`, `src/app/api/solution/checkup/route.ts`, `src/app/api/solution/logout/route.ts`
- 이력 조회 계약: `src/lib/server/history-query.ts`, `src/app/api/history/overview/route.ts`

운영 반영 전에는 실계정·실DB 기반 통합검증과 검색 성능 측정이 별도로 필요하다. 이번 결과는 Preview 검토용이며 운영 배포 승인을 대신하지 않는다.
