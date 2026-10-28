# 점검 일정 Google 읽기 연결 설정

2026-10-28 기준. 이번 연결은 예정 일정 조회용이다. 원본 셀·서식·완료 여부를 쓰는 기능, 고객 발송, 예약 알림은 포함하지 않는다. 먼저 기존 `check-server-site`의 **Preview → `codex/preview-sandbox`** 범위에만 설정하고 실제 조회를 검증한다.

## 준비할 값

| 환경변수 | 넣을 값 | 범위 |
|---|---|---|
| `GOOGLE_SHEETS_CLIENT_EMAIL` | 서비스 계정 JSON의 `client_email` | 서버 전용 |
| `GOOGLE_SHEETS_PRIVATE_KEY` | 같은 JSON의 `private_key` 전체. BEGIN/END 줄 포함 | 서버 전용 비밀값 |
| `SCHEDULE_MIN_ROLE` | `admin` 기본값. 팀 전체 일정의 operator 열람을 승인한 경우에만 `operator` | 서버 권한 정책 |

`NEXT_PUBLIC_` 접두사를 붙이지 않는다. JSON 파일 전체·개인키·접근 토큰을 채팅, Git, HTML 보고서, 브라우저 입력 예시에 넣지 않는다. 값은 [기존 Vercel 프로젝트 환경변수 화면](https://vercel.com/chpark425-3494s-projects/check-server-site/settings/environment-variables)에 직접 등록한다. 역할 설정은 사이트 접근 정책이며 Google 파일의 공유 권한과 별개다.

대상 파일은 [오피스키퍼 정기점검 시트](https://docs.google.com/spreadsheets/d/1nrcMefriNnjcizsrhXGYKHbZhkRHT6VR1j-V7f_d7xY/edit?gid=1027882150#gid=1027882150)다. 파일 ID와 탭 ID `1027882150`은 서버에서 고정하며 URL 입력으로 다른 파일을 읽지 않는다.

## 기존 서비스 계정이 없을 때

1. 회사에서 사용할 Google Cloud 프로젝트를 선택한다. [Google Sheets API 사용 설정](https://console.cloud.google.com/flows/enableapi?apiid=sheets.googleapis.com)을 연다. Google API는 사용하는 프로젝트에서 먼저 활성화해야 한다. [Google 공식 시작 안내](https://developers.google.com/workspace/sheets/api/quickstart/nodejs)
2. [IAM 및 관리자 → 서비스 계정](https://console.cloud.google.com/iam-admin/serviceaccounts)에서 전용 계정을 만든다. 이 기능을 위해 Cloud 프로젝트 Owner/Editor나 Workspace 관리자 역할을 부여할 필요는 없다. 파일 공유는 Cloud IAM 역할과 별도로 설정한다. [Google 자격증명 안내](https://developers.google.com/workspace/guides/create-credentials)
3. 조직에서 허용하는 경우, 해당 계정의 **키 → 키 추가 → 새 키 만들기 → JSON**으로 키를 내려받아 회사에서 승인한 비공개 위치에 보관한다. JSON의 `client_email`과 `private_key`만 위 환경변수에 사용한다. 개인키를 다시 내려받을 수 없으므로 키를 재발급해야 하는 상황과 기존 키 폐기 순서를 구분한다. [Google 키 관리 안내](https://docs.cloud.google.com/iam/docs/keys-create-delete)
4. 원본 시트의 **공유**에서 서비스 계정 이메일을 추가하고 **뷰어**로 지정한다. ‘사용자에게 알림’은 해제한다. 일반 액세스는 기존 제한 상태를 유지한다. 직접 파일 공유 방식에는 도메인 전체 위임이 필요하지 않다. [Google 파일 직접 공유 안내](https://developers.google.com/workspace/guides/create-credentials#access_google_workspace_files_directly_with_a_service_account)
5. Vercel에서 두 Google 환경변수를 **Preview**로 선택하고 브랜치를 `codex/preview-sandbox`로 지정한다. 값 저장 뒤 새 Preview 배포가 필요하다. 등록 완료만 알려주면 실제 읽기 검증을 이어갈 수 있다.

같은 이름의 기존 회사 서비스 계정과 키가 있다면 생성 단계를 반복하지 않고 해당 계정의 용도·접근 범위를 확인한 뒤 사용한다.

## 개인키 붙여넣기

`private_key`의 값만 사용한다. JSON 필드 이름과 둘러싼 따옴표·쉼표는 넣지 않는다. 실제 줄바꿈이 있는 PEM을 권장하며, 구현은 JSON에 나타나는 `\n` 형태도 실제 줄바꿈으로 복원한다. 개인키 앞뒤의 BEGIN/END 표식을 자르거나 앞부분만 복사하면 인증되지 않는다.

코드는 서버에서 RS256 JWT로 짧은 수명의 OAuth 접근 토큰을 요청한다. 범위는 `https://www.googleapis.com/auth/spreadsheets.readonly`만 사용하고 개인 사용자 사칭용 `sub`는 지정하지 않는다. 토큰 교환 POST는 인증 요청이며 Sheet 수정 요청이 아니다. [Google 서버 간 OAuth 절차](https://developers.google.com/identity/protocols/oauth2/service-account)

## 공유 또는 키 생성이 막힐 때

- **서비스 계정 공유 불가:** 회사의 외부 공유 정책을 확인한다. 파일을 ‘링크가 있는 모든 사용자’로 공개하거나 조직 정책을 임의로 완화하지 않는다. 조직 계정의 외부 공유는 관리자가 제한할 수 있다. [Google 공유 권한 안내](https://support.google.com/drive/answer/7166529)
- **키 생성 비활성:** 회사 관리자에게 승인된 인증 방식을 확인한다. 조직 정책을 우회하거나 개인 계정의 Cloud 프로젝트로 옮기지 않는다.
- **회사 OAuth 방식 필요:** 회사 계정 동의와 서버 측 토큰 보관·갱신을 갖춘 별도 OAuth 연결을 설계한다. 현재 서비스 계정 환경변수에 OAuth Client ID/Secret을 넣으면 동작하지 않는다. Drive 전체 접근 범위나 도메인 전체 위임을 임시 해결책으로 추가하지 않는다.

읽기 scope는 **파일 단위**로 작동하며 한 탭에만 권한을 제한하는 scope는 없다. 이 앱은 대상 파일·탭을 고정하고 필요한 열만 응답하도록 제한한다. 서비스 계정에는 필요한 해당 파일만 공유하는 것이 적절하다. [Sheets API 범위 안내](https://developers.google.com/workspace/sheets/api/scopes)

## 설정 후 검증

1. Preview의 ‘점검 일정’에 접속해 ‘설정 필요’가 사라지고 실제 조회 시각과 원본 탭명이 표시되는지 확인한다.
2. 7일·30일·기간 지정·검색·분류·페이지를 비교한다. 건수는 예정 기록 수이며 자동 실행 가능 건수가 아니다.
3. 원본의 K는 대략 예정일, O는 사후 수행자, X/x는 미실시·보류로 유지되는지 확인한다. 협력사 기록을 자사 실행 대상으로 바꾸지 않는다.
4. 관리자·operator·viewer의 실제 권한을 설정한 정책과 비교한다. Google 공유 변경이 사이트 사용자의 권한을 자동 확대하지 않아야 한다.
5. 동기화 실패·권한 해제·필수 열 변경 시 메시지와 자료 보존/제거 동작을 확인한다. 마지막 성공 시각과 현재 조회 성공을 구분한다.

연결 완료 여부는 실제 API 조회를 통해 확인한다. 비밀키를 등록했다는 사실이나 합성 화면이 보인다는 사실만으로 실연동 완료라고 표시하지 않는다. 운영 일정 탭 반영과 Production Google 값 등록은 Preview 검증 이후의 별도 단계다.
