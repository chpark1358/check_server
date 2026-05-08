# Work Log

이 문서는 작업 단위별 변경 사항, 검증 결과, 커밋/배포 정보를 추적한다.

운영 규칙:
- 기능, 보안, UI, API 동작이 바뀌는 작업 뒤에는 이 문서를 갱신한다.
- 함께 `docs/CURRENT_FEATURES.md`도 최신 기능 기준으로 갱신한다.
- 검증하지 못한 항목은 통과로 적지 않고, 미검증 또는 실패 사유를 남긴다.

## 2026-05-08

### 설정 탭 설명 문구 제거

변경 사항:
- 설정 탭의 `적용 방식` 안내 박스를 제거했다.
- `docs/CURRENT_FEATURES.md`에서 설정 탭의 제외 기능 설명 문구를 제거했다.

검증:
- `npm run typecheck` 통과
- `npm run lint` 통과
- `npm run build` 통과

커밋/배포:
- 진행 예정

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
