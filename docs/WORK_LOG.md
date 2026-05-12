# Work Log

이 문서는 작업 단위별 변경 사항, 검증 결과, 커밋/배포 정보를 추적한다.

운영 규칙:
- 기능, 보안, UI, API 동작이 바뀌는 작업 뒤에는 이 문서를 갱신한다.
- 함께 `docs/CURRENT_FEATURES.md`도 최신 기능 기준으로 갱신한다.
- 검증하지 못한 항목은 통과로 적지 않고, 미검증 또는 실패 사유를 남긴다.

## 2026-05-08

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
