# 현재 작업 상태 — 2026-10-21

사용자가 Gmail 메일 수신을 확인했다. 첨부 PDF를 열어 봤다는 명시 확인은 없다. 이후 점검 자동화 체크를 항상 적용하는 보완을 main·Preview·Production에 반영했으며 실제 발송은 계속 차단한다.

## 현재 배포·검증

- 운영 main·앱 소스: `ab0c49ce49b6dada887c30f2a167604122064b7e`.
- Production: `dpl_3QXz6w8MuFBcV3Sbma6UCyeK6P7B`. 운영 주소는 `https://check-server-site.vercel.app/`이다.
- Preview: `dpl_DTNSm8qXMkknFCCDjLUNKTHVQmVp`.
- 고정 Preview가 이전 F1에 남아 있어 DTNS로 갱신했고, 보조 운영 주소도 이전 DQt에서 새3Q 배포로 동기화했다. 10:33 KST 운영 주소 3개와 고정 Preview의 배포 ID·Ready 상태·운영 소스 SHA 대조를 완료했다.
- 실제 Production health200·production·dry-run을 확인했다. 이번 필드 보완 단계의 추가 업로드·실제 티켓POST·메일은0이며 preview API 감사 기록만 추가됐다.
- 집중 테스트70/70·대상lint·타입검사 통과. Preview/Production에서 각각 autoSolve=false/true 2사례(총4사례)의 실제 티켓 preview API가200·dryRunOnly·marker=true를 반환했다.
- 직전 DQt/106ff48 배포는 복귀용으로 보존한다. 원복하면 이번 체크 보완은 포함되지 않는다.
- 과거 `test-results/real-send-20261020/activate-test.ps1`과 `test-results/gmail-send-20261021/activate-test.ps1`은 구버전 DQt/106ff48을 재배포하므로 새 시험에 그대로 재사용하지 않는다. 이후 시험은 새 운영3Q/ab0c49c를 기준으로 한다.

## 필드 계약

- 점검 자동화 체크 `58864476958489`: 최종 필드 병합 뒤 항상true, 같은ID는1개만 남기고 false 덮어쓰기를 막는다.
- 이전에는 autoSolve=true일 때만 체크가 들어갔다. 이제 autoSolve는 실제 해결PUT 요청 여부만 제어한다.
- 문의제품 `32000684227225`의 실제 제목은 ‘문의제품(구)’이며 multiselect 값 `['오피스키퍼_구축형.']`를 그대로 유지한다.
- 분류 `31991461954201`의 값 `['정기점검']`도 그대로 유지한다.
- 새 체크 보완은 모의검사와 실제 preview API로 확인했다. 이를 확인하기 위한 새 티켓 생성·실발송은 하지 않았다.

## 앞선 실제 발송 두 사례

- 회사메일: `chpark@jiran.com`, #70715, 키 `real-pilot-20261020-01-7a607343`. 업로드201·티켓201·같은키재시도200/duplicate=true·같은티켓을 확인했다.
- 회사메일은 사용자가 보이지 않는다고 신고했다. 당시 Email Notifications API는 delivery_status id0/name none/code0이었다. 실패 확정이나 전달 완료로 단정하지 않는다.
- Gmail: 사용자 요청으로 `chpark425@gmail.com`에 #70725를1건 생성했다. 키 `real-pilot-gmail-20261021-01-cdb09f6e`, 업로드201·티켓201, 생성API1회·중복재요청0회·해당키success1건이다.
- Gmail은 사용자 “다 왔음” 답변으로 메일 수신을 확인했다. 당시 알림 API의 NONE보다 사용자 수신 확인을 별도 근거로 추가하며, PDF 열기까지 확인됐다고 확대하지 않는다.
- 두 사례는 합성 PDF1개·66,266 bytes, CC/followers0·autoSolve=false였고 당시 댓글1·첨부1을 확인했다.
- 두 Zendesk 첨부 재다운로드는 원본SHA와 일치했다: `0c9459403fc006dafa65fe235b9696d8b3e2faa448600d3db8125893b6412749`.
- Gmail 시험 후 운영DQt·flag=false·dry-run·OAuthread로 복구했고 임시배포 삭제/고유URL404를 확인했다. 그 뒤 현재ab0c49c 필드 보완을 배포했다.
- 이번 #70715·#70725 조회는 모두GET404였다. 이유는 확인되지 않았으며 기존 티켓을 이번에 수정·해결·삭제하지 않았다.

## 경계와 다음 작업

- 앱의 관리자 보호API 시험이었다. UI메일버튼·일괄발송·실제autoSolve=true의 전 과정을 검증한 것은 아니다.
- Zendesk 인증은 서버client_credentials로 자동 처리한다. 브라우저MFA는 관리·감사 확인용 별도 세션이었다.
- 단독 사용 확인에 따라 별도 서버 가드 개발은 생략했다. 사용한 키로 추가 발송을 만들거나 다른 키로 임의 재전송하지 않는다.

1. 새3Q/DTNS 배포의 최종 별칭·소스 메타데이터 확인 결과를 반영한다. dry-run 차단을 유지한다.
2. Gmail 수신 확인과 별개로 첨부PDF 열기, 회사메일 미관측 원인은 필요할 때 별도 확인한다. 이미 보낸 메일을 반복 전송하지 않는다.
3. 업무CC(현재미구현), 실제 자동 해결, 보존 정책·티켓 정리·영구 발송 활성은 각각 별도 판단한다.

## 관련 근거

- 현재 필드 보완 결과: 적용커밋 `ab0c49ce49b6dada887c30f2a167604122064b7e`와 이번70개·배포preview API검증. 최종 배포 근거 파일은 확인 후 갱신한다.
- 앞선 회사메일: `test-results/real-send-20261020/`의 생성·중복·첨부·복구 JSON.
- 앞선 Gmail: `test-results/gmail-send-20261021/`의 `gmail-restored-runtime.json`, `restoration-metadata.json`, `temporary-url-check.json`, `attachment-verification.json`.
- 상세 준비 기록: `docs/REAL_SEND_PREPARATION_2026-10-20.md`. 현재 결과는 이 요약을 우선한다.
