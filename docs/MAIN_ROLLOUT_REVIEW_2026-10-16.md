# main 반영 사전 검토 — 2026-10-16

## 판정과 범위

**현재는 전체 기능을 즉시 운영에 전환하지 않는 것이 맞다.** main 소스 백업과 Git 복원 시험, Preview 검색 최적화 실측은 완료했다. 그래도 운영 OAuth 설정, 실발송 통제, 이석진 서명 등록, 복구 준비가 남는다. 이 조건을 해결하면 단계적인 운영 전환은 가능하다.

검색 함수 3개의 실행 위치를 `iad1`에서 DB와 가까운 `sin1`으로 변경한 `8002d98`에서 전후 각 76회가 모두 성공했다. 시나리오별 반복 요청 18회 중앙값은 84.15–87.74% 감소했고, 변경 후 관리자·비로그인·소유 문서/RLS 검사 11개도 통과했다. 실제 최대 동시 요청은 변경 전 3개, 변경 후 1개로 동시 사용자 4명의 처리량 검증은 아니다. `vercel.json` 설정을 main에 반영하면 Production의 같은 검색 함수 3개에도 적용되지만 **현재 운영 배포는 변경하지 않았다**.

이 검토에서는 main 병합·push·배포·태그 생성, 운영 환경변수 변경, DB·Storage 데이터 내보내기를 수행하지 않았다. 사용자 요청은 “백업하고 적용해도 될지 검토”다. 실제 전환 전에는 검증된 최종 커밋과 영향 범위를 확정해야 한다.

## 확인한 기준점

| 대상 | 읽기 전용 확인 결과 |
| --- | --- |
| 원격 main | `918cdf8920b022839150fde46f13b66fea5e5ed3` (`git ls-remote`, 2026-10-16) |
| 검토 시작 Preview | `5d251ea0fb3161413ca3870bd4bf86eb010813ca` |
| 검토 시작 시 변경 범위 | `5d251ea`에서 main 이후 19개 커밋, 90개 파일. main은 Preview의 조상. `package.json`·lockfile 차이 없음 |
| 검색 최적화 실측 | 기준선 `b899d5b` → 최적화 `8002d98`, 전후 각 76회 성공, 응답 계측 region `iad1` → `sin1` 확인 |
| 현재 Production | `dpl_H35D8epHPPR46Ryo72KhXm2iHFmF`, Ready, 2026-07-21 14:37 KST |
| Production 고정 배포 | `https://check-server-site-361voq4nq-chpark425-3494s-projects.vercel.app` |
| 운영 별칭 | `https://check-server-site.vercel.app` 및 프로젝트·main 별칭 |
| 배포↔커밋 일치 | CLI inspect JSON에 Git commit SHA/ref가 없어 현재 Production이 위 main SHA의 빌드인지는 **미확인** |

`vercel list --environment production`, `vercel inspect`, `vercel env ls production`으로 배포 상태와 변수 등록 범위를 읽었다. env pull은 사용하지 않았다. OAuth·서비스 키 등의 비밀값을 추출하거나 문서에 보관하지 않았다.

## 운영 전환 조건

| 우선순위 | 확인한 문제 | 전환 전에 필요한 조치 |
| --- | --- | --- |
| P0 | Production 변수 목록에 `ZENDESK_OAUTH_CLIENT_ID`, `ZENDESK_OAUTH_CLIENT_SECRET`가 없다. 현 main은 API token 방식, 새 코드는 OAuth만 사용한다 | 운영 범위에 Identifier·Secret을 등록하고 해당 빌드에서 자동 연결과 6개 조회 기능 확인. Preview 브랜치 변수는 자동 승계되지 않는다 |
| P0 | 현재 프로젝트 Production 설정의 `ALLOW_REAL_ZENDESK_SEND`는 활성이다 | 첫 운영 빌드는 발송 차단 상태로 준비한다. 현재 운영 업무에 발송 중단이 생기는 시간도 배포 계획에 포함한다. 승인된 제한 수신처 검증 후에만 실발송 활성화 |
| P0 | 운영 실발송 활성 시 코드가 `read` 외에 `tickets:write`, `ticket_attachments:write`를 요청한다. Preview는 read만 검증했다 | 운영 OAuth 클라이언트가 쓰기 범위를 허용하는지 확인. 티켓·첨부의 실제 외부 쓰기 검증에는 별도 실행 승인과 정해진 테스트 수신처가 필요하다 |
| P0 | main의 기존 발송 이력 API는 service-role 조회에 소유자 조건이 없다 | Preview의 owner/admin 필터를 운영에 반영해야 한다. 전체 전환이 지연되면 이 한 경로의 보안 수정만 별도 검토·검증·승인 후 먼저 반영하는 후보가 적절하다 |
| P1 | 이석진 이미지는 Storage의 `preview/` 경로에 있고 코드 fallback도 Preview 전용이다 | 사용자가 승인한 이미지를 정상 서명 업로드 경로와 메타데이터에 등록하고 Production 문서에 실제 포함되는지 확인. preview 경로의 메타만 옮겨도 새 코드는 제외하므로 정상 업로드 절차가 필요하다 |
| P1 | 실제 operator/viewer 테스트 계정이 없다 | 서로 다른 소유 문서·이력, 역할 변경/로그아웃 후 세션, 직접 API 접근을 두 계정으로 검증. 현재 자동 테스트와 admin/비로그인 검증을 계정 간 실검증으로 대체 표기하지 않는다 |
| P1 | Supabase 화면에서 `Last backup 12h ago`를 관측했지만 해당 DB 백업의 실제 복구·완전성과 Storage 백업은 확인하지 않았다 | 배포 전 최근 복원점, 보관 기간, 파일 원본의 별도 복사, 복구 담당자와 허용 손실량·복구 시간을 확인한다 |
| P1 | 현재 데이터·한 계정의 검색 최적화 실측은 완료했다. 장시간·대규모·복수 계정 부하 검증은 남았다 | `8002d98`의 실측 결과를 기준으로 운영 목표를 정하고 실제 업무 규모의 검증 범위를 확정한다 |

`ALLOW_REAL_ZENDESK_SEND` 활성 근거는 `vercel env ls production`의 비암호화 boolean 표시다. 이것은 현재 프로젝트 설정의 확인이며, 과거 배포에 고정된 실제 환경까지 다시 읽은 것은 아니다. 범위는 환경변수가 아니라 `src/lib/server/zendesk-oauth.ts`의 허용 목록으로 결정한다.

## 이미 적용된 공유 DB 변경과 old-main 호환성

Preview와 운영은 동일한 Supabase DB를 사용한다. 사용자 승인 후 적용된 보완은 코드 롤백과 함께 사라지지 않는다.

| 변경 | 기존 main과의 호환성 판단 |
| --- | --- |
| `default_agent_status` 기본값 컬럼 | additive 변경. 기존 preference 코드가 필요로 하는 컬럼이며 기존 행을 삭제하지 않음 |
| `202610160001_document_pdf_retry.sql` | nullable claim 컬럼과 claim 변경 보호 trigger. old-main은 이 컬럼을 쓰지 않으며 서버 service-role 작업은 허용 |
| `202610160002_document_access_hardening.sql` | 브라우저 문서 메타 INSERT/UPDATE/DELETE 회수. old-main 생성·첨부 갱신은 `requireRole`이 만든 service-role client를 사용하므로 코드상 호환 |
| 같은 migration의 ticket_sends RLS | 브라우저 직접 읽기는 owner/admin으로 제한. **old-main의 service-role 발송 이력 API에는 RLS가 적용되지 않으므로 타인 이력 차단을 완성하지 못함** |
| `202610160003_profile_self_insert_hardening.sql` | 본인 프로필 INSERT를 viewer로만 제한. old-main 관리자 초대는 service-role로 profile upsert하므로 코드상 호환. 기존 계정 역할은 바뀌지 않음 |

위 판단은 해당 main 커밋의 source inspection 결과이며 실제 운영 사용자로 생성·발송·초대를 실행한 결과가 아니다. 미검증 상태를 숨기기 위해 운영 계정을 만들거나 실제 메일을 보내지 않았다.

특히 main `src/app/api/history/ticket-sends/route.ts:9–17`은 최소 operator 확인 후 전체 `ticket_sends`를 반환한다. Preview 동일 파일 18행의 `auth.role !== "admin"` → `sent_by=auth.user.id` 조건이 보완이다. **기존 배포로 단순 롤백하면 이 기존 취약 경로도 돌아올 수 있다.** 좁은 보안 수정이 포함된 복구용 후보를 별도로 검증하는 편이 낫다.

검토용 diff를 사용자 보고서의 `phase-optimization/main-backup/owner-history-hotfix-review.patch`에 보존했다. 이 patch를 main에 적용하거나 운영 배포한 것은 아니다.

## 백업은 네 층으로 구분

1. **소스:** 위 main SHA를 이름 붙인 로컬 Git bundle과 ZIP으로 보존하고, bundle verify·기록된 ref·SHA-256을 확인한다. 다른 안전한 저장소에 별도 사본이 있어야 PC 장애에도 남는다. Git 백업에는 `.env`, 미추적 파일, 무시된 서명 파일, DB·Storage 원본이 들어가지 않는다.
2. **배포와 설정:** 현재 Production 배포 ID·URL·별칭·가능한 Git SHA를 기록한다. 환경변수는 이름/범위/소유 관리체계만 보고서에 남긴다. 비밀 복구본은 조직의 비밀 관리 저장소에서 관리한다. 현재 배포가 Ready라는 사실만으로 롤백 권한·보관 기간·실제 작동까지 확인된 것은 아니다.
3. **DB:** 공유 DB의 schema·RLS·migration과 최근 복원점을 확인한다. 백업 복원은 다른 운영 기록까지 되돌릴 수 있어 UI 배포 실패의 첫 대응으로 사용하지 않는다. 기존 보안 정책은 원칙적으로 유지한다.
4. **Storage:** 생성 DOCX/PDF, 점검자 서명, 메일 서명 원본은 별도로 보호한다. DB 백업은 Storage 객체 내용까지 포함하지 않으므로 객체 수·크기·검증 해시와 메타데이터 대응을 확인해야 한다. [Supabase 백업 문서](https://supabase.com/docs/guides/platform/backups)

main ref가 위 SHA와 일치하는 상태에서 root가 로컬 소스 백업을 생성했다. `main-918cdf8.bundle`은 660,016바이트이며 complete history 및 ref를 검증했고, 별도 디렉터리로 no-checkout 복원한 HEAD도 원본 SHA와 일치했다. `main-918cdf8.zip`은 300,267바이트다. 앱 실행·DB·Storage 복원을 시험한 것은 아니다.

- bundle SHA-256: `00cede95a41062f76dd78420ff274384f14caad592bc232d9521b3c2cb1e6a4c`
- ZIP SHA-256: `78b9219204dfc2f919290a23cf4c40fa095aa14701a7dffe06d9946efd6ddaf7`
- 백업은 사용자 HTML 보고서의 `phase-optimization/main-backup/` 폴더에 보관했다. Git main ref나 운영 배포는 변경하지 않았다.

재현 명령은 다음과 같다.

```powershell
git bundle create <백업경로>/main-before-rollout-20261016.bundle refs/heads/main
git bundle verify <백업경로>/main-before-rollout-20261016.bundle
git bundle list-heads <백업경로>/main-before-rollout-20261016.bundle
git archive --format=zip --output=<백업경로>/main-918cdf8.zip 918cdf8920b022839150fde46f13b66fea5e5ed3
Get-FileHash -Algorithm SHA256 -LiteralPath <백업경로>/main-before-rollout-20261016.bundle
Get-FileHash -Algorithm SHA256 -LiteralPath <백업경로>/main-918cdf8.zip
```

## 조건 충족 후 전환 순서

1. 검색 최적화 실측 커밋 `8002d98`를 기준으로 전환 범위를 확정한다. 기준선 전체 193개·lint·타입·로컬 빌드, 최적화 후 관련 26개·타입·Vercel 빌드, 독립 인증/계측 16개를 구분해 기록한다. main source 백업 검증은 완료했으며 DB·Storage 복구 준비는 추가 확인한다.
2. Production OAuth와 정상 서명을 준비한다. 실발송은 차단한다. 승인된 운영 작업 창과 서비스 중단 영향을 확정한다.
3. Production 환경변수로 빌드하되 운영 도메인 연결을 보류한 staged production 배포를 만든다. 실제 운영 환경에서 연결·검색·문서 생성·서명·PDF·첨부 dry-run을 검증한다. `/ui-preview`와 `/validation-preview`는 Production에서 404가 정상이다.
4. 필수 조건이 모두 충족되면 정확한 배포 ID를 운영 별칭으로 전환한다. Preview 승격은 Production 변수로 재빌드되므로 Preview 성공만으로 동일 실행 환경을 보장하지 않는다. [Vercel 배포 승격 문서](https://vercel.com/docs/deployments/promoting-a-deployment)
5. 운영 smoke 검증 후에 승인된 제한 수신처로 실제 티켓·첨부·중복 방지를 확인한다. 별도 Zendesk 샌드박스가 없는 만큼 발송 가능 범위와 검증 시점은 명확히 정한다. 이 단계 전에는 전체 업무 완료로 선언하지 않는다.
6. 실제 운영 안정화와 롤백 기간이 끝나기 전에는 기존 API token을 폐기하지 않는다. 새 코드가 이를 인증에 사용하지 않더라도 과거 배포의 복구에는 필요할 수 있다.

## 장애 시 복구 원칙

- **새 요청의 인증·조회·문서 오류 또는 권한 누출:** 트래픽을 검증된 이전 배포로 되돌린다. 운영 DB의 보안 정책을 완화하지 않는다. old-main의 알려진 이력 노출을 포함한 복구 후보는 안전한 최종 상태로 간주하지 않는다.
- **발송 응답 불명확:** 발송을 멈추고 이미 만들어진 Zendesk 티켓을 먼저 대조한다. 새 idempotency key로 재전송하지 않는다. UI/코드 롤백은 이미 발송된 메일을 회수하지 못한다.
- **설정 불일치:** Vercel Instant Rollback은 기존 빌드와 그 환경을 사용한다. 프로젝트 변수 변경이 과거 빌드에 소급되지 않으므로 기존 토큰·설정의 유효성을 별도 확인한다. 롤백 이후 자동 운영 별칭 할당 상태도 점검한다. [Vercel Instant Rollback 문서](https://vercel.com/docs/instant-rollback)
- **DB/파일 손상:** 먼저 쓰기를 제한하고 영향 범위를 특정한다. 전체 공유 DB 복원은 정상 운영 기록도 잃을 수 있으므로 별도 검토 후 진행한다. 보안 정책 복구와 데이터 복구를 같은 작업으로 묶지 않는다.

## 소스 근거

- `src/lib/env.ts:7–21`: 새 OAuth 필수 변수 및 production 실발송 gate.
- `src/lib/server/zendesk-oauth.ts:16–17,41–44`: 조회/쓰기 허용 범위 결정.
- `src/lib/server/engineer-signatures.ts:17–35,52–58,77–80`: Preview 전용 서명과 정상 등록 우선순위.
- `src/app/api/history/ticket-sends/route.ts:16–18`: Preview의 service-role 소유자 필터.
- `src/app/validation-preview/page.tsx:7`, `src/app/ui-preview/page.tsx:7`: Production 진단/가상화 페이지 차단.
- `supabase/migrations/202610160001_document_pdf_retry.sql`, `202610160002_document_access_hardening.sql`, `202610160003_profile_self_insert_hardening.sql`: additive 변경 및 공유 정책.
- `docs/ACCESS_SEARCH_VALIDATION_2026-10-16.md`: 182개 자동 테스트와 실제 관리자/비로그인, 소표본 검색 검증의 범위 및 한계.

위 source 행 번호와 시작 변경량은 `5d251ea` 기준이다. 최종 검색 최적화 실측 코드는 `8002d98`이며, 사용자 보고서의 `phase-optimization/phase-before.json`, `phase-after.json`, `phase-comparison.json`, `role-after.json`에 측정·독립 재계산·권한 증거를 보존했다. 이 결과는 운영 실발송·실제 operator/viewer 계정 검증을 대체하지 않는다.
