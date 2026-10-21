# 현재 작업 상태 — 2026-10-21

후속 작업을 검토해 발송 결과 오표시·중복 생성·테스트 첨부 기록부터 보완했다. Preview 검증 후 기존 main·Production에 반영했으며 실제 발송은 계속 차단한다.

## 현재 배포·롤백

- 운영 main·Preview 소스: `46f56ced099d1931dd02217a533d3d8771495c86`.
- Production: `dpl_8JH7x1av5N6YWP9xTsZmm8KAEE81`, `https://check-server-site.vercel.app/`.
- Preview: `dpl_GyCL7kgYmWfTSfYQfFH3TTAiwxHb`, 기존 고정 Preview 주소 유지.
- 고정 Preview와 보조 운영 주소는 자동 갱신되지 않아 직접 동기화했다. 운영 주소 3개·Preview의 실제 배포 ID/Ready/소스SHA 대조 완료.
- `ALLOW_REAL_ZENDESK_SEND=false`, Preview·Production 실제 health200/admin/dry-run. 추가 실제 업로드·티켓 생성·메일·해결 요청 0.
- 롤백 대상은 직전 운영 `dpl_3QXz6w8MuFBcV3Sbma6UCyeK6P7B / ab0c49c`. 이번 보완은 빠지지만 기존 점검 자동화 체크 수정은 포함한다.
- 전체 Git 이력 bundle 검증 완료: `test-results/followup-outcomes-20261021/production-before-outcome-fix.bundle`. DB 마이그레이션 없음.
- 과거 real-send/gmail-send의 activate-test.ps1은 구버전 DQt/106ff48을 재배포하므로 그대로 사용하지 않는다. 향후 시험은 현재 운영 8J/46f56ce 기준.

## 완료·검증

1. 자동 해결 실패/미확인 경고를 단건·동일 키 중복 응답·일괄·이력에 유지한다. 생성 success/sent를 유지해 부분 실패를 재발송 대상으로 만들지 않는다.
2. 단건 실제 생성 후 현재 요청 키를 잠근다. 새 점검/문서 요청의 새 키는 허용하며, dry-run은 실제 생성으로 취급하지 않는다.
3. 일괄 요약은 요청 모드가 아닌 실제 응답의 dryRun으로 테스트/티켓 생성 건수를 나눈다.
4. generated attachment는 실제 provider upload인 경우만 새 attached_to_mail 기록을 쓴다. 기존 혼합 기록은 그대로 두고 문서함·관리자·이력에서 ‘첨부 처리 기록’으로 표시한다.
5. 현재 CC는 payload에 포함되지 않는다. 저장된 CC와 확인 화면에 미지원 안내를 추가했고 CC가 있는 일괄 항목은 경고한다.
6. 집중 검사 110/110, 대상 lint, 전체 타입 검사, 독립 리뷰, Preview·Production Vercel 빌드 통과. 실제 컴포넌트 handler·SSR 검사가 포함된다.
7. Preview에서 explicit dry-run 및 false 요청의 환경 강제 dry-run 모두202/true, 문서 flag false 유지. 운영에서도 explicit dry-run202/true·flag false 유지. 테스트 감사 기록은 남았다.
8. 실제 history API200·새 결과 필드 존재 확인. 조회한 success10건 중 요청false2건, 과거 요청true/결과unknown8건. 실제 Preview 이력·문서 상세·메일 문서 연결 화면 확인.

## 유지한 필드 계약·앞선 발송

- 점검 자동화 `58864476958489`: autoSolve와 독립적으로 항상true, 최종 필드에1개.
- 문의제품 `32000684227225`: 기존 multiselect `['오피스키퍼_구축형.']`; 분류 `31991461954201`: `['정기점검']`. 변경 없음.
- 앞선 회사메일 시험 #70715는 사용자 미관측. Gmail #70725는 사용자 수신 확인 완료이며 PDF 직접 열기 확인까지 확대하지 않는다.
- 두 시험은 합성PDF1개·CC0·autoSolve=false였다. 당시 첨부 SHA 일치·차단 복구·임시 배포 삭제를 확인했고 이후 GET404 원인은 불명이다. 재생성·정리하지 않는다.
- 이미 사용한 real-pilot 키를 새 발송에 재사용하지 않는다. 현재 작업은 새로운 실제 발송 승인이 아니다.

## 남은 순서

1. P2: auto_solved는 기존 ‘요청’ 의미 유지. 실제 해결 결과·확인 시각을 영구 저장하려면 별도 스키마 설계/공유 DB 검토가 필요하다. 현재 새로고침 후 요청true·오류없음은 unknown이며 완료라고 추정하지 않는다.
2. P2: 업무 CC 사용 여부/허용 수신처 결정 후 입력·검증·미리보기·payload·이력·재시도 계약을 함께 구현. 현재 미지원이다.
3. P2: 실제 autoSolve=true·일괄 UI 전 과정은 승인된 시험 범위/수신처/시간에 별도 검증. 현재는 mock/handler와 발송 없는 실제 API 검증이다.
4. P3: 회사메일 추적, 보존 기간, 티켓 정리, 상시 실제 발송 활성화는 별도 판단. 임의 재발송·삭제·활성화하지 않는다.

## 근거

- 현재: `test-results/followup-outcomes-20261021/`의 local-verification.json, focused-tests.log, preview-runtime.json, production-runtime.json, release.json.
- HTML: 기존 followup-validation-2026-10-16/review.html의 `#followup-outcomes-20261021`. 이전 섹션은 당시 기록이다.
- 앞선 필드/발송: `test-results/zendesk-field-contract-20261021/`, `test-results/real-send-20261020/`, `test-results/gmail-send-20261021/`.
