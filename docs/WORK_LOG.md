# Work Log

## 2026-05-18

### 일괄 점검 실제 전송 모드 추가

변경 사항:
- 일괄 점검의 Zendesk 발송 버튼을 테스트 전송 전용에서 발송 모드 선택 구조로 변경했다.
- 일괄 점검에서도 `기본값`, `테스트 전송`, `실제 전송`을 선택할 수 있게 했다.
- 실제 전송은 기존 단건 발송과 동일하게 production 환경과 `ALLOW_REAL_ZENDESK_SEND=true` 조건에서만 활성화된다.
- 실제 전송 실행 전 선택 건수, 고객사, 요청자 이메일 요약을 확인하는 브라우저 확인 창을 추가했다.
- 일괄 전송 성공 시 테스트/실제 전송 여부와 성공 건수를 안내하고, 실제 전송이면 Zendesk 티켓 URL을 기존 Zendesk 컬럼 링크로 표시한다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과

### Preview 기능 운영 적용 1차 정리

변경 사항:
- 일괄 점검에서 쓰는 고객사 담당자 매핑을 브라우저 localStorage 임시 저장에서 Supabase `customer_mail_mappings` 테이블 저장 구조로 옮기기 위한 마이그레이션을 추가했다.
- 사용자별 메일 본문 템플릿을 Supabase `user_preferences.mail_body_template` 컬럼에 저장할 수 있도록 마이그레이션과 `/api/user/preferences` API를 확장했다.
- `/api/user/customer-mappings` API를 추가해 사용자별 고객사명, 시리얼, Zendesk 조직 ID, 요청자 이름/이메일 매핑을 조회/저장할 수 있게 했다.
- 프론트엔드는 서버 API를 우선 사용하고, 테이블/컬럼이 아직 적용되지 않은 환경에서는 기존 localStorage 값을 fallback으로 사용하도록 정리했다.
- 기존 localStorage 매핑과 메일 본문 템플릿은 서버 저장소가 비어 있을 때 초기 보존용으로만 사용한다.
- 기존 브라우저에 저장된 메일 본문 템플릿과 고객사 담당자 매핑은 서버 저장소가 비어 있으면 첫 조회 시 서버 API로 자동 이관을 시도한다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과
- Supabase `user_preferences.mail_body_template` 컬럼 조회 확인
- Supabase `customer_mail_mappings` 테이블 조회 확인

DB 적용:
- `supabase/migrations/202604290008_user_mail_mappings.sql` 수동 적용 완료 확인
- 사용자별 메일 본문 템플릿과 고객사 담당자 매핑은 Supabase 영구 저장 구조를 사용할 수 있다.

커밋/배포:
- 커밋: `e171d10 Persist batch mappings and mail templates`
- Preview 배포: https://check-server-site-loo4p1co0-chpark425-3494s-projects.vercel.app
- Production 배포: https://check-server-site.vercel.app
- Production deployment: https://check-server-site-g3qilqgqx-chpark425-3494s-projects.vercel.app

이 문서는 작업 단위별 변경 사항, 검증 결과, 커밋/배포 정보를 추적한다.

운영 규칙:
- 기능, 보안, UI, API 동작이 바뀌는 작업 뒤에는 이 문서를 갱신한다.
- 함께 `docs/CURRENT_FEATURES.md`도 최신 기능 기준으로 갱신한다.
- 검증하지 못한 항목은 통과로 적지 않고, 미검증 또는 실패 사유를 남긴다.

## 2026-05-15

### Preview 일괄 점검/문서/메일 검증 탭 추가

변경 사항:
- `codex/preview-sandbox` Preview 검증용으로 `일괄 점검` 탭을 추가했다.
- 여러 시리얼을 한 번에 입력해 CRM 점검 데이터를 순차 조회하고, 정상 판정/고객사 담당자 매핑 여부를 기준으로 선택할 수 있게 했다.
- 고객사별 Zendesk 조직 ID, 요청자 이메일, 기본 점검자를 브라우저 localStorage에 사용자별로 저장하는 임시 매핑 기능을 추가했다.
- 선택된 정상/매핑 항목에 대해 기존 점검서 생성 API로 PDF를 생성하고, 기존 Zendesk API에 PDF만 첨부해 dry-run 발송까지 검증할 수 있게 했다.
- Preview 일괄 발송은 항상 `dryRun: true`로 호출해 실제 Zendesk 티켓 생성을 차단한다.
- 일괄 처리 목록의 `판정` 컬럼에 검토 필요 사유를 표시하고, `요청자 매핑` 컬럼에 요청자 이메일과 Zendesk 조직 ID를 함께 표시하도록 개선했다.
- 일괄 처리 목록에 `상세` 버튼을 추가해 기존 점검 데이터 탭의 점검 결과 요약을 일괄 화면 안에서 미리볼 수 있게 했다.
- 일괄 PDF 생성은 Zendesk 매핑 없이도 선택/생성 가능하게 분리하고, Zendesk dry-run 발송만 매핑을 필수로 유지했다.
- 선택 보조 버튼을 `정상 항목 선택`, `매핑 완료 선택`으로 분리해 처리 기준을 명확히 했다.
- 시리얼 입력은 `LO`를 고정 프리픽스로 표시하고 숫자만 입력하는 다중 입력칸 방식으로 변경했다.
- 고객사 담당자 매핑은 고객사명 검색, Zendesk 조직 선택, 요청자 자동/수동 선택, 저장 흐름으로 단순화했다.
- 저장된 매핑으로 자동 매칭되지 않은 일괄 처리 행도 행 내부 드롭다운으로 수동 연결할 수 있게 했다.
- 일괄 처리 목록의 PDF 컬럼에 생성된 PDF 파일명과 용량을 표시하고, Zendesk 컬럼에 PDF 첨부 확인 상태와 첨부 파일명을 표시하도록 개선했다.
- 일괄 Zendesk dry-run 발송이 성공하면 해당 시리얼과 선택된 담당자 매핑을 저장해 다음 동일 시리얼 조회 시 자동 매칭되도록 했다.
- 일괄 처리 목록은 행 높이가 커지지 않도록 PDF/Zendesk 정보를 요약 표시하고, 파일명과 첨부 상세는 `상세` 미리보기 영역으로 이동했다.
- 일괄 조회 완료 시 확인 필요 사유가 없는 항목을 자동 선택하도록 변경했다.
- 에이전트 연결 이상만 있는 항목은 판정에는 `검토 필요`로 표시하되 자동 선택 대상에는 포함하도록 예외 처리했다.
- 시리얼 입력칸에서 Enter를 누르면 `일괄 조회`가 실행되도록 했다.
- 고객사 담당자 매핑의 고객사명 입력칸에서 Enter를 누르면 Zendesk 조직 검색이 실행되도록 했다.
- 에이전트 이상이 서비스 플래그가 아닌 경고 문구로 들어오는 경우에도 자동 선택 기준에서는 제외하도록 보정했다.
- 에이전트 플래그가 `checkAgentConnection` 등 다른 키 이름으로 들어와도 자동 선택 기준에서는 제외하도록 보정했다.
- 미인증 라이선스는 일괄 자동 선택 기준에서 제외해 자동 체크를 막지 않도록 변경했다.
- 설정 탭에 사용자별 메일 본문 템플릿 입력을 추가하고, Zendesk 메일 본문 생성 시 저장된 템플릿을 사용하도록 했다.
- 메일 본문 템플릿은 `{{requesterName}}` 또는 `{{담당자명}}` 치환자를 지원하며, 현재 Preview에서는 사용자 브라우저 localStorage에 저장한다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- 기능 커밋: `4048648 Add preview batch check workflow`
- Preview 배포: https://check-server-site-7mm2i269z-chpark425-3494s-projects.vercel.app

## 2026-05-08

### 점검 대상 변경 시 생성 문서 초기화

변경 사항:
- 새 점검 데이터의 시리얼이 이전 점검 데이터와 다르면 생성 문서 상태를 초기화하도록 변경했다.
- 다른 시리얼 조회 후 이전 고객/시리얼의 DOCX/PDF가 생성 문서 영역에 남지 않도록 했다.
- 점검 대상 변경 시 기존 메일 첨부 토큰과 수동 첨부 파일도 함께 비워 잘못된 문서가 발송되지 않도록 했다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- 진행 예정

### PDF 첨부 복구와 수집일 배지 표시 개선

변경 사항:
- 생성 문서 PDF가 있는 상태에서 메일 발송 탭으로 돌아왔을 때 PDF 첨부 토큰이 사라져 있으면 현재 발송 모드 기준으로 자동 재첨부하도록 보강했다.
- PDF 미리보기나 탭 이동 이후에도 메일 발송 탭의 생성 PDF 첨부가 복구되도록 했다.
- 점검 결과 상단 요약 영역에 점검 API 수집일을 `수집일 YYYY. MM. DD. HH:MM` 배지로 표시하도록 했다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- 진행 예정

### 라이선스 카드 라벨 명확화

변경 사항:
- 점검 결과 라이선스 카드의 `7 / 71` 표기를 `사용 7 / 총 71` 형식으로 변경했다.
- 하단 보조 문구도 `미인증 5 · 사용률 10%`처럼 사용률 의미가 드러나도록 변경했다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- 진행 예정

### Dark Mode Select 가독성과 PDF 미리보기 개선

변경 사항:
- 공통 select 스타일에 배경색과 글자색을 명시해 dark mode에서 옵션 글자가 흐리게 보이는 문제를 개선했다.
- 점검 데이터 탭의 생성 문서 PDF 행에 `미리보기` 버튼을 추가했다.
- 문서함의 PDF 생성 완료 문서 작업 영역에도 `PDF 미리보기` 버튼을 추가했다.
- PDF 미리보기는 인증 헤더로 파일을 받은 뒤 브라우저 새 탭에 blob URL로 열도록 처리했다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- 진행 예정

### CRM 로그인 문구 변경

변경 사항:
- 점검 데이터 탭의 좌측 카드 제목을 `점검 흐름`에서 `CRM 로그인`으로 변경했다.
- 로그인 입력 라벨을 `솔루션 아이디`에서 `CRM 아이디`로 변경했다.
- 로그인 필수값/아이디 오류 메시지와 관리자 감사 로그 라벨의 솔루션 로그인 문구를 CRM 기준으로 정리했다.
- 최신 기능 문서의 점검 데이터/감사 로그 설명도 CRM 로그인 기준으로 갱신했다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- 진행 예정

### Zendesk 발송 성공 메시지 티켓 링크 개선

변경 사항:
- Zendesk 실제 티켓 생성 성공 메시지의 티켓 번호를 Zendesk 티켓 URL 링크로 표시하도록 변경했다.
- 중복 발송 응답에 기존 티켓 URL이 있으면 기존 티켓 번호도 링크로 표시하도록 했다.
- 해결 처리 실패가 함께 표시되는 경우에도 생성된 티켓 번호는 클릭 가능한 링크로 유지한다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- 진행 예정

### Zendesk 점검자 필드 옵션 매칭 판정 수정

변경 사항:
- `티켓제출자` 필드처럼 옵션 `name`과 `value`가 같은 경우에도 매칭 성공으로 처리하도록 Zendesk 필드 옵션 매칭 로직을 수정했다.
- `티켓처리자` 필드처럼 옵션 `value`가 `점검자명_처리자` 형태인 경우도 매칭되도록 `raw_name`, `value`, `점검자명_처리자` 패턴을 함께 비교하도록 보강했다.
- 기존에는 매칭된 값이 입력 점검자명과 같으면 실패로 오판해 `Zendesk 필드(26051953354905)에서 점검자 ... 옵션을 찾지 못했습니다.` 오류가 발생할 수 있었다.
- Zendesk 필드 `26051953354905`, `28476275807129`에서 `박찬호` 옵션 존재를 API로 확인했다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- 진행 예정

### Zendesk 메일 서명과 해결 처리 결과 분리 개선

변경 사항:
- `C:\Users\User\Downloads\jiransoft_sign_next.png` 서명 이미지를 현재 프로젝트 Supabase Storage `public-assets/mail/jiransoft_sign_next.png`에 업로드했다.
- Zendesk 메일 본문은 일반 텍스트 본문을 HTML로 변환한 뒤 하단에 Supabase Storage 공개 서명 이미지를 붙여 전송하도록 변경했다.
- Zendesk 티켓 생성 성공 후 해결 처리 실패가 발생해도 생성된 티켓 정보를 잃지 않도록 생성 성공과 solved 처리 실패를 분리했다.
- solved 처리 실패 시 `zendesk.ticket.solve_failed` 감사 로그와 발송 이력의 오류 요약에 실패 원인을 남기도록 했다.
- 관리자 감사 로그에서 해결 처리 실패 로그를 `젠데스크 해결 처리 실패` 라벨로 표시하도록 했다.
- Zendesk validation 오류 응답의 `details`를 요약해 `Record validation errors`보다 구체적인 원인이 보이도록 했다.
- Zendesk 티켓의 고정 담당자는 솔루션팀 계정으로 유지하고, 티켓 제출자/티켓 처리자 커스텀 필드는 선택된 점검자명으로 Zendesk 필드 옵션을 매칭해 반영하도록 했다.
- 메일 서명 Storage 위치 기본값을 `.env.example`에 추가했다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과
- Supabase Storage 서명 이미지 공개 URL `200 image/png` 응답 확인

커밋/배포:
- 이번 변경 커밋과 production 배포에 포함

### 발송 모드 기본값 옵션과 PDF 첨부 유지 개선

변경 사항:
- 메일 발송 탭의 발송 모드 선택에 `기본 발송 모드` 옵션을 추가했다.
- 기본 발송 모드는 사용자 설정에 저장된 기본 발송 모드를 적용한다.
- 실제 전송/테스트 전송 전환 시 기존 생성 PDF 첨부가 풀려 보이지 않도록 현재 발송 모드 기준으로 자동 재첨부하도록 했다.
- 생성 문서 첨부 토큰은 현재 발송 모드와 일치하는 토큰만 화면과 전송 payload에 사용하도록 했다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- 진행 예정

### 감사 로그 검색 정확도와 관리자 로그 발생량 개선

변경 사항:
- `audit_logs`에 `serial`, `company_name`, `search_text` 검색용 컬럼을 추가했다.
- 기존 감사 로그 metadata 기준으로 검색용 컬럼을 백필하는 마이그레이션을 추가했다.
- 신규 감사 로그 기록 시 검색용 컬럼을 함께 저장하도록 `writeAuditLog`를 변경했다.
- 일반 `이력` 탭의 점검 조회 검색을 `target_id`, `serial`, `company_name`, `search_text` 기준으로 조회하도록 개선했다.
- 관리자 overview는 초기 진입/새로고침마다 감사 로그를 남기지 않고, 검색 form 제출 시에만 `admin.overview.search` 로그를 남기도록 변경했다.
- Supabase 운영 DB에 `audit_logs` 검색 컬럼 마이그레이션을 적용했다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과
- Supabase `public.audit_logs`의 `serial`, `company_name`, `search_text` 컬럼 생성 확인

커밋/배포:
- 진행 예정

### 검색 입력 Enter 동작 개선

변경 사항:
- `이력` 탭 검색 영역을 form submit 구조로 변경해 Enter 입력 시 검색이 실행되도록 했다.
- `문서함` 탭 검색 영역을 form submit 구조로 변경해 Enter 입력 시 검색이 실행되도록 했다.
- `관리자` 메뉴 감사 로그 검색 영역을 form submit 구조로 변경해 Enter 입력 시 검색이 실행되도록 했다.
- 기존 `점검 데이터` 시리얼 조회와 `Zendesk 조직 검색`은 이미 submit 구조라 유지했다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- Commit: `9ed1781 Enable enter key search submits`
- Production: https://check-server-site.vercel.app

### 이력 권한/검색/설정 저장 개선

변경 사항:
- 일반 `이력` 탭을 모든 역할에서 본인 이력만 조회하도록 고정했다.
- 일반 `문서함` 탭을 모든 역할에서 본인 생성 문서만 조회하도록 고정했다.
- 전체 운영자 로그와 전체 문서/발송 이력은 관리자 메뉴에서만 확인하도록 권한 범위를 분리했다.
- `/api/history/overview`에서 점검 조회, 문서 생성, 메일 발송 요약을 DB count 기준으로 계산하도록 변경했다.
- `/api/history/overview`와 `/api/documents` 검색을 Supabase 쿼리 단계의 핵심 컬럼 검색으로 개선했다.
- `user_preferences` 테이블과 `GET/PUT /api/user/preferences` API를 추가했다.
- 설정 탭의 기본 점검자, 서버 모델, Iptables 상태, 발송 모드, 해결 상태 처리 기본값을 서버에 저장하도록 변경했다.
- localStorage 설정은 서버 설정 조회 실패 시 fallback 용도로만 사용한다.
- 관리자 overview 조회 시 `admin.overview.view`, 검색/필터 조회 시 `admin.overview.search` 감사 로그를 남기도록 했다.
- Supabase 운영 DB에 `user_preferences` 마이그레이션을 적용했다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과
- Supabase `public.user_preferences` 테이블 생성 확인

커밋/배포:
- Commit: `2a6a0c6 Improve personal history and preferences`
- Production: 배포 예정

### 설정 탭 설명 문구 제거

변경 사항:
- 설정 탭의 `적용 방식` 안내 박스를 제거했다.
- `docs/CURRENT_FEATURES.md`에서 설정 탭의 제외 기능 설명 문구를 제거했다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- Commit: `61cfb04 Remove settings explanatory copy`
- Production: https://check-server-site.vercel.app

### 이력/문서함/설정 탭 1차 추가

변경 사항:
- 운영자용 `이력` 탭을 추가했다.
- `GET /api/history/overview` API를 추가해 점검 조회, 점검서 생성, 메일 발송 이력을 통합 조회하도록 했다.
- 이력 탭에 기간, 유형, 상태, 검색어 필터를 추가했다.
- 운영자는 본인 이력 중심, 관리자는 전체 이력을 볼 수 있도록 API 권한 기준을 적용했다.
- `문서함` 탭을 추가했다.
- `GET /api/documents` API를 추가해 생성 문서 목록을 조회하도록 했다.
- 문서함에서 DOCX/PDF 다운로드를 제공한다.
- 문서함에서 PDF 생성 완료 문서를 메일 첨부로 바로 사용할 수 있도록 했다.
- `설정` 탭을 추가했다.
- 설정 탭에서 기본 점검자, 기본 서버 모델, 기본 Iptables 상태, 기본 발송 모드, 발송 후 해결 상태 처리 기본값을 저장하도록 했다.
- 설정 저장은 localStorage 기반 개인 설정으로 구현했다.
- 요청에 따라 솔루션 아이디 삭제 기능은 설정 탭에서 제외했다.
- 시리얼 검색값은 저장하지 않는다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- Commit: `c2902b3 Add history documents and settings tabs`
- Production: https://check-server-site.vercel.app

### 점검 데이터/로그인 UX 개선

변경 사항:
- 로그인 화면 제목을 `점검 시스템 로그인`으로 중앙 정렬하고 보조 설명 문구를 제거했다.
- 앱 로그인 실패 문구를 사용자용 문장으로 정리했다.
- 솔루션 계정 로그인 문구를 `솔루션 아이디`, `솔루션 로그인 중`, `솔루션 계정 로그인이 필요합니다`로 통일했다.
- 솔루션 세션 메타데이터(`username`, `masked`, `expiresAt`)를 localStorage에 저장하고 복구하도록 했다.
- 실제 솔루션 토큰은 계속 httpOnly cookie에만 저장한다.
- 솔루션 세션 만료 또는 로그아웃 시 저장된 세션 메타데이터를 삭제하도록 했다.
- 점검 데이터 카드의 디스크 라벨을 `/ 파티션`, `/home 파티션`, `/storage 파티션`으로 변경했다.
- 서비스 상태명을 `에이전트 연결`, `웹 접속`, `DB 서비스`, `방화벽 정책` 등 한글 업무명으로 표시하도록 했다.
- 원본 주요 값의 필드명을 한글 라벨로 표시하도록 했다.
- 솔루션 로그인 실패와 점검 조회 실패를 감사 로그로 남기도록 했다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- Commit: `bb2706b Improve check flow login and labels`
- Production: https://check-server-site.vercel.app

### 관리자/메일 상태 라벨 한글화

변경 사항:
- 관리자 작업 필터와 로그 테이블에서 내부 action key 대신 한글 작업명을 표시하도록 했다.
- 관리자 로그 대상 컬럼에서 내부 target type 대신 한글 대상명을 표시하도록 했다.
- 관리자/메일 발송 상태에서 내부 상태값 대신 사용자용 라벨을 표시하도록 했다.
- `Dry-run 테스트`, `solved 처리` 문구를 `테스트 전송`, `해결 상태 처리`로 정리했다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- Commit: `2aa35f1 Localize admin and mail status labels`
- Production: https://check-server-site.vercel.app

### 관리자 콘솔 검색/초대 개선

변경 사항:
- 관리자 검색/필터 값을 `/api/admin/overview` 요청에 반영했다.
- 검색 버튼을 추가했다.
- 팀원 초대 기본 역할을 `조회자`로 변경했다.
- `관리자` 권한 초대 시 확인 체크 없이는 발송할 수 없도록 했다.
- 초대 대기 수를 `invitedAt && !emailConfirmedAt` 기준으로 계산하도록 했다.
- 필터 적용 시 관리자 overview 조회 범위를 확장했다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- Commit: `0800b79 Improve admin console filters and invitations`
- Production: https://check-server-site.vercel.app
### PDF 변환 제공자 전환 및 점검서 체크 표시 고정

변경 사항:
- PDF 변환 제공자를 `PDF_CONVERTER_PROVIDER` 환경변수로 선택하도록 정리했다.
- `PDF_CONVERTER_PROVIDER=cloudconvert`이면 CloudConvert Jobs API를 사용하고, `convertapi`이면 기존 ConvertAPI를 사용한다.
- CloudConvert 변환은 `import/upload -> convert -> export/url` 순서로 처리한다.
- ConvertAPI로 되돌릴 때는 코드 수정 없이 Vercel 환경변수 `PDF_CONVERTER_PROVIDER=convertapi`로 변경하면 된다.
- 점검서 정상/비정상 체크 표시는 컬러 심볼 대신 검정색 `✓` 런을 DOCX XML에 직접 삽입하도록 고정했다.
- PDF 변환 오류 메시지 일부를 정상 한글 문구로 정리했다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- Commit: `Add CloudConvert PDF provider`
- Production: https://check-server-site.vercel.app
### 점검자 서명 크기 및 간격 조정

변경 사항:
- 점검서 점검자 서명 이미지 크기를 기존 8mm 폭 기준에서 12mm 폭 기준으로 확대했다.
- 점검자 이름과 서명 이미지 사이에 고정 공백을 추가해 두 요소가 붙어 보이지 않도록 조정했다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- Commit: `TBD`
- Production: https://check-server-site.vercel.app

### 일괄 시리얼 추가 키보드 흐름 개선

변경 사항:
- 일괄 점검에서 `+ 시리얼 추가` 버튼을 키보드 또는 마우스로 실행하면 신규 LO 시리얼 입력란으로 포커스가 자동 이동하도록 수정했다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- Commit: `TBD`
- Production: https://check-server-site.vercel.app

### 일괄 발송 확인창 스크롤 및 PDF 미리보기 개선

변경 사항:
- 일괄 발송 확인창을 `헤더 / 요약 / 스크롤 목록 / 고정 버튼` 구조로 변경해 항목이 많아도 목록을 스크롤할 수 있도록 수정했다.
- 일괄 발송 확인 항목을 기본 접힘 상태로 표시해 필요한 고객사만 펼쳐서 확인할 수 있도록 했다.
- 일괄 처리 목록의 PDF 생성 완료 영역에 `미리보기` 버튼을 추가했다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- Commit: `TBD`
- Production: https://check-server-site.vercel.app

### 일괄 Zendesk 발송 최종 확인 및 자동 해결 적용

변경 사항:
- 일괄 Zendesk 발송의 `autoSolve` 값을 `true`로 변경했다.
- 일괄 실제 전송 티켓도 해결 처리 시 Zendesk `점검 자동화` 체크박스 필드를 활성화한다.
- 기존 브라우저 기본 확인창을 제거하고 일괄 발송 전용 최종 확인창을 추가했다.
- 확인창에서 항목별 고객사, 시리얼, 요청자 이름/이메일, 점검자, 제목, PDF 첨부 파일명, 메일 본문을 확인할 수 있다.
- 사용자가 최종 확인 버튼을 눌러야 일괄 테스트/실제 전송이 시작된다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- Commit: `TBD`
- Production: https://check-server-site.vercel.app

### Zendesk 해결 처리 및 요청자 본문 반영 개선

변경 사항:
- 실제 티켓 `#60171` 조회 결과 `티켓처리자(공용계정, 28476275807129)` 값이 비어 있어 해결 처리 검증에 실패하는 것을 확인했다.
- 자동 해결 처리 시 생성에 사용한 필수 커스텀 필드와 `solved` 상태를 같은 Zendesk 요청으로 적용하도록 수정했다.
- `발송 후 해결 상태 처리`가 선택되면 Zendesk `점검 자동화` 체크박스 필드(`58864476958489`)를 `true`로 적용하도록 추가했다.
- 요청자 선택 시 본문이 직접 편집된 상태여도 기존 담당자명만 선택한 고객사 담당자명으로 교체하도록 수정했다.
- 조직 변경 중 기존 요청자명을 즉시 지우지 않고, 다음 요청자 선택 시 본문 담당자명 교체에 사용하도록 수정했다.

검증:
- Zendesk API로 `점검 자동화` 필드가 활성 체크박스이며 티켓 양식에 포함된 것을 확인
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- Commit: `TBD`
- Production: https://check-server-site.vercel.app

### 일괄 점검 Zendesk 발송 안정성 개선

변경 사항:
- 일괄 Zendesk 발송은 한 번에 최대 10건까지만 실행하도록 제한했다.
- 일괄 발송 중 조회, PDF 생성, Zendesk 발송 단계별 진행률을 화면에 표시하도록 했다.
- 실패한 항목만 다시 선택할 수 있는 버튼을 추가했다.
- 일괄 발송 중 각 행은 `발송 중` 상태를 표시하고, 완료 후 테스트 전송/실제 전송 완료 문구를 구분한다.
- 일괄 발송 idempotency key를 랜덤값 대신 사용자, 전송 모드, 문서, 시리얼, 요청자 기준의 안정적인 키로 생성하도록 변경했다.
- 테스트 전송 완료 후 실제 전송으로 전환하면 실제 전송용 중복 방지 키를 별도로 사용하도록 했다.
- 서버 티켓 예약 로직에서 실패 상태의 기존 예약은 같은 idempotency key로 재시도할 수 있도록 처리했다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- Commit: `TBD`
- Production: https://check-server-site.vercel.app

### Load Average 점검 결과 표시 개선

변경 사항:
- CPU 카드의 보조 문구로 표시하던 Load Average 1분 값을 제거했다.
- 점검 결과 UI에 `Load Average` 독립 카드를 추가하고 1분, 5분, 15분 값을 함께 표시한다.
- 원본 주요 값 영역에도 Load Average 1분, 5분, 15분 값을 추가했다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- Commit: `TBD`
- Production: https://check-server-site.vercel.app

### 일괄 점검 자동 선택 기준 조정

변경 사항:
- 일괄 점검 자동 선택 기준에서 파티션 사용률 80% 이상 조건을 제외했다.
- 화면의 판정/상세 사유에는 기존처럼 파티션 사용률 사유를 표시하되, 자동 체크 여부만 예외 처리했다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- Commit: `TBD`
- Production: https://check-server-site.vercel.app

### Iptables·에이전트 점검서 기본값 통합

변경 사항:
- 개인 설정에 `기본 에이전트 연결 상태`를 추가했다.
- 단건 점검서 생성 전에 에이전트 연결 상태를 수동 선택할 수 있도록 추가했다.
- 기본 Iptables 및 에이전트 연결 상태가 단건·일괄 DOCX/PDF 생성에 동일하게 반영되도록 수정했다.
- 수집 원본과 화면의 서비스 상태는 유지하고, 점검서 체크 결과에만 사용자 기본값을 적용한다.
- 사용자별 에이전트 기본 상태 저장을 위한 Supabase 마이그레이션을 추가했다.

에이전트 연결 판정:
- Solution 응답의 `agentStatus`, `agent_ok`, `agentOk`, `agent.status` 중 값을 사용한다.
- boolean `true`, 숫자 `1`, 문자열 `true`, `Y`, `yes`, `ok`, `1`, `active`, `running`, `success`, `normal`, `정상`을 정상으로 판단한다.
- 값이 없거나 그 외 값이면 비정상으로 판단한다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

DB 적용:
- `supabase/migrations/202606110001_user_preferences_agent_status.sql`
- Supabase CLI 프로젝트가 연결되어 있지 않아 원격 DB에는 자동 적용하지 못했다.

커밋/배포:
- Commit: `TBD`
- Production: https://check-server-site.vercel.app

### 메일 서버 상태 판정 예외 처리

변경 사항:
- `mailServerStatus=N` 단독 값은 SMTP 미사용 상태로 보고 정상 처리하도록 변경했다.
- `logData.checkMailServer`에 구조화된 오류 코드 또는 연결 실패·거부·시간 초과·예외가 있을 때만 메일 서버를 비정상으로 판정한다.
- 일괄점검 판정에서 메일 상태뿐 아니라 메일·SMTP 관련 경고도 제외하도록 수정했다.
- 일괄 점검 탭에 전용 의견 입력란을 추가하고 선택 항목의 모든 점검서에 동일하게 반영되도록 했다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- Commit: `TBD`
- Production: https://check-server-site.vercel.app
