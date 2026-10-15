# Zendesk OAuth 전환 안내

2026-10-15 · 배포 브랜치 `codex/preview-sandbox` · 운영 배포 전 검토용

사용자는 기존 원격 브랜치 `codex/preview-sandbox`에 이번 변경을 반영하도록 선택했다. UI 작업 브랜치의 커밋 `bed92c0`을 병합하며, 기존 OS 표시·문서 템플릿 기능을 유지한다. OAuth 두 변수는 이 기존 Preview 브랜치 범위에 등록되어 있으며 다른 브랜치로 복사하지 않는다. 운영 `main`에는 반영하지 않는다.

## 현재 상태

공유 업무 계정 구조를 유지하는 OAuth client credentials 인증을 구현했다. 관리자 화면 진입 시 자동 인증과 기능별 조회 검증을 수행한다. 사용자별 Zendesk 로그인 방식은 이번 구현 범위가 아니다. 기존 운영 배포, API 토큰, 계정 권한을 변경하거나 폐기하지 않았다.

초기 진단 정정: 사용자가 `codex/preview-sandbox` Preview 범위에 두 값을 등록했고 Confidential 설정을 확인했다. 당시 CLI env pull은 실제 비밀 대신 보호 표시값을 반환했다. 이 표시값으로 수행한 요청의 HTTP 401 `invalid_client`는 실제 등록 자격의 유효성을 판단하는 근거가 아니었다. 이후 배포된 프리뷰의 인증된 관리자 화면에서 실제 계정 연결을 확인했다. 비밀값은 출력·복사하지 않았고 임시 환경 파일은 삭제했다.

## 배포·실연결 상태

- 배포 브랜치는 `codex/preview-sandbox`이며 실제 로그인과 연결 검사는 해당 Preview의 `/`에서 수행한다. `/ui-preview`의 응답은 가상 데이터이므로 실제 OAuth 검증에 사용하지 않는다.
- 2026-10-15 실제 로그인 후 커밋 `131b2c1`의 자동 진단에서 공유 업무 계정의 admin 인증, 그룹·조직명 검색·수신자·티켓 필드 조회 성공을 확인했다.
- 같은 토큰으로 통합 검색 `/api/v2/search.json`을 쓰는 시리얼 조직 검색·티켓 이력 조회만 403이 재현됐다. 인증 실패나 전체 계정 권한 부족이 아닌, 통합 검색 접근 범위 문제로 좁혔다.
- 이 재현에 따라 요청 범위를 `read`로 변경했다. 커밋 `23cfa54` Preview에서 자동 인증 및 6개 조회 기능 모두 성공했다. 실제 조직명 검색 7개 결과, 해당 조직의 수신자 후보 17개와 오류 없음도 UI에서 확인했다.
- 고정 검증 주소: https://check-server-site-git-codex-pre-778fb5-chpark425-3494s-projects.vercel.app/ . 새로고침과 동일 주소 재방문 시 앱 로그인 세션 유지도 확인했다. 배포마다 다른 고유 URL은 브라우저 저장소를 공유하지 않는다.

## 인증 동작

- Zendesk **Ticketing**의 confidential OAuth client를 사용한다.
- 서버가 `POST https://{subdomain}.zendesk.com/oauth/tokens`에 `client_credentials`, Identifier, Secret, 범위, `expires_in=1800`을 보낸다.
- 업무 API에는 `Authorization: Bearer`를 사용한다. 기존 `ZENDESK_API_TOKEN`과 `ZENDESK_EMAIL`은 인증에 사용하지 않는다.
- Refresh token이나 브라우저 승인 콜백을 사용하지 않는다. 만료 60초 전부터 같은 클라이언트 자격으로 새 access token을 받는다.
- 토큰은 서버 인스턴스 메모리에만 보관한다. 같은 인스턴스의 동시 발급 요청을 합치고, 설정 변경 시 캐시를 무효화한다. 서버리스 인스턴스 간 캐시는 공유하지 않으므로 실제 운영 전 토큰 발급 빈도·제한을 관찰해야 한다.
- GET/HEAD의 401은 토큰 재발급 후 한 번만 재시도한다. 티켓·업로드·수정 POST/PUT은 자동 재시도하지 않는다. 기존 불확정 발송 보호와 중복 방지 키를 유지한다.
- 토큰 발급 오류 본문·비밀값을 로그나 화면에 반환하지 않는다. 일반 조회가 가능한 `app_settings`에도 저장하지 않는다.

## Zendesk에서 준비할 값

1. 기존 연동의 업무 주체로 사용할 Zendesk 계정으로 **Admin Center → Apps and integrations → APIs → OAuth clients**에서 등록한다.
2. 예시 Name: `Check Server Preview`, Identifier: `check_server_preview`. Client kind는 **Confidential**이다. Identifier 문자열이 `CLIENT_ID`이며 숫자 리소스 ID가 아니다.
3. OAuth client의 소유 계정이 이 방식의 실제 API 행위자가 된다. 다른 관리자가 등록하면 기존 공유 계정과 다른 권한·감사 주체가 될 수 있다. 기존 업무 계정이 클라이언트 소유자가 될 수 없거나, 개인별 권한을 적용해야 한다면 Authorization Code 방식으로 설계를 변경해야 한다.
4. Preview 검증용 allowed scopes는 아래 조회 범위를 허용한다. 기존의 개별 리소스 조회 범위는 유효하지만, 실제 계정의 통합 검색에서 403이 발생했다. `read`는 공식적으로 모든 GET 조회를 포함하며 쓰기를 허용하지 않는다. 클라이언트에 Allowed scopes 제한이 설정되어 있고 `read`가 빠져 있으면 새 토큰 발급 시 `invalid_scope`가 반환되므로 해당 클라이언트 설정을 확인한다.

```text
read
```

5. 운영용 클라이언트는 티켓·첨부 전송을 위해 아래 범위가 추가로 필요하다. 운영 승격 전 해당 엔드포인트별 권한 검증이 필요하다.

```text
tickets:write ticket_attachments:write
```

6. Secret은 등록 시 안전하게 보관한다. 이 grant는 `redirect_uri`를 요청하지 않으며 애플리케이션 OAuth callback route도 없다. 관리 화면에서 Redirect URLs 입력을 요구하면 본인 소유 앱 URL을 등록할 수 있으나, 이 코드가 승인 콜백을 처리한다는 의미는 아니다.

클라이언트 소유 계정이 삭제되거나 필요한 관리 권한을 잃으면 client-credentials 토큰도 작동하지 않는다. 고정 티켓 담당자 설정만으로 OAuth 행위자 자체가 변경되지는 않는다.

## Vercel 설정과 검증

비밀값을 채팅·문서·브라우저 코드에 붙이지 말고 Vercel 프로젝트의 Environment Variables에 직접 입력한다. **Preview** 범위의 `codex/preview-sandbox` 브랜치에 적용한다.

| 환경변수 | 값 |
|---|---|
| `ZENDESK_SUBDOMAIN` | 기존 Zendesk 서브도메인만. URL·`.zendesk.com` 접미사 제외 |
| `ZENDESK_OAUTH_CLIENT_ID` | 등록한 Identifier |
| `ZENDESK_OAUTH_CLIENT_SECRET` | 서버 전용 Secret |
| `ZENDESK_FIXED_ASSIGNEE_EMAIL` | 기존 발송 담당자 이메일 또는 DB의 명시적 담당자 설정 유지 |

환경변수 저장 후 새 Preview 배포가 필요하다. 기존 배포에는 새 환경변수가 소급 적용되지 않는다.

1. Preview의 `/`에서 실제 앱 관리자 계정으로 로그인한다.
2. 관리자 화면의 **Zendesk OAuth 연결**에서 자동 인증 결과와 6개 기능의 조회 상태를 확인한다. `다시 확인`은 재검증 버튼이며 최초 인증을 위한 필수 조작이 아니다.
3. 연결 검사는 `/users/me.json` 뒤에 그룹, 조직명 검색, 시리얼 기반 조직 검색, 수신자, 최근 티켓 이력, 티켓 필드를 각각 조회한다. 일부 실패는 전체 연결 정상으로 표시하지 않는다. 권한 범위 상세에서 요청 범위와 실제 토큰 응답 범위를 구분한다.
4. Preview는 `ALLOW_REAL_ZENDESK_SEND`와 관계없이 실제 티켓/파일 업로드를 차단하며 OAuth도 조회 범위만 요청한다. 실제 쓰기 검증은 별도 Zendesk 샌드박스 또는 승인된 운영 검증 절차로 수행한다.
5. `/ui-preview`는 가상 UI이다. OAuth 연결 확인 버튼도 가상 응답이며 실연결 검증으로 해석하지 않는다.
6. 기존 API 토큰의 폐기는 운영 OAuth 전환·검증이 끝난 후 별도 진행한다. 이번 작업에서 기존 토큰을 삭제하지 않는다.

## 검증

OAuth 회귀 테스트는 16개다. 초기 UI 구현의 57개 전체 테스트에 이어, 자동 기능 진단 등을 포함한 `131b2c1` 검증에서 전체 82개 테스트가 통과했다. `read` 범위 수정의 실제 배포 검증 결과는 후속 작업 기록에서 확인한다.

`tests/zendesk-oauth.test.mjs`는 실제 모듈을 모의 네트워크로 실행해 설정 격리, 토큰 교환/캐시/만료/동시 요청/교체, 범위 변경 시 재발급, Preview `read` 전용·운영 쓰기 허용 목록, 민감 오류 차단, 401 제한 재시도, 쓰기 재전송 금지, 관리자 접근 통제, 기능별 부분 성공, 수신자 조회와 추천 이력 장애 분리를 검사한다. 실제 Zendesk 클라이언트·권한 검증과 구분한다.

```powershell
node --test tests/*.test.mjs
npm run lint
npm run typecheck
npm run build
```

## 공식 근거

- [Grant type별 토큰 API](https://developer.zendesk.com/api-reference/ticketing/oauth/grant_type_tokens/): client credentials, 요청 형식, 만료·범위.
- [OAuth 클라이언트 등록과 소유자 영향](https://support.zendesk.com/hc/en-us/articles/4408845965210-Using-OAuth-authentication-with-your-application): confidential client, Identifier, client 소유자 권한.
- [OAuth 전환 안내](https://developer.zendesk.com/documentation/authentication/oauth-migration/): 방식 선택과 전환 절차.

단일 공유 업무 계정과 서버 전용 비밀 관리가 가능한 현재 구조에서 client credentials를 선택한 것은 이 프로젝트에 대한 구현 판단이다.
