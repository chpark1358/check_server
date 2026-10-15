# Zendesk OAuth 전환 안내

2026-10-15 · `codex/ui-preview-20261015` · 운영 배포 전 검토용

## 현재 상태

공유 업무 계정 구조를 유지하는 전제로 OAuth client credentials 인증 코드를 구현했다. 사용자별 Zendesk 로그인 방식은 이번 구현 범위가 아니다. 실제 OAuth 클라이언트의 ID/Secret 등록과 계정·권한 검증은 아직 수행하지 않았다. 기존 운영 배포, API 토큰, 계정 권한을 변경하거나 폐기하지 않았다.

## 배포·실연결 상태

- Preview UI: https://check-server-site-4b3v1uuvj-chpark425-3494s-projects.vercel.app/ui-preview
- Vercel 배포: `dpl_3HxRHxjxy7M4XXFrwQ7poz9j196C`, Preview READY. 배포 페이지를 재조회하지 않고 CLI 결과로 완료를 확인했다.
- 실제 로그인과 연결 검사는 같은 배포의 `/`에서 수행한다. 가상 UI는 실제 OAuth 연결 증거가 아니다.
- Vercel Preview 환경변수 이름 목록에서 새 Client ID/Secret 미등록을 확인했다. 비밀값 조회·환경 변경은 수행하지 않았다. 새 Preview에서는 등록 전까지 실제 Zendesk 조회가 OAuth 미설정 오류로 차단되며 운영 사이트는 기존 배포를 유지한다.

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
4. Preview 검증용 allowed scopes는 아래 조회 범위를 사용한다.

```text
groups:read organizations:read users:read account_settings:read tickets:read
```

5. 운영용 클라이언트는 티켓·첨부 전송을 위해 아래 범위가 추가로 필요하다. 운영 승격 전 해당 엔드포인트별 권한 검증이 필요하다.

```text
tickets:write ticket_attachments:write
```

6. Secret은 등록 시 안전하게 보관한다. 이 grant는 `redirect_uri`를 요청하지 않으며 애플리케이션 OAuth callback route도 없다. 관리 화면에서 Redirect URLs 입력을 요구하면 본인 소유 앱 URL을 등록할 수 있으나, 이 코드가 승인 콜백을 처리한다는 의미는 아니다.

클라이언트 소유 계정이 삭제되거나 필요한 관리 권한을 잃으면 client-credentials 토큰도 작동하지 않는다. 고정 티켓 담당자 설정만으로 OAuth 행위자 자체가 변경되지는 않는다.

## Vercel 설정과 검증

비밀값을 채팅·문서·브라우저 코드에 붙이지 말고 Vercel 프로젝트의 Environment Variables에 직접 입력한다. 먼저 **Preview** 범위와 이 작업 브랜치에만 적용한다.

| 환경변수 | 값 |
|---|---|
| `ZENDESK_SUBDOMAIN` | 기존 Zendesk 서브도메인만. URL·`.zendesk.com` 접미사 제외 |
| `ZENDESK_OAUTH_CLIENT_ID` | 등록한 Identifier |
| `ZENDESK_OAUTH_CLIENT_SECRET` | 서버 전용 Secret |
| `ZENDESK_FIXED_ASSIGNEE_EMAIL` | 기존 발송 담당자 이메일 또는 DB의 명시적 담당자 설정 유지 |

환경변수 저장 후 새 Preview 배포가 필요하다. 기존 배포에는 새 환경변수가 소급 적용되지 않는다.

1. Preview의 `/`에서 실제 앱 관리자 계정으로 로그인한다.
2. 관리자 화면에서 **Zendesk OAuth 연결 → 연결 확인**을 실행한다. 설정됨은 인증 성공을 의미하지 않는다. 실제 계정 정보가 표시되어야 연결 검사가 성공한 것이다.
3. 연결 검사는 `/users/me.json` 한 곳의 조회만 확인한다. 조직·고객 담당자·그룹·필드 조회를 각각 검증한다.
4. Preview는 `ALLOW_REAL_ZENDESK_SEND`와 관계없이 실제 티켓/파일 업로드를 차단하며 OAuth도 조회 범위만 요청한다. 실제 쓰기 검증은 별도 Zendesk 샌드박스 또는 승인된 운영 검증 절차로 수행한다.
5. `/ui-preview`는 가상 UI이다. OAuth 연결 확인 버튼도 가상 응답이며 실연결 검증으로 해석하지 않는다.
6. 기존 API 토큰의 폐기는 운영 OAuth 전환·검증이 끝난 후 별도 진행한다. 이번 작업에서 기존 토큰을 삭제하지 않는다.

## 검증

OAuth 테스트 12개를 포함한 전체 57개, lint, typecheck, 로컬 최적화 build 및 Vercel 원격 build가 통과했다. 로컬 브라우저에서는 연결 확인 전/후 가상 상태와 계정 표시를 확인했고 console error/warn은 0개였다. 모바일 390px viewport에서 document scrollWidth=clientWidth=375px로 가로 넘침이 없었다.

`tests/zendesk-oauth.test.mjs`는 실제 모듈을 모의 네트워크로 실행해 설정 격리, 토큰 교환/캐시/만료/동시 요청/교체, 범위 제한, 민감 오류 차단, 401 제한 재시도, 쓰기 재전송 금지, 관리자 접근 통제를 검사한다. 실제 Zendesk 클라이언트·권한 검증과 구분한다.

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
