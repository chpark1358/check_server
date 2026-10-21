# 현재 작업 상태 — 2026-10-21

마지막 확인: 2026-10-21 09:00 KST. 실제 API 시험과 차단 복구는 완료했고 메일함 확인은 대기 중이다.

## 현재 운영 상태

- 운영 main·앱 소스는 `106ff48b00d63717b9770c44285dbcbc135cf30f` 그대로다. 이번 시험에 소스 수정·Git push는 없다.
- 운영 배포는 `dpl_DQtGjt6oaUeg82xkUUjf34S7c12e`(DQt)로 복귀했다. 운영 별칭 3개·Production pointer 일치, autoAssignCustomDomains=true.
- 프로젝트 `ALLOW_REAL_ZENDESK_SEND=false`, 복구 health200·`dry-run`, OAuth 요청/발급 범위 `read`·조회 ready를 확인했다.
- 임시 허용 배포 `dpl_o5UJ3Qw5X7AWMLdjceaE9HchkH53`는 삭제했다. 고유 URL은404·DEPLOYMENT_NOT_FOUND다.
- 단독 사용 확인으로 별도 서버 가드 개발은 생략했다. 한 건 발송뿐 아니라 운영 임시 변경·재배포·복구·임시 배포 삭제까지 명시 승인받아 앞선 승인 거절·MFA 대기를 해소했다.

## 실제 시험 결과

- 10/21 08:51–09:00 KST, 로그인한 관리자 세션에서 기존 Production의 보호된 업로드·티켓 API를 사용했다.
- 수신처 `chpark@jiran.com`, 실제 티켓1건 [#70715](https://jiransoft.zendesk.com/agent/tickets/70715), 합성PDF1개, CC·followers0, autoSolve=false.
- 업로드201·66,266 bytes, 티켓201·dryRun=false(6.871초), 같은 키 재시도200·duplicate=true·같은70715(4.909초). 각1회 표본이다.
- 사용한 키: `real-pilot-20261020-01-7a607343`. 해당 키 이력은 success1건·첨부1개·autoSolved=false이며 전체 이력44→45다.
- Zendesk 인증은 서버 client_credentials가 쓰기 scope를 자동 발급했다. 브라우저 MFA는 관리·감사 조회용 별도 세션이며 매번 발송에 수동 Zendesk 로그인이 필요한 것은 아니다.
- 조직·그룹·담당자는 명시한 요청과 일치했다. 조직 생략 자동 할당 실험은 아니며, 폼·브랜드·체크박스는 요청 미지정 기본값을 실제 티켓에서 확인했다.
- 티켓은 open·댓글1·첨부1이다. 요청자·내부조직·그룹·담당자·폼·브랜드가 계획과 일치했다.
- 조회한 감사2개에서 요청자 대상 Notification1건과 API 규칙54868772391321을 확인했다. 모든 독립 연동·미래 자동화가 없다는 보장은 아니다.
- 조건부 webhook 체크박스23001254138905는 실제false, 나머지 확인한 점검자 필드는null이었다. 이번 티켓의 초기값 확인이다.
- Zendesk 댓글의 PDF를 GET200으로 다시 받아 원본SHA와 일치했다: `0c9459403fc006dafa65fe235b9696d8b3e2faa448600d3db8125893b6412749`.
- 사용자 메일함의 실제 수신·본문·PDF 열기 확인은 이미 요청했으며 답변 대기다. Notification·Zendesk 첨부 확인을 메일함 확인으로 대신하지 않는다.

## 범위와 남은 항목

- UI 메일 버튼·일괄 발송·autoSolve=true 전 과정을 검증한 것은 아니다. 기존 모의68개는 이번에 다시 실행하지 않았다.
- 티켓은 open으로 보존하며 해결·삭제하지 않았다. 이후 실제 발송은 다시 차단됐고 영구 업무 발송 활성은 별도 결정이다.
- 사용한 키로 새 발송을 만들거나 다른 키로 재전송하지 않는다. 추가 티켓·실제 고객 자료는 이번 범위에 없다.
- 실제 원격 변경: 합성PDF 업로드1회·티켓 생성1건·같은 키 중복 확인1회, 관련 DB/감사 기록, 임시 설정·같은 소스 재배포 및 차단 복구.

## 다음 3단계

1. 이미 요청한 사용자 메일함·PDF 확인 답변을 받는다. 같은 질문이나 발송을 반복하지 않는다.
2. 확인 결과만 이 요약과 보고서에 반영한다. 현재false·dry-run 차단 상태는 유지한다.
3. 시험 티켓 정리, 실제 자동 해결·업무CC·보존 정책 및 영구 발송 활성은 각각 필요한 범위로 별도 판단한다.

## 근거

- `test-results/real-send-20261020/`: `send-result21.json`, `duplicate-result21.json`, `ticket-read21.json`, `attachment-verification21.json`, `restored-runtime21.json`, `restoration-metadata.json`, `temporary-url-check.json`.
- 상세 최신 결과: `docs/REAL_SEND_PREPARATION_2026-10-20.md`, `docs/PRODUCTION_SETUP_CHECKLIST_2026-10-16.md`.
- 보고서: `review.html#real-send-validation-20261021`; 같은 보고서 폴더의 `real-send-validation-2026-10-21/summary.json`이 안전한 결과 요약이다.
