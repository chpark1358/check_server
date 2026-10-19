# main 반영 사전 검토 — 최신 확인 2026-10-19

## 2026-10-19 현재 판정

**운영 후보 검증을 준비할 수 있는 조건부 Go다.** OAuth 변수 등록, 서명 정식 등록, 실제 역할 계정 검증, 별도 DB·Storage 복구, 복구 앱의 관리자 기존 비밀번호 로그인·새로고침 유지·문서 조회, 외부 백업의 업로드·재다운로드 해시 대조를 완료했다. 현재 요청한 준비 작업은 마쳤다. 다음 실적용은 최종 후보와 작업 시간을 정한 뒤 Production 런타임을 검증하고 단계적으로 전환하는 방식을 권한다. 운영 도메인 전환과 실발송 활성화를 검증 없이 함께 실행하는 것은 권하지 않는다.

**이번에 승인된 실행 범위는 복구 앱 실제 로그인과 외부 백업 사본 확보까지다.** 그 이후는 실적용 가능성 검토만 수행한다. Production 환경 후보 배포, main 병합·push, 운영 도메인 전환, 실제 티켓·메일·첨부 쓰기는 이번 범위에서 실행하지 않는다. 다음 단계의 실행 범위와 업무 중단 영향을 확정하기 전에는 기술 준비 완료를 배포 승인으로 해석하지 않는다.

### 기준 커밋과 변경 범위

| 대상 | 10월 19일 확인 결과 |
| --- | --- |
| 원격 main | `918cdf8920b022839150fde46f13b66fea5e5ed3`로 유지 |
| 원격 Preview | `0aec007`로 유지 |
| 로컬 검토 기준 | `cf819f4`. 원격 Preview 이후 차이는 백업·사전 검사 스크립트, 테스트, 문서 7개 파일이며 앱 실행 코드는 동일 |
| main 대비 전체 변경 | 107개 파일, 12,144행 추가·3,019행 삭제. UI·인증·문서·권한·검색 등을 포함한 전체 전환이므로 작은 보안 수정과 구분 |
| 운영 실행 상태 | 이번 작업에서 원격 main·기존 Preview·Production 배포와 운영 별칭을 변경하지 않음 |

원격 ref가 유지된 사실과 현재 운영 배포가 그 ref에서 만들어졌다는 증거는 다르다. 10월 16일 Production inspect에서 빌드의 Git SHA/ref를 확인하지 못했던 한계는 남아 있다. 실제 전환을 검토할 때 최종 후보 커밋·기존 배포 ID·설정·복구 후보를 다시 묶어 확인해야 한다.

### 완료한 준비와 현재 진행 상태

| 항목 | 현재 상태 | 아직 증명하지 않은 범위 |
| --- | --- | --- |
| 발송 이력 소유자 제한 | Preview owner/admin 제한, 모의 경로 검사와 실제 계정 검증 완료. 기존 main용 최소 수정 후보 `c062d7a`도 준비 | 원격 main에는 아직 미반영 |
| 실제 역할 계정 | admin·operator·viewer가 각각 로그인해 11개씩, 총 **33/33** 통과 | 본인 양성 자료가 없는 계정의 양성 사례, 역할 강등·장기 세션 등 추가 경계 사례 |
| Zendesk OAuth | Production 변수 등록 확인, 재발급 Secret을 반영한 Preview에서 자동 연결·6개 조회 통과 | Production 빌드에 주입된 실제 변수로 토큰 발급·조회 성공 여부 |
| 실발송 통제 | 프로젝트 Production 설정의 `ALLOW_REAL_ZENDESK_SEND=false` 확인 | 새 Production 빌드의 실제 차단 동작. 저장된 설정은 과거 배포에 소급되지 않음 |
| 이석진 서명 | 정상 Storage 경로와 메타데이터 등록·앱 목록·이미지 해시 확인 | Production 후보에서 새 문서를 생성했을 때의 서명·PDF 결과 |
| main 소스 백업 | Git bundle·ZIP 보존, bundle 검증과 별도 저장소 복원 SHA 확인 | 코드 백업만으로 운영 런타임·비밀 설정·DB를 복구할 수 있다는 뜻은 아님 |
| DB 복구 | 지정한 `check_server_recover`에 업무·Auth **34테이블·1,371행** 복원. 정확한 데이터 대조, FK 38개, RLS·정책·함수·트리거·ACL 검증 완료 | 복구 앱 관리자 로그인·새로고침 유지·문서 조회도 아래와 같이 통과. 실제 Production 런타임 검증은 별도 |
| Storage 복구 | 최신 백업 기준 **4개 버킷·200개 객체** 복구 완료 | DB·Storage 전체가 하나의 원자적 시점 스냅샷이라는 주장은 하지 않음 |
| 복구 앱 실제 로그인 | **관리자 기존 비밀번호 로그인·새로고침 유지 통과**. 문서 목록 API 200, 총 94개 중 첫 페이지 50개 조회. 복구 DB에서 새 로그인·Auth 세션 1개·password 인증 방식 기록 1개 추가 확인 | 복구 앱에서 operator/viewer 재로그인과 refresh-token 회전은 이번에 검증하지 않음. 기존 Preview의 3역할 33개 검증과 구분 |
| 외부 백업 사본 | **사용자 지정 Drive 위치에 4개 파일 업로드 완료**. 백업 ZIP을 실제 재다운로드해 21,524,374 bytes와 SHA-256 원본 일치 확인 | 일반 접근은 제한됨, 소유 권한 확인. 공유 설정을 추가 변경하지 않음. 모든 외부 서비스·비밀 설정을 재구축한 검증은 아님 |

복구 앱은 `cf819f4` 코드의 별도 로컬 snapshot을 Next.js 개발 서버의 Webpack 방식으로 실행했다. 복구 Supabase 연결 변수 3개만 주입하고 운영·Zendesk·CRM·PDF 변환 서비스 자격증명은 주입하지 않았으며 실발송은 껐다. 처음 연 로컬 origin의 저장소 항목은 0개였고 로그인 후에는 복구 프로젝트용 키의 이름만 확인했다. 브라우저 검증 중 비밀번호나 저장된 세션·키의 값은 수집하지 않았다. 기존 Preview와 Production에는 변경이 없다.

실제 비밀번호 로그인은 UI와 복구 DB의 후속 읽기 전용 집계로 확인했다. 관리자 계정의 새 로그인 시점, 신규 Auth 세션 1개와 password AMR 기록 1개가 확인됐으며 근거는 private 보관 자료 `recovery-login-auth-evidence.json`이다. 브라우저에서 Auth POST를 직접 관측한 증거는 없고 일부 요청 기록의 method가 null이므로 네트워크 POST 관측까지 완료했다고 표기하지 않는다. 새로고침 후 로그인 유지는 세션 복원 증거이며 refresh-token 회전의 실검증은 아니다. 로그인 자체가 복구 Auth에 정상 기록을 추가했으므로 전체 작업을 DB 읽기 전용이라고 표현하지 않는다.

외부 사본은 사용자가 지정한 Drive 위치의 [복구 백업 폴더](https://drive.google.com/drive/folders/1rGkZDY4OUY-P-34ncMDDLCQwGwmZZK7r)에 보관했다. UI에서 4개 파일 업로드 완료를 확인한 뒤 브라우저 다운로드로 ZIP을 다시 내려받아 Windows의 파일 해시와 대조했다. 재다운로드 파일은 **21,524,374 bytes**, SHA-256은 **`1c953a14c03ce80673945c6ed9e673307eb8ff3bdd6e711561a5554a060fb324`**로 원본과 일치했다. 근거는 private 보관 자료 `offsite-download-hash-verification.json`이다. 일반 접근이 제한된 사용자 소유 위치이며 추가 공유 설정 변경은 하지 않았다.

백업 ZIP은 생성 시점의 `cf819f4` 코드와 확인된 복구 자료를 보존한 사본이다. 이후 문서 수정까지 자동 반영되는 파일은 아니다. 환경 파일·서비스 키는 포함하지 않았고, 소스/main bundle의 606개 blob에서 지정한 `sb_secret` 및 service-role JWT 패턴이 0개인 것도 확인했다. 이 패턴 검사를 모든 형태의 비밀값이 없다는 보증으로 확대하지 않는다. **Auth 인증 자료는 복구 목적으로 포함되며 ZIP 자체는 암호화되지 않았다.** Drive 접근 제한과 ZIP 암호화는 별개이고, 비밀 설정·외부 서비스 전체를 자동 복원하는 묶음으로 취급하지 않는다.

DB 복구 첫 시도에서는 문서 테이블 생성 시 기본 ACL을 상속해 브라우저 INSERT·UPDATE·DELETE 권한이 남는 차이를 사후 검사에서 발견했다. 검사가 커밋을 차단했고 빈 대상 상태로 롤백됐음을 확인했다. 원본의 명시적 권한 회수를 복구 대상에 재현한 뒤 재검증했다. 데이터뿐 아니라 권한도 원본과 일치해야 완료로 처리했다는 복구 증거이며, 검사를 완화해 통과시킨 것이 아니다.

### 다음에 실적용을 검토할 조건

1. **현재 작업 종료 조건 완료:** 복구 앱 실제 관리자 로그인·새로고침·문서 목록, 외부 백업 4개 파일 업로드, ZIP 재다운로드·크기·해시 일치까지 확인했다. 요청한 두 작업을 마무리했으며 현재는 실적용 검토 결과를 정리하는 단계다.
2. **운영 후보 검증을 시작할 조건:** 최종 커밋, 변경 범위, 업무 작업 시간, 담당자, 실패 시 복구 대상을 확정한다. 이 단계는 후속 실행 범위다. 현재 Production 후보 배포도 실행하지 않는다.
3. **운영 도메인 전환을 검토할 조건:** 후속 Production 환경 후보에서 OAuth 자동 인증·6개 조회, 앱 로그인·역할·소유자 경계, 검색, 문서 생성·서명·PDF, 실발송 차단과 첨부 dry-run을 확인한다. 기존 Preview 성공과 복구 DB 성공만으로 Production 런타임 검증을 대신하지 않는다.
4. **실발송 활성화를 검토할 조건:** 별도 Zendesk 샌드박스가 없으므로 테스트 수신처와 실제 티켓·첨부·중복 방지 검증 범위를 정한다. 조회용 OAuth 성공은 쓰기 scope·실메일 전달 성공의 증거가 아니다. 운영 도메인 전환과 실발송 활성화를 별개 결정으로 다룬다.

첫 운영 빌드에 현재 준비된 `ALLOW_REAL_ZENDESK_SEND=false`를 적용하면 **메일 발송이 잠시 차단된다.** UI·조회·문서 기능을 점검하는 동안의 발송 중단을 업무 담당자에게 알리고 작업 시간을 정해야 한다. 이 영향은 전체 전환뿐 아니라 최소 소유자 제한 수정만 새로 배포할 때에도 생긴다. 반대로 과거 배포로 되돌리면 그 빌드에 고정된 이전 발송 설정이 돌아올 수 있으므로 현재 프로젝트의 `false`만 보고 롤백 후 상태를 예상하면 안 된다.

### 보안 보완과 롤백 후보

원격 main의 기존 service-role 발송 이력 API에는 소유자 필터가 없다. 공유 DB의 RLS 보완만으로 이 서버 경로를 막을 수 없으므로 **전체 전환이 미뤄져도 해결해야 할 항목**이다. 최소 보안 후보 `c062d7a`는 해당 경로를 보완하고 14개 테스트·타입·lint·독립 빌드를 통과했다. 원격 main 반영이나 Production 실행 검증까지 끝난 배포는 아니다.

이 후보를 별도로 검증하면 전체 UI 전환보다 작은 범위의 보안 반영 또는 복구 대안을 준비할 수 있다. 다만 아직 배포하지 않은 코드를 즉시 선택 가능한 롤백 배포라고 부르지 않는다. **원래 old-main 배포로 단순 복귀하면 알려진 발송 이력 노출도 되살아날 수 있다.** 따라서 운영 전환 전에 소유자 보완을 포함한 복구 후보와 그 환경 설정을 확인해야 한다. UI 배포 실패를 이유로 공유 DB의 권한 정책을 되돌리거나 운영 DB 전체를 과거로 복원하지 않는다.

**다음 실행 범위에서 Production 환경 후보의 실제 동작을 검증하고 결과에 따라 전환하는 것을 권한다.** 이번에 완료한 복구·외부 사본 검증은 그 다음 단계로 진행할 근거가 된다. 다만 **Production 런타임과 실제 외부 발송은 미검증**이다. 조회·문서·권한·발송 차단 검증을 통과한 후보부터 운영 전환 대상으로 삼고, 실발송은 정해진 수신처·범위의 쓰기 검증 이후 별도로 판단한다. 이번 작업에서는 후보 배포나 운영 전환을 실행하지 않았다.

최신 세부 근거는 `docs/PRODUCTION_SETUP_CHECKLIST_2026-10-16.md`와 사용자 HTML 보고서의 최신 복구 검증 항목을 함께 확인한다. 아래 내용은 비교를 위해 보존한 **10월 16일 최초 검토 기록**이다. OAuth 미등록·서명 미등록·계정 미준비·복구 미확인이라는 당시 상태를 현재 상태로 읽지 않는다.

---

## 2026-10-16 최초 검토 기록 — 당시 상태 보존

### 당시 판정과 범위

**현재는 전체 기능을 즉시 운영에 전환하지 않는 것이 맞다.** main 소스 백업과 Git 복원 시험, Preview 검색 최적화 실측은 완료했다. 그래도 운영 OAuth 설정, 실발송 통제, 이석진 서명 등록, 복구 준비가 남는다. 이 조건을 해결하면 단계적인 운영 전환은 가능하다.

검색 함수 3개의 실행 위치를 `iad1`에서 DB와 가까운 `sin1`으로 변경한 `8002d98`에서 전후 각 76회가 모두 성공했다. 시나리오별 반복 요청 18회 중앙값은 84.15–87.74% 감소했고, 변경 후 관리자·비로그인·소유 문서/RLS 검사 11개도 통과했다. 실제 최대 동시 요청은 변경 전 3개, 변경 후 1개로 동시 사용자 4명의 처리량 검증은 아니다. `vercel.json` 설정을 main에 반영하면 Production의 같은 검색 함수 3개에도 적용되지만 **현재 운영 배포는 변경하지 않았다**.

이 검토에서는 main 병합·push·배포·태그 생성, 운영 환경변수 변경, DB·Storage 데이터 내보내기를 수행하지 않았다. 사용자 요청은 “백업하고 적용해도 될지 검토”다. 실제 전환 전에는 검증된 최종 커밋과 영향 범위를 확정해야 한다.

### 당시 확인한 기준점

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

### 당시 운영 전환 조건

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

### 당시 공유 DB 변경과 old-main 호환성

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

### 백업은 네 층으로 구분

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

### 당시 제안한 조건 충족 후 전환 순서

1. 검색 최적화 실측 커밋 `8002d98`를 기준으로 전환 범위를 확정한다. 기준선 전체 193개·lint·타입·로컬 빌드, 최적화 후 관련 26개·타입·Vercel 빌드, 독립 인증/계측 16개를 구분해 기록한다. main source 백업 검증은 완료했으며 DB·Storage 복구 준비는 추가 확인한다.
2. Production OAuth와 정상 서명을 준비한다. 실발송은 차단한다. 승인된 운영 작업 창과 서비스 중단 영향을 확정한다.
3. Production 환경변수로 빌드하되 운영 도메인 연결을 보류한 staged production 배포를 만든다. 실제 운영 환경에서 연결·검색·문서 생성·서명·PDF·첨부 dry-run을 검증한다. `/ui-preview`와 `/validation-preview`는 Production에서 404가 정상이다.
4. 필수 조건이 모두 충족되면 정확한 배포 ID를 운영 별칭으로 전환한다. Preview 승격은 Production 변수로 재빌드되므로 Preview 성공만으로 동일 실행 환경을 보장하지 않는다. [Vercel 배포 승격 문서](https://vercel.com/docs/deployments/promoting-a-deployment)
5. 운영 smoke 검증 후에 승인된 제한 수신처로 실제 티켓·첨부·중복 방지를 확인한다. 별도 Zendesk 샌드박스가 없는 만큼 발송 가능 범위와 검증 시점은 명확히 정한다. 이 단계 전에는 전체 업무 완료로 선언하지 않는다.
6. 실제 운영 안정화와 롤백 기간이 끝나기 전에는 기존 API token을 폐기하지 않는다. 새 코드가 이를 인증에 사용하지 않더라도 과거 배포의 복구에는 필요할 수 있다.

### 장애 시 복구 원칙

- **새 요청의 인증·조회·문서 오류 또는 권한 누출:** 트래픽을 검증된 이전 배포로 되돌린다. 운영 DB의 보안 정책을 완화하지 않는다. old-main의 알려진 이력 노출을 포함한 복구 후보는 안전한 최종 상태로 간주하지 않는다.
- **발송 응답 불명확:** 발송을 멈추고 이미 만들어진 Zendesk 티켓을 먼저 대조한다. 새 idempotency key로 재전송하지 않는다. UI/코드 롤백은 이미 발송된 메일을 회수하지 못한다.
- **설정 불일치:** Vercel Instant Rollback은 기존 빌드와 그 환경을 사용한다. 프로젝트 변수 변경이 과거 빌드에 소급되지 않으므로 기존 토큰·설정의 유효성을 별도 확인한다. 롤백 이후 자동 운영 별칭 할당 상태도 점검한다. [Vercel Instant Rollback 문서](https://vercel.com/docs/instant-rollback)
- **DB/파일 손상:** 먼저 쓰기를 제한하고 영향 범위를 특정한다. 전체 공유 DB 복원은 정상 운영 기록도 잃을 수 있으므로 별도 검토 후 진행한다. 보안 정책 복구와 데이터 복구를 같은 작업으로 묶지 않는다.

### 당시 소스 근거

- `src/lib/env.ts:7–21`: 새 OAuth 필수 변수 및 production 실발송 gate.
- `src/lib/server/zendesk-oauth.ts:16–17,41–44`: 조회/쓰기 허용 범위 결정.
- `src/lib/server/engineer-signatures.ts:17–35,52–58,77–80`: Preview 전용 서명과 정상 등록 우선순위.
- `src/app/api/history/ticket-sends/route.ts:16–18`: Preview의 service-role 소유자 필터.
- `src/app/validation-preview/page.tsx:7`, `src/app/ui-preview/page.tsx:7`: Production 진단/가상화 페이지 차단.
- `supabase/migrations/202610160001_document_pdf_retry.sql`, `202610160002_document_access_hardening.sql`, `202610160003_profile_self_insert_hardening.sql`: additive 변경 및 공유 정책.
- `docs/ACCESS_SEARCH_VALIDATION_2026-10-16.md`: 182개 자동 테스트와 실제 관리자/비로그인, 소표본 검색 검증의 범위 및 한계.

위 source 행 번호와 시작 변경량은 `5d251ea` 기준이다. 최종 검색 최적화 실측 코드는 `8002d98`이며, 사용자 보고서의 `phase-optimization/phase-before.json`, `phase-after.json`, `phase-comparison.json`, `role-after.json`에 측정·독립 재계산·권한 증거를 보존했다. 이 결과는 운영 실발송·실제 operator/viewer 계정 검증을 대체하지 않는다.
