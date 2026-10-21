# 현재 작업 상태 — 2026-10-21

자동 해결 결과 영구 저장을 완료했다. 공유 DB 변경은 구체적 SQL·로컬 검증을 안내하고 사용자 승인을 받은 뒤 적용했다. 기존 이력은 그대로이며 Preview 검증 후 기존 main·Production에 반영했다. 실제 발송 차단 유지.

## 현재 배포·롤백

- 운영 main·Preview 소스: `71dd6dc68b8c294ebe73c9dbea96d0ee2abccdc9`.
- Production: `dpl_D72n51xmDJrk1WK5gdh78RZ9px5y`, `https://check-server-site.vercel.app/`.
- Preview: `dpl_Cn5TJCZbm4LcqGRXxnuF9XBnKr93`, 기존 고정 Preview 주소 유지.
- 고정 Preview·보조 운영 주소를 직접 동기화. 운영 주소3개/Preview의 실제 ID·Ready·소스 SHA 일치 확인.
- `ALLOW_REAL_ZENDESK_SEND=false`; Preview·Production health200/admin/dry-run. 실제 업로드·티켓·메일·자동 해결 요청 0.
- 코드 롤백: 직전 운영 `dpl_8JH7x1av5N6YWP9xTsZmm8KAEE81 / 46f56ce`. 추가 DB 열과 저장 결과는 유지하고 삭제하지 않는다.
- `test-results/solve-persistence-20261021/production-before-solve-persistence.bundle` 전체 Git 이력 검증 완료.
- 과거 real-send/gmail-send의 activate-test.ps1은 구버전 DQt/106ff48을 재배포하므로 그대로 사용하지 않는다. 향후 승인된 시험은 현재D72/71dd6dc 기준.

## DB 변경·이력 보존

- 사용자 승인: 기존46건 수정/삭제 없이 결과·오류·기록시각3열 및 검증제약 추가 승인.
- 적용 SQL: `supabase/migrations/202610210001_ticket_auto_solve_result.sql`.
- nullable `auto_solve_status`, `auto_solve_error`, `auto_solve_recorded_at` 추가. 기존 `auto_solved`는 요청 여부이며 백필 없음. 기존46건 새열NULL.
- 적용 전후 및 Preview 시험 후 원래46건 digest 동일: `d2cd0c4b2ff1936b41fb9808501f84a5`. 현재47건 = 기존46 + 명시적dry-run 시험1건.
- RLS/권한 변경 없음; 실제 공유DB write policy0, RLS활성. 실제 이력 백업 `ticket-sends-before.sql` 17,967B, SHA256 `fb7897595b9c2c4348e559be68ac04bae77b08942885706b57fcdd9a94387da7`.
- SQL 백업은 test-results 내부에만 보관. 개인정보 포함 가능하므로 HTML 공개 근거 폴더에는 복사하지 않았다.

## 구현·검증

1. 확정 결과를 발송 이력 final UPDATE에 원자 저장. pending/생성전실패에는 새3열NULL. 컬럼 미존재 시 외부 호출 전 차단.
2. provider PUT 응답의 동일 티켓 ID + status=solved만 완료. 명시적 미해결/거절은failed, 타임아웃·모호응답은unknown. 추가GET/재시도/POST2회 없음.
3. 신규 결과는 조회·동일 키 응답에서 유지. 기존행은 legacy 파생 상태 유지. 세 조회 API와 일반·최근·관리자 이력에 결과/오류/저장시각 표시. 저장시각은 실제 해결 시각·현재 Zendesk 상태를 의미하지 않음.
4. 기존 단건 완료 키 잠금, 일괄 부분실패 재생성 제외, dry-run 첨부 기록 방어 유지.
5. 집중138/138·lint·전체타입검사·독립리뷰·Vercel양쪽빌드 통과. 로컬 실제 PostgreSQL17.9 검사31개 통과(재시작 영구보존/제약/권한/구버전호환 포함).
6. 실제 Preview: 테스트POST202 → 새로고침 → 목록/통합이력200 → 같은키POST200 duplicate, 결과not_requested·recorded·동일시각. 화면에서 결과 저장시각11:55:37 KST·실제미실행 안내 확인.
7. 소비한 테스트 키: `solve-persistence-preview-20261021-01-70c5b3ad`; 행 `2fc96ed4-ac14-47cc-bc4d-4e4a83109d75`. 추가 발송용으로 재사용하지 않는다.
8. 운영은 추가POST 없이 동일기록을 최근·통합·관리자 이력에서200으로확인. 새해결성공 분기는 모의provider+실제localDB로검증했고, 실제Zendesk autoSolve=true 시험은아직아님.

## 유지 계약·남은 순서

- 점검 자동화 `58864476958489` 항상true; 문의제품 `32000684227225`의 `['오피스키퍼_구축형.']`, 분류 `31991461954201`의 `['정기점검']` 유지.
- 앞선 회사메일 #70715 미관측·Gmail #70725 사용자수신확인. PDF 직접열기 확인까지 확대하지 않음. 이후GET404원인은불명; 재생성/정리하지 않는다.
- 다음: 업무CC 입력·검증·payload·미리보기·이력·재시도 구현 → 승인된 실제자동해결1건 → 최소건수 일괄UI 실제시험.
- 회사메일추적·보존기간·티켓정리·상시발송활성화는별도판단. 이번요청은새실발송승인이아님. 추가계정·비밀값은현재필요없음.

## 근거

- `test-results/solve-persistence-20261021/`: local-verification.json, local-postgres-verification.json, shared-db-application.json, existing-history-preserved.json, preview-runtime.json, production-runtime.json, release.json.
- HTML: 기존 followup-validation-2026-10-16/review.html `#auto-solve-persistence-20261021`. 이전 섹션은 당시기록.
- 소스71dd6dc; 이전보완46f56ce 및 `test-results/followup-outcomes-20261021/`.
