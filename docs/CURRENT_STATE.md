# 현재 작업 상태 — 2026-10-21

회사메일 시험 뒤 사용자 요청으로 Gmail 한 건을 추가 시험했고 차단 복구까지 완료했다. 회사메일은 사용자가 보이지 않는다고 신고했으며 Gmail 수신함 확인은 아직 미확인이다.

## 운영·승인 범위

- 운영 main·앱 소스 기준은 `106ff48b00d63717b9770c44285dbcbc135cf30f`다. 이 문서 작업은 소스·원격 설정을 바꾸지 않는다.
- 단독 사용 확인으로 새 시험용 서버 가드 개발은 생략했다. 기존 승인된 임시 설정·같은 소스 재배포·한 건 시험·차단 복구 절차를 사용한다.
- 회사메일 시험 후 DQt·flag=false·dry-run 복구와 첫 임시 배포 삭제는 09:00 KST까지 확인했다.
- 이후 사용자가 회사메일이 보이지 않는다며 `chpark425@gmail.com`으로 보내 달라고 명시 요청했다.
- Gmail 시험 후 10:02 KST 운영 별칭3개·Production pointer가 DQt로 복귀했고 autoAssignCustomDomains=true·flag=false를 확인했다. health200·dry-run·설정누락0, OAuth 요청/발급read·조회ready다.
- Gmail 임시 배포 `dpl_7dPbFXhadZ9HG7j1jMGFDrQ7r7Do`는 삭제했고 10:04:32 KST 고유URL404·DEPLOYMENT_NOT_FOUND를 확인했다.
- Zendesk 인증은 서버의 client_credentials 자동 발급이다. 브라우저 MFA는 관리·감사 조회용 별도 세션이었다.

## 회사메일 사례 — #70715

- 수신처 `chpark@jiran.com`, 티켓 [#70715](https://jiransoft.zendesk.com/agent/tickets/70715), 합성 PDF 1개·66,266 bytes, CC/followers 0, autoSolve=false.
- 업로드201·티켓201·dryRun=false(6.871초), 같은 키 재시도200·duplicate=true·같은70715(4.909초)를 각1회 확인했다.
- 키 `real-pilot-20261020-01-7a607343`의 이력은 success1건·첨부1·autoSolved=false다.
- 요청자·조직·그룹·담당자·폼·브랜드가 계획과 일치했다. 체크박스 초기값false와 나머지 확인 필드null도 실제 티켓에서 확인했다.
- 감사의 요청자 Notification은 `63447424905753`이다. Email Notifications API의 delivery_status는 id0/name none/code0이다.
- 사용자가 메일함에서 보이지 않는다고 보고했다. NONE과 사용자 미관측만으로 전송 실패나 전달 완료를 확정하지 않는다.
- 기존 #70715는 후속 Gmail 시험에서 변경하지 않았다.

## Gmail 사례 — #70725

- 수신처 `chpark425@gmail.com`, 티켓 [#70725](https://jiransoft.zendesk.com/agent/tickets/70725), 새 키 `real-pilot-gmail-20261021-01-cdb09f6e`.
- 업로드201·PDF66,266 bytes, 티켓201·7.022초를 확인했다. 실제 티켓 생성 API 호출은1회다.
- 이번에는 중복 재요청0회다. 기존 같은 키 재시도 검증을 반복하지 않았다. 복구 후 전체이력46건 중 Gmail키success1건(#70725), 기존회사키success1건(#70715)을 확인했다.
- 기존 Zendesk end-user `53419663060377`와 조직 `54865721619353`(점검_test, shared=false·구독0)이 실제 티켓과 일치했다.
- 댓글1·PDF1·CC/followers0·open·autoSolve=false다. 감사 Notification `63449596897433`의 수신자는 Gmail 요청자1명이다.
- 공식 Email Notifications API에서 실제 email_address가 Gmail 주소이며 delivery_status는 id0/name none/code0, 실패 응답은 없었다. 수신함 도착을 증명하지는 않는다.
- 사용자 Gmail 수신·본문·첨부 PDF 열기는 아직 확인되지 않았다.

## 파일·검증 경계

- 두 시험은 같은 합성 PDF를 사용했다. SHA-256: `0c9459403fc006dafa65fe235b9696d8b3e2faa448600d3db8125893b6412749`.
- 실제 고객 정보·서명은 없다. 두 티켓의 Zendesk 첨부 재다운로드가 모두66,266 bytes·원본SHA와 일치했다. 수신함 첨부를 내려받아 검사한 것은 아니다.
- 앱의 보호된 관리자 API 검증이다. UI 메일 버튼·일괄 발송·autoSolve=true 전체 흐름을 검증한 것은 아니다. 모의68개는 이전 결과다.
- 두 티켓은open으로 보존하며 해결·삭제하지 않았다. 사용한 키를 바꾸어 추가 발송하거나 승인 없이 다시 보내지 않는다.

## 다음 3단계

1. 현재 DQt·false·dry-run 차단 상태를 유지한다. 새 코드·테스트 재실행·중복POST·Git push 없이 시험을 종료했다.
2. 사용자 Gmail 수신·본문·PDF 확인 결과와 두 Notification의 상태를 구분해 기록한다. 실패·배송 완료를 먼저 단정하지 않는다.
3. 티켓 정리·실제 자동 해결·업무CC·보존 정책·영구 발송 활성은 별도 판단한다. 임의 추가 발송은 하지 않는다.

## 근거

- 회사메일: `test-results/real-send-20261020/`의 생성·중복·티켓·첨부·차단 복구 JSON.
- Gmail: `test-results/gmail-send-20261021/`의 `restoration-metadata.json`, `gmail-restored-runtime.json`, `temporary-url-check.json`, `attachment-verification.json`. 시간은KST(+9)로 표기했다.
- 상세 준비 기록: `docs/REAL_SEND_PREPARATION_2026-10-20.md`. 현재 결과는 이 요약을 우선한다.
