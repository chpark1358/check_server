# 현재 작업 상태 — 2026-10-29

## 최신: Google 개인키 등록 완료, 형식 오류 수정 대기

- 사용자가 `GOOGLE_SHEETS_PRIVATE_KEY` 등록 완료를 알렸고 Vercel Preview 브랜치 메타데이터에서 등록 사실을 확인했다. 비밀값은 읽거나 출력하지 않았다.
- 최신 Preview `dpl_DiDSMeFnbdg2Xu4wexHa4KCFvUtP` READY, `https://check-server-site-j6xr29wl2-chpark425-3494s-projects.vercel.app` 및 기존 고정 Preview alias 연결을 확인했다. 앱 소스는 `617ae1486a2f22a1b86d22fb97959de02999205b` 그대로다.
- 실제 Aside 관리자 계정의 점검 일정 탭은 `unconfigured`와 “Google 서비스 계정 비밀키 형식을 확인해 주세요.”를 표시했다. 서버의 개인키 서명 단계에서 실패하므로 Google 인증·시트 요청 전 단계다. **키 등록은 완료됐지만 실제 Google 읽기는 성공하지 않았다.**
- CLI `env run` 메모리 검사에서는 개인키를 조회하지 못해 `present: false`였다. 이는 Vercel 메타데이터의 등록 사실 및 앱이 비어 있지 않은 값을 읽고 서명을 시도한 사실과 별개다. 비밀값을 확인하지 못해 키 ID 입력·잘림·JSON 전체 입력 중 어떤 원인인지 단정하거나 자동 수정하지 않았다.
- 사용자의 키 메뉴 값 질문에 따라, 콘솔의 키 식별자와 JSON의 `private_key_id`는 서명용 개인키가 아니며 필요한 값은 같은 JSON의 `private_key` 전체 PEM임을 안내했다. 사용자는 지금 새 키를 만들 수 없다고 했으므로 새 키 생성·정책 변경·기존 키 삭제는 하지 않는다. 기존 JSON 또는 승인된 보관소의 원본 PEM이 있으면 재사용할 수 있다. 실제 등록값이 키 ID였다고 확정하지 않는다.
- 다음 선택은 기존 JSON/승인된 보관소의 원본 PEM 경로 확인 또는 키 없는 방식 검토다. 원본 PEM을 확보하면 Vercel의 값을 수정할 수 있다. 수정 → Preview 재배포 → Google 읽기 확인 순서가 남는다. 원본 파일 뷰어 공유와 실제 operator/viewer 로그인 비교도 미검증이다.
- 같은 앱 소스의 별도 로컬 일정 검사 26/26 통과: `node --test tests/schedule-data.test.mjs tests/schedule-source.test.mjs tests/schedule-panel.test.mjs`. 합성 응답·화면 검사이며 실제 Google 연결 성공을 뜻하지 않는다.
- main·기본/보조 Production `dpl_6zRKe41fRhZ19ckKK65dF7zxuvEU`, Preview `SCHEDULE_MIN_ROLE=operator`, 실제 발송 false를 유지했다. 앱 코드·원본 시트·공유 DB 변경 및 실제 티켓/메일/외부 알림 0. 근거: `test-results/schedule-live-20261029/validation.json`.

- 대안 검토: Vercel OIDC + Google Workload Identity Federation + 기존 서비스 계정 impersonation은 공식 지원 조합이다. 다만 현재 코드는 PEM 방식만 지원하므로 클라우드 풀·신뢰 조건·서비스 계정 권한·서버 토큰 획득 코드 변경이 필요하다. Sheets 읽기 전용 scope를 지정하는 설계는 가능하지만 이 프로젝트의 권한·설정·실동작은 미검증이며 적용하지 않았다.

## 2026-10-29 이전 단계 기록: 주소·권한·이메일 반영, 개인키 등록 전

- 10/29 사용자가 보조 운영 주소 동기화와 관리자·operator의 팀 전체 일정 조회를 명시 승인했다.
- 보조 주소 `check-server-site-chpark425-3494s-projects.vercel.app`를 승인 대상 Production `dpl_6zRKe41fRhZ19ckKK65dF7zxuvEU`로 연결하고 inspect로 확인했다. 기본 운영 주소와 같은 이력 개선 버전이다. 이전 자동 승인 심사 차단은 이번 명시 승인 후 해소했다.
- `SCHEDULE_MIN_ROLE=operator`를 Preview → `codex/preview-sandbox`에 등록했다. CLI env run으로 값이 정확히 `operator`임을 확인했고 실제 발송 설정은 false다. 코드의 미설정 기본값admin과 viewer 차단은 유지한다.
- 같은 일정 소스 `617ae1486a2f22a1b86d22fb97959de02999205b`의 최종 재배포: `dpl_8okB1CcDW2L7G89jXRpikvYQFTpc` READY, `https://check-server-site-3gxsqqi1n-chpark425-3494s-projects.vercel.app`. 역할과 서비스 계정 이메일까지 반영한 배포로 기존 고정 Preview alias도 연결했다. 일정 코드는 여전히 main 미반영이다.
- 사용자가 알려준 기존 Google 프로젝트 ‘googledrive monitor’를 회사 로그인 계정의 UI에서 확인했다. 프로젝트 ID는 `commanding-time-503702-i7`, 기존 서비스 계정은 `wiki-checker@commanding-time-503702-i7.iam.gserviceaccount.com`이며 Sheets API 사용 설정을 확인했다.
- 해당 서비스 계정 이메일을 `GOOGLE_SHEETS_CLIENT_EMAIL`로 Preview 브랜치에 등록하고 최종 배포에 반영했다. 서비스 계정의 활성 키1개가 존재하는 것은 확인했지만 비밀키 내용은 읽거나 새 키를 생성하지 않았다. `GOOGLE_SHEETS_PRIVATE_KEY`는 미등록이며, 기존 JSON 키 파일의 정확한 경로나 Vercel 직접 등록 완료를 기다리고 있다. 키 내용·토큰은 채팅/문서에 받거나 기록하지 않는다.
- Google 실연동과 원본 파일 뷰어 공유의 유효성은 아직 검증하지 않았다. 기존 서비스 계정을 새로 만들지 않고 키 등록 → Preview 재배포 → 읽기 검증 순서로 진행한다.
- 오늘 일정 source·panel 검사20/20과 독립 권한 집중3/3 통과: 실제 requireRole 역할 계층, 설정 정보의 관리자 한정 노출, 일정 API의 최소 역할·조회 전 차단/no-store. 이는 10/28의95개 회귀검사와 별도이며 실제 operator 계정 로그인 검증을 대체하지 않는다. 오늘 로그는 `test-results/schedule-role-20261029/focused-tests.log`다.
- 원본 시트 수정·공유 DB 변경·실제 티켓/메일/외부 알림0. 남은 입력은 Google 기존 JSON 키 경로 또는 Vercel의 PRIVATE_KEY 등록 완료다. Google 읽기 검증 뒤 실제 operator/viewer 비교가 남는다.
- 보고서 `schedule-implementation-2026-10-28/index.html`은10/29 상태로 갱신했다. 폴더명은 기존 링크 유지를 위해 변경하지 않았다.

## 2026-10-28 기록: 이력 main 반영 · 읽기 전용 일정 Preview

- 사용자 지시로 검증된 이력 개선 `0e99d676de599978494e17733181129d1bbc8109`만 main 반영. 기본 Production `dpl_6zRKe41fRhZ19ckKK65dF7zxuvEU` READY, `https://check-server-site.vercel.app/`에서100선택·60건XLSX실다운로드 확인. 파일60행/13열/C8/A7:M67/수식0,10,656B. 실제 파일은 private 검증 폴더에만 보존한다.
- 보조 Production 주소 `check-server-site-chpark425-3494s-projects.vercel.app`는 이전 배포를 가리킨다. 같은 배포 연결 시도가 자동 승인 심사에서 '보조 운영 라우팅 변경 명시 승인 필요' 사유로 차단됐다. 사용자에게 정확 범위를 질문했고 아직 답변이 없어 재시도하지 않았다.
- 일정 소스 `617ae1486a2f22a1b86d22fb97959de02999205b`, Preview `dpl_Fb3ze7cMZfzaAqL6pLBJy9Bai2zR` READY. 기존 고정 Preview alias 연결 완료. 일정 코드는 main에 포함하지 않았다.
- 일정: 7일/30일/전체/기간 지정, 검색, 분류, 서버 페이지, 원본 상세, 모바일 카드. 쓰기·점검·발송·예약 동작 없음. 기본 조회 권한admin, 승인 후 SCHEDULE_MIN_ROLE=operator로 확대 가능. 역할 질문 미답변이므로 admin 유지.
- Google 읽기 전용 서비스 계정 JWT(위임sub없음), 고정 파일/gid, 필요한 A:Q만 GET. 5분 메모리 캐시·동시조회 병합. 일시 장애만30분까지 이전자료 표시; 권한/키/스키마 실패는 자료 제거. 데이터/상태응답에 no-store. DB 변경 없음.
- Google 환경변수가 아직 없어 실제 Google 연결은 미검증이다. `GOOGLE_SHEETS_CLIENT_EMAIL`, `GOOGLE_SHEETS_PRIVATE_KEY`를 Preview/codex/preview-sandbox에 등록하고 원본파일을 서비스 계정에 Viewer로 공유해야 한다. 키는 채팅에 받지 않는다. 안내 `docs/SCHEDULE_GOOGLE_SETUP.md`.
- 집중95/95·전체tsc·대상lint 통과. 이전10/27 CSV5,461행으로11개필수헤더 및파서오프라인 검증,엄격serial5,236·동일회차후보107행,당시7일17/30일133 일치.99ms는 로컬파서1회 측정이며실제GoogleAPI성능이 아니다.
- 로컬합성 UI56검토행의1–30/31–56페이지·협력사6건필터·상세K/M/O·모바일390px가로넘침없음·상세닫기포커스복귀 확인. Google 실연동이나실사용자역할비교와구분한다.
- 백업 `test-results/schedule-readonly-20261028/before-history-main.bundle` 전체Git이력 검증완료. SHA256 `42fc1f31dabadd812e2304f9d0f87407257c3433bb5b0a708eb85cbaf8dd33eb`. 이력 롤백은 이전Production `dpl_9RjxscJT6k1NgjCQoXMCsD9Wnj4R`/`2ddf0d3`, DB 복원은필요없음.
- 실제발송 차단 유지. 원본시트 수정0, 실제티켓/메일/외부알림0. 현재 필요한 사용자 결정은 Google연동계정,조회역할,보조Production동기화승인.
- 보고서 `schedule-implementation-2026-10-28/index.html`, 기존 `review.html#schedule-implementation-20261028`. 근거 `test-results/schedule-readonly-20261028/`.

## 이전 단계: 작업 이력 표시 개수·XLSX (Preview 검증 당시)

- 구현 소스 `0e99d676de599978494e17733181129d1bbc8109`, 원격 `codex/preview-sandbox` 반영.
- Preview `dpl_2YDNEzLSMXFEDzrcyVAg3z95mD42` READY. 기존 고정 Preview 주소를 새 배포로 연결했다.
- main은 `2ddf0d3`, Production은 `dpl_9RjxscJT6k1NgjCQoXMCsD9Wnj4R` 그대로다. 이번 작업은 운영 전환/실발송 없이 Preview에서 완료했다.
- 표시 20/30/50/100 선택 시 적용된 검색 조건으로 첫 페이지 재조회. 기존 limit 포함 서명 커서를 새 크기와 섞지 않는다.
- XLSX 현재 페이지/조회 조건 전체 선택. 전체는 기존 owner-scoped GET을 200건씩 별도 커서로 조회, 최대5,000건. 초과/중복/실패 시 일부 파일 저장 없이 안내한다. 조회 기준은 생성시각 상한이며 기존 상태의 트랜잭션 스냅샷 보장은 아니다.
- 새 조회·취소·로그아웃·계정 변경·화면 해제 시 내보내기 취소. 조건 미적용/빈 결과/조회 실패에서는 다운로드 차단.
- 기존 PizZip을 지연 로딩해 13열 XLSX 작성. 제목/조건/KST/그룹 헤더/셀 경계/줄무늬/7행+2열 고정/필터. 모든 입력은 inlineStr, CC 미기록/없음 및 자동 해결 요청/결과 구분. 추가 패키지·API·DB 변경 없음.
- 집중68/68·전체 tsc·대상 ESLint 통과. 독립 리뷰의 취소/로그아웃 race 보완 완료. Preview 빌드 성공.
- 실제 Aside 계정에서20/30/50/100 선택,30건의31–60/50건의51–60 페이지 및 크기 변경 첫 페이지 복귀 확인. 실제 XLSX60행/13열/C8고정/A7:M67필터/수식0 확인. 실제 파일은 private 검증 폴더에만 둔다.
- 합성 현재 페이지30행/전체36행 다운로드, LibreOffice 읽기/PDF 렌더 확인. 모바일390px에서 가로넘침 없음. 실제 발송·시트 수정·DB 변경0.
- 근거 `test-results/history-xlsx-20261028/validation.json`, `focused-tests.log`. HTML `history-schedule-2026-10-28/index.html`, 기존 보고서 `#history-xlsx-schedule-20261028`.

## 이전 단계: 일정 연동 UI 검토 (구현 전)

- 기존 메뉴에 ‘점검 일정’ 추가, 예정 목록/검색/상세/사이트 내부 배지부터 구현 가능한 것으로 검토했다. 합성 HTML 목업 제공. 자동 점검·외부 알림·발송은 별도 단계.
- 사용자 확정: K는 영업 대략 일정, O는 사후 수행자, X/x는 다양한 미실시 사유, 고은은 협력사. O 공란을 담당 미배정으로 오판하거나 X를 자동 재시도하지 않는다. 미래 행의 수행 범위는 과거 O만으로 확정하지 않는다.
- 실제 연동 전 회사 Google 읽기 계정/서비스 계정과 사이트 역할별 고객 조회 범위 확정 필요. 원본 시트 수정은 허용되지 않았다.
- 상세 검토/상태 계약 `test-results/history-xlsx-20261028/schedule-ui-review.md`. 원본 데이터는 이전10/27 분석을 참고했으며10/28 새 전체 시트 실조회로 표기하지 않는다.

---

아래는 이전 CC 운영 반영 기록이다.

업무 CC 지원을 완료했다. 사용자의 진행 지시에 따라 CC 열을 추가하고 Preview 검증 후 기존 main·Production에 반영했다. 실제 발송 차단은 유지한다.

## 현재 배포·롤백

- 운영 main·Preview 소스: `2ddf0d3debf03c96711c2c9f2fafb09af001e7eb`.
- Production: `dpl_9RjxscJT6k1NgjCQoXMCsD9Wnj4R`, `https://check-server-site.vercel.app/`.
- Preview: `dpl_JCQYLxcwet6hnozcXnDdEJkNZq8s`, 기존 고정 Preview 주소 유지.
- 운영 주소 3개와 고정 Preview의 실제 배포 ID·Ready·소스 SHA 일치 확인. 고정 Preview와 보조 운영 주소는 직접 동기화했다.
- `ALLOW_REAL_ZENDESK_SEND=false`; 양쪽 실제 health200·dry-run. 실제 업로드·티켓·메일·자동 해결 요청은 0이다.
- 코드 복귀 대상: 직전 운영 `dpl_D72n51xmDJrk1WK5gdh78RZ9px5y / 71dd6dc`. 추가 CC 열과 기록은 유지한다. 이 CC 지원 전 버전으로 복귀하면 실발송 차단을 해제하지 않는다.
- `test-results/cc-support-20261021/production-before-cc.bundle` 전체 Git 이력 검증 완료. 구버전 activate-test.ps1은 재사용하지 않는다.

## DB·기존 데이터 보존

- 10/26 안내한 구체 SQL과 진행 순서에 대해 10/27 사용자가 진행 지시. 적용 SQL: `supabase/migrations/202610210002_ticket_cc_snapshot.sql`.
- nullable `cc_emails text[]` 한 열과 배열 형태·최대48개·NULL/빈 원소 금지 제약을 추가했다. 권한·기존 매핑·기존 행은 변경하지 않았고 백필하지 않았다.
- 기존 이력47건의 전체 값(CC 새 열 제외)과 기존 매핑40건의 값·해시가 적용 전후 및 테스트 후 동일했다.
- 이력 해시: `1c9b8ebdb1ce753e76f438045fa071e5`. 매핑 해시: `a5a623b345bad215ed6657157d204d53`.
- 현재48건 = 기존47 + 합성 dry-run 테스트1. 기존47건의 CC는 NULL, 새 테스트에는 합성 CC2개가 저장됐다.
- 기존 매핑40개 중 CC 등록은0개다. 실제 업무용 CC는 사용자가 해당 매핑 입력란에 등록해야 한다. 이번에 실제 매핑을 수정하지 않았다.
- 적용 직전 SQL 백업18,797B, SHA256 `3e5083aaae02285e4d213511a8a2e93bde4fc4a6a0df4e9fe535d7758b6d3d34`. 원본은 test-results 안에만 보관하고 보고서 폴더에 복사하지 않았다.

## 구현·검증

1. 매핑 CC → 단건/일괄 요청 → 최종 확인창 → 최근·통합·관리자 이력 연결. 이력은 발송 시점의 요청 CC이며 수신 완료 증거가 아니다. 이전NULL은 미기록, 새[]는 참조 없음이다.
2. 쉼표/세미콜론/줄바꿈 입력, 소문자 정규화, 중복·요청자 제외, 최대48명 검증. 잘못된 주소는 첨부/발송 전에 차단한다.
3. 단건·일괄 첫 시도의 조직/요청자/CC를 고정한다. 같은 키 재시도에 다른 수신처를 채택하지 않는다. completed duplicate는 저장된 CC를 반환한다.
4. 첫 시도 전 항목은 최신 매핑으로 갱신하고 삭제된 매핑은 해제한다. 시도 후 스냅샷은 유지한다. 자동 학습/미저장 학습 재시도로 삭제·수정된 주소를 되살리거나 기존 시리얼 매핑을 덮지 않게 보완했다.
5. 실제 CC 발송 허용 시 Zendesk 계정의 modern CC/allow_ccs를 먼저 조회한다. 비활성·조회 불명은 생성 전 차단한다. 실발송에서 ccEmails 자체가 빠진 구버전 요청은 새로고침 안내와 함께400으로 차단한다. 명시[]는 허용.
6. 10/27 집중254/254·전체 타입·대상 lint 통과. 동일 SQL은 10/21 실제 로컬 PostgreSQL17.9 검사25개 통과. 독립 리뷰에서 발견한 stale 매핑 결함은 수정·재검토 완료.
7. 실제 Preview API: 정규화 CC2개와 email_ccs payload 확인, invalid400, 테스트POST202. 새로고침/이력조회/다른CC를 넣은 같은키POST200에서도 최초CC2개와 1행 유지.
8. 가상 UI 경로는 `/ui-preview`다. 샘플 고객 A의 매핑 CC `cc.review@example.invalid`가 입력란과 최종 확인창에 자동 반영됨을 확인했다. 실제 고객 매핑 검증과 구분한다.
9. 운영에서는 새 POST 없이 최근·통합·관리자 이력200에서 동일 CC를 확인했다. 실제 Zendesk CC 수신은 아직 검증하지 않았다.
10. 테스트 키 `cc-support-preview-20261027-01-6c9d8f4a`, 행 `73dd6057-1a77-4022-b405-949c1fc8b6a2`. 이 키를 새 발송 용도로 재사용하지 않는다.

## 유지 계약·다음 순서

- 자동 해결 결과 영구 저장은 유지한다. 점검 자동화 `58864476958489` 항상true, 기존 문의제품/분류 값 유지.
- 10/21 Zendesk 설정 읽기: allow_ccs=true, modern CC=true, 차단목록0. 설정은 변경하지 않았고 오늘 재조회한 것으로 표시하지 않는다. 실제 CC 시도마다 서버가 활성 설정을 다시 검증한다.
- 다음은 승인된 수신처·시간·범위를 정한 실제 CC 수신/자동 해결 검증, 이후 최소건수 일괄 UI 실제 시험이다. 현재 지시는 실제 발송 승인이 아니다.
- 회사메일 미수신 원인과 보존 정책은 별도 과제다. 앞선 Gmail 수신은 사용자 확인 완료이며 기존 시험 티켓 상태를 추정하거나 정리하지 않는다.

## 근거

- `test-results/cc-support-20261021/`: focused-tests-20261027.log, local-verification.json, local-postgres-verification.json, shared-db-application.json, existing-history-preserved.json, preview-runtime.json, production-runtime.json, release.json.
- HTML: 기존 followup-validation-2026-10-16/review.html `#cc-support-20261021`. 표시 완료일은2026-10-27이며 이전 섹션은 당시 기록이다.
- 이전 완료 소스71dd6dc, 이전 자동 해결 기록은 `test-results/solve-persistence-20261021/`에 보존한다.
