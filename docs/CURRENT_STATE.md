# 현재 작업 상태 — 2026-10-28

## 최신: 작업 이력 표시 개수·XLSX (Preview 완료)

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

## 일정 연동 UI 검토 완료 (미구현)

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
