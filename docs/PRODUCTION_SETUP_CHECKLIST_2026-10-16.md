# 운영 반영 전 설정·계정·복구 준비 — 2026-10-16

> 최신 실행 상태는 [CURRENT_STATE.md](CURRENT_STATE.md)에서 먼저 확인한다. 2026-10-20 22:40 기준 운영은 기존 DQt·dry-run이며, 실발송은 0건이다. Zendesk 브라우저 MFA 완료 후 승인 범위 검토와 시험을 이어간다.

## 2026-10-20 최신 결정 — 한 건 발송 승인·운영 임시 변경 범위 확인 대기

사용자가 단독 사용을 확인해 별도 시험용 서버 가드 개발은 생략하기로 했고, **“지금 1건 실제 발송 승인”**을 명시했다. 기존 앱 권한·발송 차단 설정·중복 방지 처리와 확정한 수신처·합성 PDF·티켓 1건의 시험안으로 진행할 계획이다. 앱 소스를 바꾸거나 전용 서버 제한을 구현한 것은 아니다.

운영 전역 플래그의 임시 변경과 같은 `106ff48` 코드 재배포를 준비했지만, 자동 승인 검토가 이 운영 변경에 대한 별도 명시 승인 부족을 이유로 실행 전에 거절했다. 현재 임시 설정·재배포·시험 후 차단 복구·임시 허용 배포 삭제를 포함한 범위를 설명하고 사용자 답변을 기다리고 있다. 한 건 발송 승인은 존재하며 운영 변경 범위의 확인과 구분한다.

현재 실제 업로드·티켓 생성·메일 발송 0건, 환경 설정 변경·새 배포 0건이다. 승인 검토를 우회하지 않았고 비밀번호·토큰을 새로 받지 않았다. 상세한 최신 결정과 과거 준비 결과의 구분은 [실발송 준비 문서](REAL_SEND_PREPARATION_2026-10-20.md)를 따른다.

---


## 앞선 2026-10-20 실발송 준비 — 단독 사용·한 건 승인 전 기록

이 절은 당시 준비 기록이며 별도 서버 가드 개발 생략과 한 건 발송 승인은 위 최신 결정을 따른다. 당시 수신처 `chpark@jiran.com`, 합성 PDF 1개·메일초안을 준비하고 Production health/OAuth read·Zendesk설정을 읽기 전용으로 확인했다. 집중모의 검사68/68·대상 lint가 통과했으나 실제 쓰기·수신은 미검증이다. 글로벌발송flag가 모든 operator/admin에게 영향을 주고 실제모드선택에서 첨부 업로드가 시작될 수 있어, 실행자/수신처/파일/키/기간의 서버 제한 구현·검증이 활성화 전P0다. 현재는 설계만이며 원격 설정 변경·실제 업로드/발송·배포 0이다.

조직null이 ‘조직 없음’을 보장하지 않아 확인된 내부조직을 예정/고정 대상으로 삼고 생성 후 대조한다. CC없음도 Zendesk규칙의 추가 알림0을 보장하지 않는다. 초기 요청자 메일 후보 1개는 실제 한 통 보장이 아니며 조건부webhook체크박스초기값·지연 자동화/정리·외부구독·수신함전달/자동 회신의 한계가 남는다. 시험시간·서버 보호·이 조건들의확인·실행 승인은 아직 남아 있다. 상세 계획과 검증경계는 [실발송 준비 문서](REAL_SEND_PREPARATION_2026-10-20.md) 및 HTML `#real-send-preparation-20261020`을 따른다. 기존 main106 운영반영은 유지한다.

---


## 2026-10-20 후속 적용 — main·기존 Production106ff48 반영 완료, 실제 발송 차단

사용자의 **“검증 완료 후 기존 Production 교체”** 승인에 따라 기존 GitHub main을 정상 fast-forward로 갱신하고 기존 check-server-site Vercel Production을 교체했다. 새 프로젝트로 이전하지 않았다. 실제 Zendesk 티켓·메일·첨부 전송은 하지 않았고 `ALLOW_REAL_ZENDESK_SEND=false`를 유지한다. 새 Production에서 DOCX/PDF파일·등록서명해시·A4렌더·CPU단위와 직접강제dry-run·동일키재시도까지 확인했다.

| 항목 | 완료한 결과·검증 경계 |
| --- | --- |
| 코드·검사 | 앱 `106ff48b00d63717b9770c44285dbcbc135cf30f`, 전체294/294·타입·전체 lint·독립 빌드 통과. 빌드 소스105파일이 적용 커밋과 일치. UI 독립 리뷰2사례 보완·추가23개 통과 |
| 공유 DB | 14:17 매핑 RPC함수2개·schema cache 갱신. service-role만 EXECUTE, anon/authenticated/public 미허용. 매핑40개·RLS·테이블ACL·기존 함수 보존. 전후 대조는 repeatable-read 트랜잭션 기준 |
| Preview | F1 Ready·source106. 14:21 health200dry-run·설정누락0·OAuth200조회6종. 매핑GET40/revision유효·stale409·누락428·형식400·비인증401, 전후 자료·revision 동일 |
| main·운영 | 14:29:52 main918→106 정상 push. 14:34 독립 검증에서 운영주소3개·Production pointer가 DQt Ready/main106/Node24, Preview는 F1/106. 원격 main·Preview 모두106 |
| Production 실검증 | 사용자 앱·CRM 로그인 후14:38 health200dry-run·누락0, OAuth200ready6. 매핑GET40·충돌/누락/형식거절과 자료 동일. 루트200·DENY/nosniff, 검증전용2페이지404, 비인증health/mapping/history401 |
| 새로고침·매핑UI | 14:56:37 KST 운영 새로고침 후 앱로그인·CRM연결 유지, 실제매핑drawer40건·오류알림0·저장버튼 확인. UI관측이며 refresh-token회전/장기세션/실제매핑저장 실행은 아님 |
| 실제 CRM·문서 | LO24123103 조회200·3,123ms·CPU5%. DOCX/PDF생성200·10,374ms, PDF테스트첨부202·5,943ms. DOCX138,450 bytes·PDF113,814 bytes. 양쪽5.0%·이석진명/시리얼, DOCX등록서명PNG해시 일치, PDF595.32×841.92pt A4 1쪽·서명표시·잘림/겹침없음 확인 |

14:50 Production 직접검증에서 합성TXT업로드와 티켓의 `dryRun:false` 요청을 모두202·`dryRun:true`로 처리했다. 티켓ID null·자동해결 not_requested이며, 동일키 재시도200·duplicate true·이력정확히1건(dry_run·첨부1·ticketId null)을 확인했다. 전후health200·dry-run이었다. 실제 Zendesk 티켓·메일·첨부쓰기0을 유지했다.

새 문서 DOCX SHA256 `2fc19a3076bf3593dc2ccf5f1e4ddb9232f9053b52061bc1e228ddec7bd824eb`, PDF SHA256 `09dfe0664eff9b08396107acec1dd7632332457af528431cf28e3cfab1e82a03`; 내부서명은 등록해시 `c474964a1066740fa924dd40f4af0047ed4b7d040db216dca61cdb2c7e68696f`와 일치했다. 앱UI로 다운로드한 원본·렌더는 private에보관하고 보고서서버에 노출하지 않았다.

적용 직전 소스106·마이그레이션 전 DB/Storage 백업을 승인된 [비공개 Drive 폴더](https://drive.google.com/drive/folders/1vNq5IUZxzLIkfWuatpDrwRKSqmzbBhkG)에4파일로 보관했다. 14:27:21 재다운로드23,093,893 bytes·SHA256 `3137ac3555dcc813013b1cefbc23698a78c82a9f2c2d3519a43670a6c6cd41f7`가 원본과 일치했다. 새 백업은 복원하지 않았으며 DB 스냅샷은 매핑 RPC추가 전이므로 복원 후106코드에는 `202610200001_customer_mappings_atomic.sql` 적용이 필요하다. 기존 백업·공유 설정은 유지하고 원본ZIP/DB/고객문서를 HTML에 노출하지 않았다.

이번 적용·검증은 읽기 전용 작업이 아니다. 공유 DB의RPC함수2개·새 문서1건·Storage2파일·테스트첨부 메타데이터·dry-run이력1건·감사기록을 추가했다. PDF자동첨부와 합성TXT첨부는 모두테스트처리로 실제 Zendesk쓰기와 구분한다. 적용직전 백업 뒤에 생긴 검증자료는 다음백업에 포함해야 한다.

매핑 원자성은 실제 로컬 PG17의 합성 강제 실패·동시성, UI모의의 삭제확인/취소/오류, 공유 Preview/Production의 읽기·거절·자료 보존으로 각각 검증했다. 실제 고객 자료를 변경해 저장 성공을 강제로 만들지 않았다. **이전부터 열려 있던 운영 탭은 매핑 수정 전 새로고침해야 한다.** 새 API는 최신 revision 없는 구화면의 저장을428로 거절한다.

B4VT/0aec007은 필요한 경우 명시 승격 후 운영 별칭을 대조하는 복귀 계획의 대상이다. 최근 CRM·CPU·원자적 매핑 개선 전의 새UI이며 옛UI 복귀가 아니다. 복귀 실행/리허설은 하지 않았다. c062d7a는 이전UI 소스후보이며 즉시 배포된 대안이 아니다. 이력 소유자 결함이 있는 H35 기본 자동복귀는 권고하지 않는다. 앱 복귀 시 DB/Storage·권한 정책·새 문서·감사는 유지한다.

이번 전환에서 승인범위·대상커밋·복귀후보·발송차단을 확정하고 전환후주소를 대조했다. 복구담당자·숫자로정한 허용중단/데이터손실(RTO/RPO) 정책까지 확정했다는 뜻은 아니며 보존·복구정책 후속에남긴다. 기존 Preview의 실제admin/operator/viewer33건과 이번 Production의admin검증을 구분하며 이번에Production3계정을 다시검사한 것은아니다.

남은 P0는 **실발송 활성의 별도 조건**이다. 실제 수신처·쓰기 scope·첨부/티켓/수신·중복 방지는 승인된 범위에서만 후속 검증한다. P1 역할의 본인양성/강등·장기세션·복구계정·보존 정책, P2 다계정/장기 부하·공통작업ID·재개·접근성·Jev/Laya는 유지한다. 매핑 보완 자체는 이번에 적용 완료했다. 별도 빈 검증 프로젝트는 삭제했고 암호화 설정복사 helper는 승인거절로 실행0이며 이후 기존 Production 교체 승인 범위로 진행했다.

근거: HTML `#next-stage-validation-20261020`; `main-readiness/rollout-{pre-release-validation,mapping-shared-db-apply-result,preview-runtime-verification,pre-rollout-offsite-verification,main-push,production-final-deployment-verification,mapping-ui-browser-local,rollout-plan}-2026-10-20.json`. 추가 최종근거는 `rollout-production-{runtime-verification,public-checks,document-ui,document-file-verification,send-guard,session-ui-verification}-2026-10-20.json`이다. 각 JSON의 실행 시점을 구분한다. 특히 pre-release의 mainTransitionPerformed=false는 main push 전 기록이며 완료 여부는 이후 main-push/최종배포 근거를 따른다.

---

## 앞선 2026-10-20 12시 기준 최종 main 검토 — 전환 전 기록

이 절은12시 전환 전 검토 기록이다. 이후 승인된14시 적용 결과는 최상단을 따른다. 당시에는 main 병합·운영 주소 전환·새 Production 배포·실제 Zendesk 발송을 실행하지 않았다. 전환 전 P0의 최신 Production 확인·롤백 범위·작업 창이 남아 있어 지금 바로 적용 가능 또는 전환 준비 완료라는 판정은 아니다. 오늘 새 백업의 외부 사본·재다운로드 해시까지 확인해 이번 시점의 백업 사본 조건은 충족했다. 새 코드 차단 결함 미발견과 실제 전환 준비 완료를 구분한다. 실발송 활성은 현재 NO-GO다.

| 단계 | 판정 | 전환 전에 닫을 조건 |
| --- | --- | --- |
| UI·조회·문서 기능을 발송 false로 적용 | 조건부 GO / 현재 실행 보류 | 최신 코드의 Production 후보 확인, 장애 범위별 롤백 후보·작업 창·최종 실행 승인. 오늘 백업 사본 확보 완료; 후속 쓰기가 있으면 전환 직전 갱신 |
| 실제 티켓·메일·첨부 활성 | 현재 NO-GO | 쓰기 scope·제한 수신처·건수·범위를 확정하고 별도 승인 후 실제 전달·첨부·중복 방지를 확인 |

### 최신 상태와 이전 관측의 정정

2026-10-20 11:29–11:32 KST 읽기 전용 Vercel API 결과:

- 현재 Production pointer는 `dpl_H35D8epHPPR46Ryo72KhXm2iHFmF`, Ready다. `gitSource.sha`와 `meta.githubCommitSha`가 모두 main `918cdf8920b022839150fde46f13b66fea5e5ed3`와 일치했다. **앞선 inspect에서 SHA를 찾지 못했던 한계는 이번에 해소했다.** 아래 이전 기록의 미확인은 당시 시점으로 해석한다.
- Production 검증 후보는 `dpl_B4VTm6QhyxE89G94WQbXBC2UHenx / 0aec007`, 최신 Preview는 `dpl_DkiNFA7qQP7WDPr1Rt9UbWa25ngs / b10d43d`다. main 대비 앱·스키마·Vercel 설정 64파일, 5,920행 추가·3,014행 삭제로 전체 전환이다.
- 0aec007→b10d43d의 앱 차이는 CRM 표시 3파일과 문서 CPU 단위 1파일이다. 인증·발송·DB 스키마 차이는 없다. b10d43d 이후 dd9ac33까지는 문서만 바뀌었다.
- 최신 Preview 전체 259개·타입·lint·빌드·실제 DOCX/PDF 5.0%·서명·CRM 실조회는 통과했다. 기존 Production 후보의 OAuth 6종·직접 강제 dry-run·동일 키 재시도도 통과했다. **이 결과를 최신 b10d43d의 Production target 검증으로 합치지 않는다.**
- Production OAuth·변환 서비스·Supabase 변수 등록과 발송 boolean `false`를 재확인했다. 비밀값을 추출하지 않았다. 현재 설정은 과거 H35에 소급 적용됐음을 증명하지 않는다.

11:59:01 KST 최종 읽기 전용 대조에서 운영 기본·프로젝트·main 별칭3개는 H35, 고정 Preview는 Dki, 원격 main918cdf8·Previewb10d43d가 모두 유지됐다. 이번 최종 검토 중 배포·별칭·환경 설정·원격 Git은 변경하지 않았다. 근거는 `main-readiness/final-unchanged-state-2026-10-20.json`이다.

### 오늘 최신 백업 — 복원 시험과 구분

2026-10-20 11:30–11:32 KST 원본 읽기 전용 백업을 새 위치에 보존했다. 기존 백업을 덮어쓰거나 복구 대상에 접속/쓰기 하지 않았다.

| 항목 | 새로 검증한 결과 |
| --- | --- |
| DB | custom archive 545,814 bytes · 658개 목록 · 전체 압축 해제 성공. SHA-256 `397675b7cf126935c10688838a3510da89f9edbf2289c4223cd35affa957b8ef` |
| 아카이브 행 | public 999 · Auth 512 · Storage 메타 284. Auth 사용자 10명. catalog와 비교한 43개 항목의 변경 0 |
| Storage | 4버킷·206객체·64,567,270 bytes. 독립 로컬 해시206/206 일치. 전후 객체 목록·참조 안정 |
| 참조 | 전체 참조203·누락0, 활성 참조 누락0. PG 아카이브의 객체 키·문서/서명 참조202개와 정확 일치 |
| 최신 소스 | main918cdf8·배포 Preview b10d43d·문서 dd9ac33·복구후보 c062d7a의 ZIP과 완전한 이력 bundle 확보. 격리 Git 복원4개의 HEAD/tree/fsck/clean 일치. c062d7a의 소유권 회귀14개 오늘 재검증 통과 |
| 이동용 패키지·외부 사본 | ZIP22,448,590 bytes·228개 항목. 독립 로컬 압축 해제·해시228개·CRC 통과. 비공개 Drive에5개 파일 업로드·새로고침5개 확인. 12:06:35 KST ZIP 재다운로드 크기·SHA 원본 일치 |

새 이동용 ZIP SHA-256은 `20874141571b0df5ce43bcd02a942c33d275fa8e1a81b0c701594bc9fc4feed1`이다. 환경 파일·키·복원용 작업 폴더·캐시를 제외했다. 패키지 생성 시점의 `offsiteUploadPerformed=false`는 로컬 검증 경계이며, 후속 `final-offsite-verification-2026-10-20.json`이 실제 외부 업로드·재다운로드 완료를 증명한다.

승인된 부모 아래 [10/20 비공개 Drive 백업 폴더](https://drive.google.com/drive/folders/1CGrO9y7CIBc6E5BIFGOk85Y0EOZWOPB7)에 ZIP·README·SHA256SUMS·패키지 검증·복귀 후보 확인 등 5개 파일을 업로드했다. 업로드 완료5개·새로고침 후 목록5개, 폴더와 ZIP의 비공개 상태를 확인했고 공유 설정을 변경하지 않았다. 다운로드 이벤트2회는 타임아웃됐지만 이후 해당 ZIP의 UI에서 발견한 신뢰 Google 다운로드 URL의 인증된 GET이200으로 성공했다. Windows Get-FileHash SHA256으로 22,448,590 bytes와 원본 SHA 일치를 12:06:35 KST에 확인했다. ZIP은 암호화하지 않았고 Auth 복구 데이터·고객 문서를 포함하므로 승인된 비공개 보관소에만 보관한다. 원본 ZIP·덤프·고객 파일을 HTML 서버에 노출하지 않는다.

오늘 새 아카이브는 로컬 압축 해제·해시·메타/참조를 검증했으며 DB 복원을 실행하지 않았다. 10/19 별도 DB/Storage 복원·관리자 로그인 통과는 이전 스냅샷에 대한 근거다. 클러스터 역할 정의는 이번 아카이브에 포함하지 않는다. DB와 Storage는 별도 읽기이므로 원자적인 분산 스냅샷이 아니며, 업무 쓰기가 계속되면 전환 직전 갱신한다. 원본 덤프·고객 문서·키를 HTML에 연결하지 않는다.

### 롤백 준비와 실행 기준

1. **1차 B4VT/0aec007:** Production의 OAuth·문서·차단·직접 API를 검증한 직전 후보. 10/20 11:41:21 KST 재조회에서도 health 200·dry-run·필수 환경 누락0, OAuth connection 200·readAccess ready·요청 read scope·6종 available을 확인했다. 최근 CRM/CPU 회귀를 되돌릴 때 쓸 수 있으나 전체 새 UI를 포함하므로 전체 UI 장애의 회피책은 아니다. 프로젝트 `lastRollbackTarget`은 null이며 Ready만으로 공식 Instant Rollback 자격 또는 실제 복귀 성공을 단정하지 않는다. 버튼의 선택 가능 여부나 자동 복귀는 시험하지 않았으며 실제 복귀 방식은 별도 승인할 실행 계획으로 남는다. 오늘 CRM 세션은 만료되어 실조회를 다시 하지 않았고 DOCX/PDF 재생성도 하지 않았다. 앞선 실검증 근거는 보존한다.
2. **2차 c062d7a:** 이전 UI + 발송 이력 owner/admin 수정. 로컬 14개·타입·lint·빌드는 통과했으나 Production 미배포이며 API token 방식의 현재 인증·설정·공유 DB 런타임 확인이 남는다. 즉시 사용 가능한 운영 복구본으로 표기하지 않는다. 이전 UI 복귀를 보장하는 계획이면 이 런타임 준비가 필수다. 그렇지 않으면 B4VT로만 복귀 가능한 범위와 전체 UI 장애 시 중단 대응을 최종 판단자가 수용해야 한다.
3. **H35/918cdf8:** 운영 기준점은 보존한다. service-role 이력 조회의 소유자 제한 결함이 있어 기본 복귀 후보로 권고하지 않는다. RLS만으로 이 서버 경로가 보호되지 않으며 과거 빌드의 실제 발송 상태도 현재 설정 false로 보장되지 않는다.
4. **데이터는 유지:** 앱 복귀 시 DB/Storage·새 문서·발송 이력·권한 보완을 그대로 둔다. nullable PDF 선점 컬럼과 service-role 경로는 기존 코드와 코드상 호환된다. UI 장애를 해결하려고 DB 전체 복원·권한 완화를 실행하지 않는다. 외부에 전달된 티켓·메일은 앱 롤백으로 취소되지 않는다.
5. **후보/별칭 확인:** 최종 앱 SHA·배포 ID·설정·운영 주소3개의 기준점을 고정한다. 최신 후보 health dry-run·OAuth6종·조회·문서·권한·Production 검증 전용 페이지 차단을 확인한다. 이전 `--skip-domain`/`autoAssignCustomDomains=false` 지정에도 별칭2개가 이동한 사건 때문에 실제 별칭 API를 전후 대조한다.
6. **중단 기준:** health real, 필수 설정 누락, 예상치 못한 별칭 이동, 인증/소유권 이탈, 조회·문서 실패, 서명·단위 오류이면 전환 중단. 결과를 기록하고 장애에 맞는 검증 후보의 복귀 절차를 적용하며 DB를 과거로 되돌리지 않는다.
7. **사람이 정할 실행 조건:** 작업 시간·담당자·복귀 판단자·허용 중단/손실·최종 후보를 정하고 사용자 최종 실행 승인 후만 전환한다. 현재 비밀번호·키·추가 계정 입력은 필요 없다. 실제 발송은 이후 테스트 수신처·건수·첨부/티켓 범위와 별도 승인 사항이다.

### 남은 작업 우선순위

- **P0 전환 전 미완료:** 최신 Production 후보 확인 → 장애 범위별 롤백·작업 창·최종 승인. **최신 백업/외부 사본 확보는 이번 시점 완료**이며 이후 쓰기가 있으면 전환 직전 기준점을 갱신한다.
- **P0 실발송 활성 전:** OAuth 쓰기 권한·제한 수신처·실제 첨부/티켓/수신·동일 키 중복 방지. 발송 false 적용과 분리한다.
- **P1:** 고객사 매핑의 삭제 후 삽입을 원자적으로 보완(중간 실패 시 기존 자료 손실 가능; 보완 전 대량 교체 저장을 보류하고 변경이 필요하면 기존 매핑 백업·복구 가능 여부 먼저 확인), 본인 양성 행·역할 강등·복구 operator/viewer/장기 세션, 이력/문서/백업 보존 기간·담당자.
- **P2:** 다계정·장시간·대량 검색 성능, 공통 작업 ID·일괄 재개, 검색 편의·브라우저/접근성, Jev/Laya 추가 기능 PoC.

현재 HTML `#final-main-readiness-20261020`과 안전 요약 근거:
`main-readiness/final-latest-backup-verification-2026-10-20.json`, `final-deployment-state-2026-10-20.json`, `final-project-metadata-2026-10-20.json`, `final-production-env-metadata-2026-10-20.json`, `final-source-backup-verification-2026-10-20.json`, `final-package-verification-2026-10-20.json`, `final-rollback-metadata-2026-10-20.json`, `final-fallback-readiness-2026-10-20.json`, `final-offsite-verification-2026-10-20.json`.

---


## 2026-10-20 최신 상태 — 직접 API·PDF·CRM 실제 연결과 탭 간 반영 확인

요청한 순서대로 기존 Production 후보의 직접 API를 검사하고 CRM 상태 표시·PDF CPU 단위를 수정해 기존 Preview에 반영했다. **main 전환과 실제 Zendesk 티켓·메일·첨부 쓰기는 수행하지 않았다.** 아침 사용자 로그인 후 기존 탭의 실제 CRM 연결·새 탭 세션 복원·실세션 메타데이터 전파·같은 Preview 실조회까지 확인했다. 이전 비교 탭이 닫혀 있어 비밀번호 제출 순간 자체의 전파는 직접 관측하지 않았으며, 이 경계를 아래에 명시한다. 이번 확인을 위한 추가 사용자 로그인은 필요하지 않다.

| 항목 | 실제 결과 | 판정·경계 |
| --- | --- | --- |
| 직접 API 9회 | 기존 `aj4khdmqi / 0aec007`에서 health 전후 200·dry-run, 무인증 401 | 완료 |
| 첨부 강제 요청 | 합성 TXT 1개·`dryRun:false` → 202·`dryRun:true` | 실제 Zendesk 업로드 없음 |
| 티켓 강제 요청 | `dryRun:false`·자동 해결 요청 → 202·`dryRun:true`, ticketId null, autoSolve not_requested | 실제 티켓·메일·해결 없음 |
| 동일 키 재시도·이력 | 200·duplicate true, 해당 키 이력 정확히 1건·dry_run·첨부 수 1·ticketId null | 완료. 외부 부분 성공·응답 유실 장애는 별도 |
| CRM 구현 | 계정별 브라우저 연결 메타데이터 기준 표시 동기화, storage·focus·visibility 복귀, 오래된 만료 타이머·저장소 차단 방어 | 회귀 8개 통과 |
| 배포 브라우저 CRM 표시 | 공개 메타데이터 2탭 쓰기/삭제/갱신으로 새로고침 없는 연결/해제 표시·오래된 만료 이후 갱신값과 연결 유지 | 앞선 모의검증 통과·원래 값 정확 복원·서버 쿠키 변경 없음. 당시 실제 비밀번호 로그인 전파는 미검증이었음. 아침의 실세션 확인은 아래 별도 행으로 추가하며 비밀번호 제출 순간 직접 관측과 구분. 새 상태 API 없음·HttpOnly 쿠키 유효성은 기존 실제 조회에서 서버 최종 확인 |
| 아침 실제 CRM 연결·전파·조회 | 사용자 로그인 후 기존 고정 Preview 탭을 새로고침하지 않고 연결됨·잔여 52:15 확인. 새 탭 자동 복원, 실제 세션 공개 메타데이터 제거/정확 복원 시 다른 탭의 연결 필요/연결됨 반영. 09:25:02 KST 같은 Preview UI에서 LO24123103 조회·CPU 5%·연결 유지 확인 | PerformanceResourceTiming responseStatus 200·fetch·4,298ms, 전파/조회 내내 navigation time origin 동일. 쿠키 읽기/변경·비밀번호/토큰 내보내기 없음. 이전 비교 탭이 닫혀 비밀번호 제출 순간은 직접 관측하지 못함 |
| CPU 단위 구현·문서 | %를 한 번만 표시·누락값 유지. 12개 입력·실제 DOCX 회귀와 새 Preview DOCX/PDF의 5.0% 확인 | 완료. 실조회는 기존 Production, 문서 생성은 새 Preview |
| 전체 코드 검증 | 259/259·수정 후 타입 검사·전체 및 최종 focused lint·독립 빌드 통과 | 기존 복구 앱의 루트 .next EBUSY·초기 DNS/symlink 실패를 성공으로 집계하지 않음 |

수정 커밋은 `b10d43d51d6a4f6dd55a425b49e37956efbdb817`이다. 기존 `codex/preview-sandbox`에 정상 push했고 [새 Preview 308bd6k5k](https://check-server-site-308bd6k5k-chpark425-3494s-projects.vercel.app/) · `dpl_DkiNFA7qQP7WDPr1Rt9UbWa25ngs`가 Ready다. 원격 main은 `918cdf8`을 유지했다. 기존 Production 고유 후보 `aj4khdmqi / 0aec007`의 코드·URL은 바뀌지 않았다.

새 Preview가 Ready여도 고정 Preview 별칭이 old `dpl_8PtHzEGQgHBVtBBGTNP16dF3Vn61`에 남아 있었다. 실제 문서의 CPU `5.0` 출력과 배포 ID 대조로 이를 발견했고, **00:56:53 KST 고정 Preview 별칭 1개만** 새 Dki 배포로 명시 갱신한 뒤 API로 확인했다. 운영 기본·보조·main 주소 3개는 변경하지 않았다. 갱신 전 문서·preflight는 `before-alias-*` 오류 감지 자료로 분리해 수정 성공에서 제외했다. 01:02:22 KST 최종 별칭 API에서 운영 기본·보조·main 주소 3개가 기존 H35 배포로 유지되고 고정 Preview만 Dki로 갱신됨을 확인했다. 원격 ref도 main 918cdf8·Preview b10d43d로 대조했다. `--skip-domain`의 `autoAssignCustomDomains:false`는 자동 생성 별칭 전체의 불변 보장이 아니므로 이번에는 Production을 재배포하지 않았다.

실제 점검값은 기존 Production 후보에서 LO24123103을 새로 조회한 HTTP200·CPU 5% 자료다. 이를 새 b10d43d Preview 문서 API에 전달했고 생성 200·PDF ok와 다운로드 200을 확인했다. **이 앞선 문서 생성 단계는 새 Preview의 CRM 비밀번호 로그인을 검증한 것이 아니다.** 아침의 실제 CRM 연결·탭 복원·실조회는 별도 근거로 추가했다. DOCX 138,434 bytes·SHA-256 `4b138f665f20c3c950aaa615c3d5d4e6520f3858e4bce092376d17ffe66a8d35`의 CPU 행은 `5.0%`이고 서명 해시는 등록 파일 `c474964a1066740fa924dd40f4af0047ed4b7d040db216dca61cdb2c7e68696f`와 일치했다. PDF 113,558 bytes·SHA-256 `31140eac9aa0d6c536f4a5cf18d499c79709829a67a6eb3e3427e5d5be9fcd4a`는 텍스트·렌더 모두 `5.0%`, A4 595.32×841.92pt 1쪽, 서명 표시·잘림/겹침 없음으로 확인했다.

독립 빌드는 동일 b10d43d Git archive의 별도 디렉터리에서 Node22·Next16.2.4·Webpack으로 성공했다. 공개 클라이언트 설정 2개만 주입했다. 원격 Vercel은 기본 Turbopack 경로에서 Ready다. 루트 빌드 EBUSY와 초기 DNS·symlink 실패는 별도로 보존했다.

브라우저 bearer는 같은 origin 요청에만 사용했고 값을 출력·복사·저장하지 않았다. 합성 테스트 발송 이력 1건과 새 문서·다운로드 감사 기록은 공유 DB/Storage 변경이며 전체 작업은 읽기 전용이 아니다. 실제 Zendesk 전송과 구분한다. 앞선 Drive 백업 이후 자료가 있으므로 운영 전환 직전 최신 백업 시점도 별도로 판단해야 한다.

안전한 요약 근거는 HTML 보고서 `main-readiness/`의 다음 파일에 보존한다. 원본 DOCX/PDF·고객 데이터·서명 렌더·자격증명 다운로드 링크는 만들지 않는다.

- `api-crm-cpu-direct-api-2026-10-20.json`: 기존 Production 후보의 직접 API 9회·강제 dry-run·동일 키 재시도.
- `api-crm-cpu-aliases-before-2026-10-20.json`, `api-crm-cpu-preview-deployment-2026-10-20.json`, `api-crm-cpu-preview-alias-updated-2026-10-20.json`, `api-crm-cpu-aliases-final-2026-10-20.json`: 기준선·수정 Preview·고정 별칭 명시 갱신·01:02 운영 주소 3개 유지 최종 대조.
- `api-crm-display-browser-2026-10-20.json`: 앞선 공개 메타데이터 2탭 모의검증. 당시 실제 로그인 전파 false를 소급 변경하지 않는다.
- `api-crm-real-session-2026-10-20.json`: 아침 실제 연결·새 탭 복원·실세션 공개 메타데이터의 새로고침 없는 전파·같은 Preview 조회. passwordSubmissionMomentObserved는 false이며, 이전 비교 탭이 닫혀 제출 순간을 관측하지 못한 한계를 보존한다.
- `api-cpu-fixed-generation-2026-10-20.json`, `api-cpu-file-verification-2026-10-20.json`: 조회/생성 환경을 구분한 API·다운로드·단위·서명·A4 렌더 검증.
- `api-crm-cpu-full-tests-2026-10-20.tap`, `api-crm-cpu-code-validation-2026-10-20.json`: 전체259개·타입·lint·빌드와 검증 경계.

09:20 사용자 로그인 완료 확인 후, 실제 인증된 세션의 공개 연결 메타데이터를 다른 탭에서 잠깐 제거했다가 원상 값으로 정확히 복원해 구독 탭의 상태 전파를 확인했다. 이는 비밀번호 제출 이벤트를 재현한 검사가 아니다. 구독 탭에서 실제 조회가 성공한 뒤에도 연결 상태를 유지했다. 단일 4,298ms는 부하 성능 지표로 일반화하지 않는다. 이 아침 추가 확인에는 앱 소스 수정·재배포·새 문서 생성·메일 실행이 없으며 main 전환·실제 발송은 여전히 별도 판단이다. 공개 연결 메타데이터의 잠깐 제거·정확 복원과 실제 조회에 따른 감사 기록은 발생했다. 09:26:20 KST 별칭 API 재확인에서도 운영 기본·보조·main 주소 3개는 기존 H35, 고정 Preview는 Dki 배포를 유지했다. 이 근거는 `crm-followup-aliases-final-2026-10-20.json`에 별도로 보존한다.

아래 Production UI·파일 기록은 **00:17 종료 시점의 앞선 관측**이다. 당시 raw HTTP·직접 요청·동일 키 재시도가 미검증이었던 한계는 위 검사로 보완했으며, 당시 증거 파일은 소급 수정하지 않는다.

## 앞선 2026-10-20 00:17 확인과 후속 조건

### Production 후보 OAuth·문서 생성·발송 차단 검증 완료

사용자의 후속 요청인 **Production 환경의 OAuth·문서 생성·발송 차단 검증**을 완료했다. 10월 20일 후보 관리자 로그인·새로고침 유지, OAuth 6개 조회 가능, CRM LO24123103 실조회, 이석진 서명이 포함된 새 DOCX/PDF 생성·다운로드·렌더, PDF 자동 첨부 1개와 dry-run 1회 성공을 확인했다. 사용자가 야간 실제 전송 금지를 다시 명시했으며 **main 병합·push, 운영 main 승격, 실제 Zendesk 티켓·메일·첨부 쓰기는 수행하지 않았다. 자동 별칭 2개의 일시 변경·복원은 아래에 따로 기록했다.**

| 확인 항목 | 2026-10-20 최신 상태 | 검증 경계 |
| --- | --- | --- |
| Production 후보 | `dpl_B4VTm6QhyxE89G94WQbXBC2UHenx`, **Ready**. [후보 전용 주소](https://check-server-site-aj4khdmqi-chpark425-3494s-projects.vercel.app/) | Ready는 빌드·배포 완료이며 업무 런타임 검증 성공이 아님 |
| 소스 기준 | 승인된 기존 Preview의 `0aec007`. 로컬 `87ebd03`과 앱 소스·package/lockfile·Vercel 설정 동일 | 이후 차이는 백업 도구·테스트·문서. 원격 main을 병합·push하지 않음 |
| 환경 설정 | Production OAuth 2개와 CloudConvert·ConvertAPI 변수의 등록 메타데이터 확인. 프로젝트 발송값과 후보 build/runtime 요청은 `ALLOW_REAL_ZENDESK_SEND=false` | 비밀값을 추출하지 않음. 변수 등록만으로 토큰 발급·PDF 변환·발송 차단 성공을 주장하지 않음 |
| 로컬 검사 | `zendesk-oauth.test.mjs`와 `ticket-send-state.test.mjs` **36/36 통과**, TAP 보존. 실제 `src/lib/env.ts` 함수의 gate 7개 조합 모두 OAuth·외부 fetch 호출 0회 | Production 요청을 실행한 검사와 구분 |
| 별칭 최종 상태 | **10월 19일 23:50 KST** API 재조회: 운영 기본·보조 프로젝트·main 별칭 3개 → `dpl_H35D8epHPPR46Ryo72KhXm2iHFmF`, Preview 별칭 → `dpl_8PtHzEGQgHBVtBBGTNP16dF3Vn61` | 후보 생성 중 Preview·보조 프로젝트 별칭이 일시 변경돼 즉시 원상복구. 모든 별칭이 처음부터 유지됐다고 표기하지 않음 |
| 실제 앱·OAuth | 후보 관리자 앱 로그인·새로고침 유지. 관리자 패널에서 자동 연결과 **담당 그룹·조직 검색·시리얼 검색·수신자·최근 티켓/추천·티켓 필드 6개 모두 조회 가능** 표시 | 실제 배포 UI의 연결 검사 결과이며 토큰 값·원본 HTTP 응답을 수집한 검사로 확대하지 않음 |
| 발송 차단·dry-run | 관리자 패널의 **조회 권한만 요청·실제 발송 차단**, 메일의 실제 전송 선택지 DOM `disabled=true`·선택 모드 dry-run 확인. PDF 자동 첨부 1개 후 **dry-run 1회 성공**, 실제 Zendesk 티켓 미생성 완료 UI 확인 | 앞선 UI 단계에서는 raw 응답·직접 요청이 미검증이었음. 00:31 후속 API 검사로 강제 dry-run·동일 키 중복 방지 확인. 실제 Zendesk 쓰기 없음 |
| CRM 실조회 | 새로고침만으로 CRM 연결·잔여 50분 확인. **LO24123103 조회 성공**, CPU 4%·메모리 21%/16GB·디스크 최대 75% | 초기 연결 필요 표시는 새로고침으로 해소. 로컬 연결 정보와 UI 갱신의 정확한 발생 조건은 미재현 |
| 새 문서·서명 | 이석진 선택 후 DOCX/PDF 생성·브라우저 다운로드 성공. DOCX 내부 서명 PNG는 정상 이미지 해시 일치. PDF A4 1쪽·서명/시리얼/점검값/미수집 표시, 겹침·잘림 없음 확인 | 원본 수집 시각 10월 19일 00:31에 맞춰 점검일 19일 정상 표시. PDF CPU 값 4.0의 % 단위 누락은 후속 개선 |

최초 CLI 후보 `dpl_EujsYcWC4GEdxCDSBfn2i4JxSB3H`는 Git 작성자의 배포 권한 검사에서 차단됐다. Git 작성자나 권한을 변경하지 않고 공식 기존 Preview 재배포로 현재 후보를 생성했다. 요청에는 `autoAssignCustomDomains=false`를 지정했으나 Preview·보조 프로젝트 별칭이 후보로 일시 연결돼 즉시 복구했다. 실제 별칭 API로 원래 배포 ID를 대조했으며, 요청 플래그나 후보 aliases 목록만으로 연결 유지 여부를 판단하지 않았다. main Git 변경과 실제 발송은 없었다.

문서 생성·dry-run 검증으로 공유 DB·Storage에 새 문서와 테스트 이력을 추가했다. 전체 작업은 읽기 전용이 아니며 실제 Zendesk 쓰기와 구분한다. **앞선 외부 백업에는 이번 추가 자료가 없으므로 전환 직전 최신 백업 확보 여부를 검토해야 한다.** 최신 요약 근거는 HTML 보고서 폴더의 `main-readiness/production-candidate-verification-2026-10-19.json`, 실제 런타임과 파일 근거는 아래 10월 20일 자료다.

### 10월 20일 실제 문서·dry-run 결과와 남은 한계

DOCX 다운로드 파일은 **138,452 bytes**, SHA-256 **`e2511bb138154415b23db7238c06cbc2146dba0f1366b46d4912866adc6d99e5`**다. 내부 `word/media/engineer_signature.png`의 SHA-256은 **`c474964a1066740fa924dd40f4af0047ed4b7d040db216dca61cdb2c7e68696f`**로 정상 이석진 서명과 일치했다. PDF 다운로드 파일은 **113,814 bytes**, SHA-256 **`cf850138c37e6a0741664305c9eed6e6680018d77ebe09697a5d770a3eca579c`**다. 실제 렌더는 **595.32×841.92pt, A4 1쪽**이며 서명·시리얼·점검값·미수집 표시와 겹침·잘림 없음을 확인했다. 문서의 점검일 19일은 원본 수집 시각 10월 19일 00:31에 따른 정상 결과다. PDF CPU 값은 4.0으로 출력됐지만 % 단위는 없어 후속 표시 개선으로 남긴다.

초기 CRM 연결 필요·조회 버튼 비활성 상태는 새로고침만으로 연결됨·잔여 50분으로 바뀌었고 재로그인 없이 실조회가 성공했다. 앱 로그인도 새로고침 후 유지됐다. 브라우저의 로컬 연결 정보와 UI 갱신 상태는 후속 개선 후보이며 정확한 발생 조건은 재현하지 않았다. 서버 인증 실패가 계속되는 장애나 CRM 로그인 미완료로 단정하지 않는다.

메일 화면은 실제 전송 선택지가 DOM에서 비활성이고 선택 모드는 dry-run이었다. 테스트 조직·사용자 소유 수신자를 선택한 뒤 제목 `[Production 차단 검증] LO24123103 · 실제 발송 없음`으로 테스트 실행을 한 번 수행했다. PDF 자동 첨부는 테스트 파일 1개였고 완료 UI는 **“테스트 전송으로 검증되었습니다. 실제 Zendesk 티켓은 생성되지 않았습니다”**로 표시됐다. 실제 Zendesk 티켓·메일·첨부 쓰기는 수행하지 않았다. Aside의 `waitForResponse` 미지원으로 raw HTTP 응답은 수집하지 못했고, 동일 키 런타임 재시도와 직접 `dryRun:false` 요청의 강제 차단은 실행하지 않았다. 이 경계는 실제 `env.ts` 함수를 사용한 로컬 36개 테스트·gate 7개 조합의 OAuth/fetch 0회 결과와 구분한다.

### 앞선 완료 기록: 복구 앱 관리자 실로그인·승인된 Drive 사본 검증

앞선 요청은 **복구 앱 실로그인 → 다른 승인된 클라우드의 백업 사본**까지였다. 그 단계에서는 Production 후보 배포·운영 전환·실제 발송을 수행하지 않았으며, 이후 승인된 후보 검증은 위 최신 절로 구분한다.

사용자가 Aside의 별도 로컬 복구 앱(8802)에 기존 비밀번호로 관리자 로그인했다. 새로고침 후 세션·관리자 메뉴가 유지됐고 문서함 총94건/첫50건과 설정·상태·서명·문서 API HTTP200을 확인했다. 대상 DB의 별도 읽기 전용 확인에서도 일치하는 관리자1명, 앱 시작 후 신규 세션1개, password 인증 claim1개를 확인했다. **브라우저 response observer 이벤트는 0이라 Auth POST 메서드는 직접 관측하지 못했으나 실제 UI와 서버 인증 기록으로 보완했다.** 비밀번호·토큰·사용자 ID를 읽거나 내보내지 않았다.

복구 앱은 로컬 Next dev/Webpack 실행이며 대상 연결값3개만 전달했다. 원본/업무 자격증명은 주입하지 않았고 실발송은 false였다. 기존 Preview의 원본 DB 연결·배포는 유지했다. 복구 operator/viewer 실제 로그인과 토큰 갱신·재시작은 이번 검증에 포함하지 않았으며, 원본의 3역할33개 및 대상 SQL역할4개와 구분한다. Production 빌드·런타임 검증이 완료됐다는 뜻도 아니다.

이동용 ZIP은 **21,524,374 bytes / SHA-256 `1c953a14c03ce80673945c6ed9e673307eb8ff3bdd6e711561a5554a060fb324`**다. ZIP224개 항목을 별도 폴더에 실제 압축해제해 전체 SHA·크기·경로 제한과 검증 스크립트를 통과했다. DB(Auth 포함)·Storage200개·main918/preview cf819f4 ZIP/bundle·복구 근거를 포함하고 환경/키 파일·중복 Auth SQL·private 오류 로그는 제외했다. ZIP은 암호화하지 않았으며 사용자가 승인한 제한된 Drive 보관소에만 업로드한다.

**Drive 외부 사본 확보 완료:** 사용자 지정 상위 폴더 아래의 [check_server-backup-2026-10-19](https://drive.google.com/drive/folders/1rGkZDY4OUY-P-34ncMDDLCQwGwmZZK7r)에 ZIP·SHA256SUMS·패키지 검증 JSON·실제 로그인 JSON 4개를 업로드했다. ZIP을 실제로 다시 내려받아 **21,524,374 bytes와 SHA-256 `1c953a14c03ce80673945c6ed9e673307eb8ff3bdd6e711561a5554a060fb324`가 원본과 일치**함을 확인했다. 상위 폴더의 General Access 제한됨을 확인했고 업로드 후 새로고침한 하위 폴더 세부정보에서 비공개 상태를 재확인했다. 공유 설정 변경·공개 공유·초대는 없었다. 하위 General Access 대화상자의 별도 라벨은 직접 읽지 않았다는 관측 한계를 유지하며, 개별 ZIP URL은 추측하지 않고 확인된 폴더 링크만 사용한다. ZIP 자체는 로그인 전 생성된 사본이므로 생성 시점의 runbook과 최신 로그인 근거는 시점을 구분한다.

당시 실적용 판정은 **조건부 Go: 후속 Production 후보를 확인할 준비**라는 의미였다. 요청한 로그인·외부 사본 두 작업과 실적용 조건·영향·롤백 후보 검토를 마쳤고, 해당 단계에서는 후보 배포도 하지 않았다. 이후 사용자가 후보 검증을 요청해 위 Ready 상태까지 진행했으며 main 병합·운영 도메인 전환·실발송은 여전히 별도 범위다. 외부 사본은 확보됐고 담당자 실명·보존 정책 지정은 후속 운영 정책이다.

### 앞선 11시대 기록: 별도 DB·Storage 복원 검증 완료

원본 PG 17.6과 복구 대상 PG 17.11의 실제 연결을 확인했다. 원본·대상 DB 및 대상 Storage 자격증명은 준비됐으며 추가 비밀번호 입력은 필요 없다. 원본에서 custom pg_dump 아카이브 **541,562 bytes**, SHA-256 **`be01d84f53c2d5cb8568ecbb7d097ac563e8157df3a2fce2ac8aea16ddb832d9`**를 확보하고 네이티브 pg_restore TOC **658개 항목**을 검사했다. Auth 데이터는 포함하지만 클러스터 전역 role 정의·role 비밀번호와 외부 Storage 파일 내용은 별도 범위다. private 아카이브·SQL·키·행 데이터는 보고서 서버 밖에 보관하며 다운로드 링크를 공개하지 않는다.

최신 Storage 백업은 **4개 버킷·200개 객체·63,811,024 bytes**다. 원본 목록은 백업 전후 안정적이었고 로컬 파일 **200개 모두 독립 해시 검증**을 통과했다. 이전 10월 16일 198개 백업은 보존했다. 최신 DB와 Storage 백업도 원자적인 단일 시점 스냅샷으로 보지 않는다. 안전한 집계 증거: HTML 보고서 폴더의 `main-readiness/storage-fresh-backup-2026-10-19.json`.

복원 대상은 public 8개 + Auth 26개, **34개 테이블·1,371행(public 967 + Auth 404), 사용자 10명**이다. 빈 대상 사전 조건 **55개**를 통과했다. 앞선 두 실패·진단 실행은 기본 ACL 상속 보완 과정에서 중단·롤백했다. 이후 `generated_documents`의 anon/authenticated INSERT·UPDATE·DELETE를 명시적 REVOKE로 회수하고 정확한 ACL/RLS 검사를 유지한 최종 실행이 **2026-10-19 11:29:50–11:30:07 KST에 exit 0·COMMIT**으로 완료됐다. 독립 COPY·양방향 EXCEPT ALL·정렬 JSONB MD5, 34개/1,371행, FK 38개 고아 0, 정책 19개·RLS 8개·함수 5개·사용자 트리거 2개·ensure_rls 활성 및 원본 ACL 메타데이터 일치가 모두 통과했다. 안전한 결과는 `main-readiness/db-restore-verification-2026-10-19.json`에 보존했다. 이전 실패를 성공으로 계산하지 않는다. 이 11시대 DB 복원 검사 자체는 실제 로그인 증거가 아니며, 이후 별도 앱의 관리자 실로그인은 위 최신 절에서 추가 확인했다.

대상 Storage는 **11:31:03–11:32:35 KST**에 4개 버킷·200개 파일(63,811,024 bytes)을 복원했다. 실제 GET 재다운로드 SHA-256 **200/200**, HTTP 메타데이터 **200/200**, 버킷 설정이 일치했고 기존 객체 덮어쓰기나 삭제를 사용하지 않았다. 관리 객체 ID·생성시각 동일성은 검증 범위가 아니며 원본 manifest에 없던 사용자 정의 메타데이터의 복원을 주장하지 않는다. **11:34:26 KST 새 읽기 전용 연결**에서 참조197개 누락0·버킷4/객체200·public8/Auth사용자10/정책19를 독립 확인했다.

복구 대상 SQL 세션의 역할/claims로 admin·operator·viewer·anon **4개 검사를 모두 통과**했다. admin은 문서94/발송41, 나머지는 각0이며 문서 직접 쓰기는 차단됐다. Auth 관리 API도 HTTP200·사용자10명·DB ID 집합 일치가 통과했다. **이 11시대 SQL/API 검사는 실제 비밀번호 로그인이 아니었다. 이후 복구 앱 관리자 실로그인을 별도로 확인했다.** 이전 원본 Preview의 실제 3역할33개와 오늘 복구 대상 SQL4개 검사를 구분한다. 원본 프로젝트의 JWT·SMTP·Auth 서비스 환경설정을 그대로 복제한 것도 아니다.

실제 Data API는 복원 직후 8개 테이블에서 초기404/PGRST205가 발생했으나, 복구 대상에만 `NOTIFY pgrst, 'reload schema'`로 캐시를 갱신해 해결했다. [PostgREST 공식 안내](https://docs.postgrest.org/en/stable/references/schema_cache.html)

**11:41:08 KST 실제 Data API 8/8**이 HTTP200/206을 반환했고 GET limit=0으로 행을 반환하지 않은 채 총967행 집계가 기대값과 일치했다. 이 조치는 원본에 접근하거나 대상 테이블 데이터·권한을 바꾸지 않았다. 이 시점의 API 조회와 실제 계정 로그인을 구분한다. 이후 관리자 실로그인은 UI·신규 세션·password 인증 claim으로 확인했으며 복구 operator/viewer 실로그인은 아직 검사하지 않았다.

복구용 추가 비밀번호·키 입력은 필요 없다. 완료된 원본 8800·Storage 8801 입력 서버는 종료했고 보고서 8798은 유지했다. 이 복구 단계에서는 기존 Preview의 원본 DB 연결과 main·Production을 변경하지 않았다. 이후 복구 앱 관리자 실로그인과 승인된 Drive의 외부 사본·실제 재다운로드 해시 검증도 완료했다. 이어 승인된 Production 후보 검증 상태는 위 최신 절을 따른다. 실제 발송은 제한 수신처와 실행 범위의 별도 승인이 필요하다.

### 앞선 단계의 증거: 연결 입력과 부분 API 백업


사용자가 로컬 입력 페이지에 저장한 `check_server_recover` 연결 정보로 대상 PostgreSQL 17.11 접속을 확인했다. `scripts/recovery-preflight.mjs --target-only`는 원본 연결값을 읽지 않고, 명시적인 `BEGIN TRANSACTION READ ONLY` 안에서 고정 SELECT를 실행한 뒤 `ROLLBACK`으로 종료한다. Session pooler가 접속 시 PGOPTIONS의 읽기 전용 설정을 적용하지 않는 것을 확인해 SQL 트랜잭션에서도 이를 강제했다.

실제 결과는 public 업무 테이블 0개, Auth 사용자 0명, Storage 버킷 0개·객체 0개였다. `targetReady=true`이며 원본을 검사하지 않았으므로 `fullRecoveryReady=false`, `safeReady=false`를 유지한다. 실제 복원·DDL·DML은 실행하지 않았다. 대상 정보의 추가 입력은 필요하지 않다. 검사 도구의 관련 회귀 테스트 10개와 ESLint를 통과했다.

추가로 `scripts/export-recovery-app-data.mjs`를 이용해 원본 Data API에 GET 요청만 보내고 **public 업무 테이블 8개, 총 967행·552,226 bytes**를 로컬에 백업했다. 두 차례 조회에서 모든 테이블의 건수와 내용 SHA-256이 일치했다. 관련 회귀 테스트 **11개**를 통과했다. 이 부분 API 백업 단계에는 원본·대상 DB 쓰기나 원격 복원을 수행하지 않았다. 이후 대상 복원은 위 최신 결과를 따른다. main·Production 배포는 변경하지 않았다.

이 부분 백업의 10개 파일을 **97,331 bytes ZIP**으로 묶고 별도 로컬 폴더에 실제로 풀어 모든 파일의 해시 일치를 확인했다. 또한 이번 업무 데이터가 참조하는 문서 185개·서명 11개, **총 196개 참조**를 10월 16일 Storage 백업의 manifest 및 로컬 파일 해시와 대조해 누락 0개·불일치 0개를 확인했다. 이는 로컬 백업 간 정합성 검사이며 현재 원격 Storage를 다시 조회한 검사나 DB·Storage의 원자적 시점 일관성 검사는 아니다. ZIP 로컬 복원도 Supabase DB·Storage 원격 복원을 뜻하지 않는다.

| 백업한 업무 테이블 | 행 수 |
| --- | ---: |
| `app_settings` | 0 |
| `audit_logs` | 770 |
| `customer_mail_mappings` | 40 |
| `engineer_signatures` | 11 |
| `generated_documents` | 94 |
| `profiles` | 10 |
| `ticket_sends` | 41 |
| `user_preferences` | 1 |

이 사본은 **부분 업무 데이터 백업**이다. PostgreSQL 스키마·함수·권한·RLS·확장, Auth 인증 정보, 관리 스키마, Storage 파일 내용은 포함하지 않는다. 두 번 읽은 내용이 같더라도 테이블 전체를 하나의 트랜잭션에서 확보한 시점 일관성은 증명하지 않는다. 사용자 ID 참조를 보존했으나 로그인 사용자 자체를 복원할 수 있는 사본은 아니다. API에 노출되지 않은 `ticket_drafts`의 실제 DB 존재 여부도 이번 검사로 확정하지 않았다. 데이터 행·개인정보·키는 이 문서에 싣지 않고, 원본 NDJSON은 로컬 제한 보관 자료로 취급한다.

원본 `check_server`의 Aside Supabase 로그인과 실제 Dashboard 접근을 확인했다. **2026-10-19 확인한 최근 백업 7개는 모두 Physical이며 Restore만 있고 Download는 없었다. 최신 시각은 2026-10-19 03:34:40 KST다.** 아래 10월 16일 백업 시각은 과거 기록으로 유지한다. 원본 Connect에서 싱가포르 Session pooler `aws-1-ap-southeast-1`·포트 `5432`·DB `postgres`·원본 ref를 확인했지만 DB 비밀번호는 placeholder여서 확보되지 않았다.

원본 전용 입력 페이지에서 저장과 접속을 마쳤다. 원본 비밀번호 및 대상 정보의 재입력은 필요 없다. 당시 원본 입력 도구 가상 검사 14개와 백업 도구 11개·복구 사전 검사 10개(합계 21개)를 통과했으며 10월 16일 Preview 전체 214개와 구분한다.

이 부분 백업 단계 이후 전체 DB 아카이브를 확보했다. 앞선 실패·진단 대상 복원은 롤백했고 최종 실행은 모든 보호 검사와 커밋을 완료했다. 최신 상태는 위 절을 따른다. 원본 데이터 쓰기와 운영 배포는 하지 않았다.

공식 Dashboard 다운로드는 기존 logical backup에 한정되며 physical backup은 직접 다운로드할 수 없다. 현재 원본 화면에서도 Physical 백업만 확인돼 원본 PostgreSQL 연결로 전체 백업을 확보할 경로를 준비했다. API 연결 정보와 PostgreSQL 접속 정보는 서로 다르며, 기존 비밀번호를 임의로 재설정하지 않는다. [Supabase Dashboard 백업 복원](https://supabase.com/docs/guides/platform/migrating-within-supabase/dashboard-restore), [Supabase DB 백업](https://supabase.com/docs/guides/platform/backups)

이번 증거는 HTML 보고서 폴더 기준 `main-readiness/source-backup-access-2026-10-19.json`, `main-readiness/app-data-backup-2026-10-19/manifest.json` 및 `main-readiness/app-data-local-restore-verification-2026-10-19.json`, 구현은 `scripts/export-recovery-app-data.mjs`, 검사는 `tests/recovery-app-data-export.test.mjs`에 있다. 아래 10월 16일 기록의 대상 연결 대기 상태는 이 최신 확인으로 대체한다.

이 문서는 `d294d6b1ae5e7402d71b10a66055feaa5aa961a3`를 기준으로 시작한 운영 전 준비사항이다. 당시 원격 main 반영·Production 배포는 수행하지 않았다. 사용자가 Production OAuth 변수를 추가했고, 후속 준비 과정에서 Production 발송 설정을 `false`로 변경한 뒤 재확인했다. 이후 생성한 Production 후보와 별칭 원상복구, 아직 남은 런타임 검증은 위 최신 상태 및 아래 표로 구분한다.

## 현재 확인 결과

| 우선순위 | 항목 | 상태 | 다음 완료 기준 |
| --- | --- | --- | --- |
| P0 | 발송 이력의 서버 소유자 제한 | 별도 main 후보 `c062d7a`에 최소 수정·14개 테스트. 테스트·타입·lint·독립 빌드 통과 | Preview 실제 검증 결과 확인 후 원격 main 반영 범위 결정. 원격 main에는 아직 미반영 |
| P0 | Production OAuth | **2개 등록 메타데이터 재확인**, 민감 보호 유지. 후보 관리자 로그인 후 실제 UI에서 자동 연결·6개 조회 가능 확인 | UI의 연결 검사 결과이며 원본 HTTP 응답·토큰 값 수집이나 쓰기 권한 검증은 아님 |
| P0 | 실발송 차단 | 후보 설정 **false**, UI 실제 전송 선택 불가, PDF 테스트 첨부 1개·dry-run 1회 성공 및 실제 티켓 미생성 표시. 로컬 **36/36** | 00:31 후속 API 검사로 강제 dry-run·동일 키 중복 방지 완료. 실제 발송 금지 유지 |
| P1 | CRM·정상 서명·문서 | 새로고침 후 CRM 연결·LO24123103 실조회, 새 DOCX/PDF 생성·다운로드·서명 해시·A4 1쪽 렌더 확인 완료 | 초기 CRM 표시 갱신의 발생 조건과 PDF CPU % 단위는 후속 개선 |
| P1 | 실제 역할 계정 | 기존 admin·viewer 유지. 지정된 별도 operator 프로필 1개 설정. **admin·operator·viewer 실제 로그인 각 11/11, 총 33/33 통과** | 본인 양성 행·역할 강등·장기 세션 등 추가 사례는 별도 검증 |
| P1 | main 소스 백업 | **bundle 재검증·복원 SHA 재확인, 승인된 Drive 사본과 재다운로드 SHA 확인 완료** | 복구 담당자·보존 정책 지정 |
| P1 | DB·Storage 복구 | **DB34개/1,371행 검증 후 커밋·Storage4개/200개 원격 해시·참조197개 누락0 완료.** 복구 앱 관리자 실로그인·새로고침 유지, Drive 사본 업로드·재다운로드 SHA 확인 완료 | 추가 복구 자격증명 입력 불필요. 복구 operator/viewer·토큰 갱신/재시작·담당자/보존 정책은 후속이며 Production 후보 런타임 검증과 별개 |

이 검토의 변수 조회에는 `vercel env ls production`과 `vercel env ls preview codex/preview-sandbox`를 사용했다. `env pull`과 비밀값 복사는 하지 않았다. 후속 준비에서 발송 boolean만 `false`로 변경하고 목록에서 확인했다. 변수의 등록은 인증 성공을 뜻하지 않으며 현재 프로젝트 설정이 과거 배포에 고정된 환경까지 증명하지 않는다.

## 등록을 마친 설정과 남은 런타임 검증

Vercel의 **`check-server-site` → Settings → Environment Variables → Production**에서 아래 설정을 확인했다. `codex/preview-sandbox`는 Preview 전용 브랜치 범위여서 기존 Preview 항목과 별도로 Production 항목을 등록했다.

| 변수 | 필요한 값 / 조치 | 현재 Production |
| --- | --- | --- |
| `ZENDESK_SUBDOMAIN` | `jiransoft` — 전체 URL이 아닌 서브도메인 문자열 | 등록됨 |
| `ZENDESK_OAUTH_CLIENT_ID` | Zendesk OAuth 클라이언트의 **Identifier** 값 | 사용자 추가 후 등록 확인 |
| `ZENDESK_OAUTH_CLIENT_SECRET` | 해당 클라이언트의 **전체 Secret**. Vercel의 비밀 변수 입력란에 직접 입력 | 사용자 재발급·추가 후 등록 확인 |
| `ALLOW_REAL_ZENDESK_SEND` | 첫 운영 후보 빌드는 문자열 **`false`** | `false` 변경·재확인 완료 |
| `CLOUDCONVERT_API_KEY` | 앱에 설정된 PDF 변환 서비스용 비밀값 | Production 등록 메타데이터 확인. 설정된 변환 경로의 실제 PDF 생성은 완료했으나 두 공급자 각각의 실검증은 아님 |
| `CONVERTAPI_TOKEN` | 앱에 설정된 PDF 변환 서비스용 비밀값 | Production 등록 메타데이터 확인. 설정된 변환 경로의 실제 PDF 생성은 완료했으나 두 공급자 각각의 실검증은 아님 |

`NEXT_PUBLIC_` 접두사가 붙은 변수로 Secret을 등록하지 않는다. 화면의 클라이언트 이름이나 숫자 ID를 Identifier로 대체하지 않는다. 앞서 제공한 스크린샷의 이름 `check_server`만으로 실제 Identifier도 같다고 확정할 수 없으므로 Zendesk 설정의 Identifier 항목 자체를 확인한다. 비밀번호·Secret을 채팅이나 HTML 보고서로 전달할 필요는 없다.

사용자의 설정 완료 통보 후 다시 조회한 목록에서 Production OAuth 2개는 `Encrypted`였다. 당시 발송값은 `true`였으며 이후 `false`로 변경하고 재확인했다. 목록의 `created` 필드만으로 Secret 수정 여부를 단정하지 않고 새 Preview `2ac8a44`에서 관리자 실제 화면으로 자동 연결·조회 6개 성공과 실발송 차단을 확인했다. 관리자 세션도 복구했다.

Production OAuth 2개는 `type=sensitive`, `target=[production]`, 브랜치 제한 없음으로 확인했다. 앞선 CLI의 `env run` 진단은 민감 변수를 프로세스에 전달받지 못해 **토큰 발급 요청 전에 종료**했다. 이는 Zendesk의 인증 거부 결과가 아니며 Secret 보호를 낮추지 않았다. 이후 민감 보호를 유지한 Production 후보에서 관리자 로그인과 **자동 연결·6개 조회 가능 표시를 실제 UI로 확인했다.** 원본 토큰 응답을 수집한 결과는 아니며 비밀값을 재전달하거나 보호 유형을 바꿀 필요는 없다.

Production 변수는 새 Production 빌드에 적용된다. Preview 성공이나 Preview 변수 등록만으로 자동 승계되지 않는다. 현재 후보는 Production 대상이며 운영 도메인 전환 전에 별도 주소에서 확인한다. 프로젝트 변수 저장만으로 기존 배포의 환경이 바뀌지는 않는다. [Vercel 환경변수 문서](https://vercel.com/docs/environment-variables)

새 코드의 실발송 조건은 `VERCEL_ENV === "production" && ALLOW_REAL_ZENDESK_SEND === "true"`다. Vercel이 설정하는 `VERCEL_ENV`는 직접 추가할 필요가 없다. `false` 상태에서 새 운영 후보를 만들면 티켓·첨부 발송을 차단한 상태로 먼저 검사할 수 있다. 현재 동작 중인 과거 배포는 변수 저장만으로 바뀌지 않는다.

### Zendesk에서 확인할 항목

**Admin Center → Apps and integrations → APIs → OAuth clients**에서 이 앱에 사용 중인 클라이언트를 확인한다.

1. **Client kind = Confidential / 기밀**.
2. Identifier와 전체 Secret이 Vercel에 등록한 값과 같은 클라이언트의 값인지 확인.
3. 첫 조회 검증에 필요한 Allowed scopes에 **`read`** 포함. 실제 발송 전에는 **`read tickets:write ticket_attachments:write`**를 허용해야 한다. 이 문자열은 현재 코드의 요청 범위이며, 지금 쓰기 권한의 실사용까지 검증한 것은 아니다.
4. 클라이언트에 연결된 Zendesk 업무 계정이 활성이고 필요한 그룹·조직·수신자·티켓에 접근 가능한지 확인.

현재 코드는 `client_credentials` 방식이므로 사용자마다 Zendesk 로그인·동의 화면을 거칠 필요가 없다. Redirect URI와 refresh token도 사용하지 않는다. 서버가 30분 수명의 토큰을 요청하고 만료 전 다시 발급받는다. 해당 OAuth 클라이언트에 연결된 사용자의 권한은 여전히 적용된다. [Zendesk 서버 간 OAuth 안내](https://developer.zendesk.com/documentation/authentication/api-tokens-to-oauth/)

**같은 점검 사이트와 같은 Zendesk 계정에 연결하는 경우, Preview에서 검증한 기존 Confidential 클라이언트를 Production에서도 재사용하는 것은 현재 코드 구조상 가능하다.** 다만 Secret 변경·클라이언트 중지 시 두 환경이 함께 영향을 받으므로 운영 자격증명을 별도로 관리하려면 별도 클라이언트를 선택할 수 있다. 새 클라이언트가 반드시 필요한 것은 아니다. 이 판단은 동일한 앱·조직에 한정한다. 저장된 Secret 전체를 찾을 수 없다면 무작정 재발급하지 말고 기존 Preview와 함께 교체할 범위를 먼저 정한다.

Allowed scopes는 요청 가능한 범위의 상한이며, 요청한 범위를 포함하지 않으면 토큰 발급이 거부된다. 범위는 코드의 허용 목록으로 결정하므로 **`ZENDESK_OAUTH_SCOPES` 같은 추가 환경변수는 필요 없다.** [Zendesk OAuth 전환·범위 문서](https://developer.zendesk.com/documentation/authentication/oauth-migration/)

앞선 Preview에서 자동 연결과 다음 6개 조회가 모두 통과했다: 담당 그룹, 고객 조직 자동완성, 시리얼 기반 조직 검색, 수신자, 최근 티켓 이력·수신자 추천, 티켓 필드. 10월 20일 Production 후보의 관리자 패널에서도 같은 6개 항목이 모두 조회 가능으로 표시됨을 확인했다. `users/me` 성공만으로 전체 권한을 통과 처리하지 않았다. 이어 새 문서와 테스트 첨부·dry-run 1회도 확인했다. 실제 Zendesk 쓰기 권한·메일 전달 검증은 수행하지 않았으며 외부 티켓을 만들지 않았다.

## 필요한 실제 계정과 검증 범위

필요한 것은 **점검 사이트의 Supabase 계정**이며 Zendesk 최종 사용자 계정이 아니다. 처음 실제 프로필을 조회했을 때 지정 계정은 유일한 admin이어서 그대로 유지했다. 이후 사용자가 별도 operator 계정을 지정했고 기본 viewer였던 그 프로필 1개만 operator로 설정했다. 기존 admin·viewer 역할은 유지했다. 사용자가 각각 로그인한 뒤 operator·viewer와 복구한 admin 세션 모두 실제 API/RLS 검사 11/11, 합계 33/33을 통과했다. operator는 관리자 조회·타인 문서 파일 발급 403과 타인 문서 직접 DB 조회 0행을 확인했고, viewer의 문서 목록·통합/발송 이력은 403이었다. admin의 조회·소유 문서 URL 발급·직접 DB 1행도 재확인했다. 계정 존재·프로필 조회와 실제 로그인/API 검증은 구분하며 비밀번호는 공유하지 않는다. 이 검토에서는 실제 초대 메일 발송이나 계정 생성을 실행하지 않았다.

| 확인 동작 | operator | viewer | admin |
| --- | --- | --- | --- |
| 발송 이력 API | 본인 발송만, 타인·소유자 없는 행 제외 | 403 | 전체 확인 가능 |
| 개인 문서 목록·업무 이력 | 본인 데이터 | 403 | 개인 목록은 본인, 관리 조회는 별도 경로 |
| 개별 문서 다운로드 | 본인만 | 소유 문서가 있으면 본인만 | 소유자와 관계없이 권한 확인 후 허용 |
| 문서 생성·PDF 재시도·업무 실행 | 허용 범위 내 가능 | 403 | 가능 |
| 관리자 페이지·사용자 초대·설정 | 403 | 403 | 가능 |
| 브라우저의 문서 메타 직접 수정·삭제 | DB 권한 차단 | DB 권한 차단 | 브라우저 자격증명은 동일하게 차단 |

실제 검증 시작 시 DB 집계는 전체 발송 이력 41개, 새 operator 소유 0개였다. 이 상태로 실제 API에서 0개가 반환되는 검증은 타인·소유자 없는 이력 차단을 확인하며 본인 행 조회의 양성 검증까지 증명하지는 않는다. 본인·타인 혼합 경계는 14개 모의 경로 테스트로 별도 검증했다. 서로 다른 operator 사이의 양방향 검증까지 하려면 두 번째 operator가 추가로 필요하다. viewer는 문서를 생성할 수 없으므로 본인 다운로드 양성 검증에 사용할 기존 소유 문서가 없다면 그 검사는 미검증으로 남기며, 검사를 위해 운영 자료의 소유자를 바꾸지 않는다.

화면에서 버튼이 숨겨지는 것뿐 아니라 API 직접 요청, 로그인 변경 후 기존 화면, 로그아웃, 역할 변경 뒤 다음 요청, 브라우저 직접 DB 접근을 비교한다. 서버는 요청마다 사용자와 프로필 역할을 다시 확인한다. 모의 역할 테스트나 관리자·비로그인 검증은 실제 operator/viewer 로그인 검증을 대체하지 않는다.

## 백업과 복구 확인

기존 `main-918cdf8.bundle`을 이번 검토에서 다시 검증했다. complete history와 `refs/heads/main`을 확인했으며 별도 `restore-check` 저장소 HEAD도 `918cdf8920b022839150fde46f13b66fea5e5ed3`와 일치한다. bundle SHA-256은 `00cede95a41062f76dd78420ff274384f14caad592bc232d9521b3c2cb1e6a4c`다. 이는 Git 소스 복구 증거이며 앱 실행·DB·Storage 복구 시험은 아니다.

DB·Storage 담당자에게 필요한 정보는 아래와 같다. 연결 비밀번호나 서비스 키를 채팅에 보낼 필요는 없다. 2026-10-16 17:21 KST에 Aside로 확인한 백업 목록에는 물리 백업 7개가 있었다. 최신은 2026-10-16 03:34:17 KST, 가장 오래된 표시는 2026-10-10 03:33:35 KST이며 별도 보관기간 설정값까지 확인한 것은 아니다. PITR은 꺼져 있었다. 최신 복원점은 이날 오후의 서명·역할·정책 변경을 포함한 시점이라고 볼 수 없다. 실제 Restore나 유료 기능 활성화는 실행하지 않았다.

사용자가 **`check_server_recover` — `https://svbxgzgdvrrsjzeyrfsc.supabase.co`**를 별도 복구 대상으로 제공했다. 첫 접근 실패는 사용자 로그인으로 해결됐다. 10월 16일 17:56 KST에는 이름·프로젝트 ref·도쿄 리전 `ap-northeast-1`과 public 테이블 0개·뷰 0개를 UI에서 확인했다. 당시 UI 검사는 Auth 사용자·Storage 객체까지 확인한 검사가 아니었으며, 10월 19일 저장된 연결 정보로 PostgreSQL에 직접 접속해 public 업무 테이블·Auth 사용자·Storage 버킷/객체가 모두 0개임을 읽기 전용으로 추가 확인했다. 다른 관리 스키마나 함수 전체가 없다는 뜻은 아니다. 이 빈 대상 사전 검사 시점에는 원본·대상에 쓰지 않았다. 이후 대상 DB·Storage 복원 완료는 위 최신 결과로 구분한다.

복구 대상과 원본 연결 정보는 **저장·실접속 확인을 마쳤으므로 재입력하지 않는다.** 대상 Storage 키도 준비됐다. 앞선 입력 페이지는 저장만 수행했으며 현재 단계는 별도 복구 프로젝트의 실제 검증이다.

1. 입력 페이지는 loopback에만 열리고 CSRF 보호를 사용한다. 연결 정보는 프로젝트의 Git 무시 파일 `.env.recovery.local`에 보존한다. 이후 원본 PostgreSQL 접속까지 확인했으며 저장된 대상 정보는 유지한다. 서버가 실행 중인 현재 PC에서 사용하는 임시 주소다.
2. 앞선 원본 Dashboard 확인에서는 logical backup 다운로드가 없어 직접 PG 연결을 준비했다. 이후 비밀번호 저장·실접속·custom 아카이브 확보까지 마쳤으며 현재 추가 입력은 필요 없다.

`pg_dump`·`psql` 17.9 도구와 읽기 전용 `scripts/recovery-preflight.mjs`를 준비했고, 대상의 실제 PostgreSQL 인증은 완료했다. 원본/대상 ref·버전·빈 대상을 실제 확인한 뒤 백업과 복원 검증을 진행했다. 10월 16일 Supabase의 Restore to new project UI에서는 완료된 물리 백업 7개와 Restore 버튼만 확인했다. 이 기능은 기존 지정 대상에 쓰는 경로가 아니라 별도 프로젝트를 만드는 기능이며 추가 비용과 복제된 작업의 실행 가능성이 있어 이번 작업에서 누르지 않았다. 전체 백업이 확보되지 않은 동안에는 대상에 스키마나 부분 데이터를 먼저 만들지 않는다. [Supabase 복제 안내](https://supabase.com/docs/guides/platform/clone-project)

| 대상 | 확인할 정보 | 완료 증거 |
| --- | --- | --- |
| Supabase DB | 최신 변경을 담은 전체 백업, 실제 보관 정책·복구 권한 담당자 | 10/16 물리 백업 7개·PITR 꺼짐 기록 보존. 10/19 Physical 7개·최신 03:34:40 KST·Download 없음 확인, 업무 데이터 967행 부분 백업 완료. 이후 Auth 포함 전체 DB 아카이브·34개/1,371행 복원·권한 검증 후 커밋 완료. 이후 복구 앱 관리자 실로그인 완료. operator/viewer·토큰 갱신/재시작은 미검증 |
| Storage | PC 외부 별도 보관 위치·보관기간·담당자 | 10/16 3개 버킷198개 로컬 복원 기록 보존. 10/19 최신4개 버킷200개·63,811,024 bytes 백업 및 원격 업로드/GET 해시200개 일치 완료 |
| 실제 복구 시험 | 지정된 별도 복구 대상, 허용 중단시간과 허용 데이터 손실 | 대상 DB34개/1,371행·FK38·정책19/RLS8·정확한 ACL 및 Storage200개·참조197개 검사 완료. SQL역할4개/Auth 관리 API 사용자10명 일치 통과. 이후 복구 관리자 실제 로그인·새로고침·문서 조회·관련 API를 확인. operator/viewer·토큰 갱신/재시작은 미검증 |
| 배포·비밀 관리 | 이전 배포 ID·운영 별칭, 복구용 자격증명의 조직 내 관리 위치 | 비밀값 없이 복구 담당자·절차 확인 |

DB 자동 백업에는 Storage 파일 내용이 포함되지 않는다. DB 복구는 운영 기록도 과거로 되돌릴 수 있으므로 UI 배포 실패의 첫 대응으로 실행하지 않는다. [Supabase 백업 문서](https://supabase.com/docs/guides/platform/backups)

이번 Storage 백업은 `generated-documents` 185개, `engineer-signatures` 12개, `public-assets` 1개다. 메타데이터 참조 197개에서 누락은 없고 백업 전후 객체 목록·참조는 안정적이었다. ZIP은 13,749,443 bytes, SHA-256은 `ab6d765b3a2f8947ada354921ea5b9fddf90cbe886c9ab87401f97c66b743e7f`다. 별도 로컬 디렉터리로 안전하게 풀어 198개 객체와 증거 파일의 해시를 다시 대조했다. 고객 문서가 포함되므로 조직의 접근이 제한된 백업 위치에 보관해야 한다. **이 문단은 10월 16일 로컬 복원 기록이다.** 당시에는 원격 복구를 수행하지 않았다. 10월 19일 별도 대상 DB·Storage 복원 완료는 위 최신 결과와 구분한다. DB·Storage 백업은 원자적인 단일 시점 스냅샷이 아니다.

앞선 확인 Preview `2ac8a44`는 Ready였고 테스트·검증 스크립트 변경으로 업무 실행 코드는 유지됐다. 이후 현재 Preview 소스는 `0aec007`이며 이를 기반으로 이번 Production 후보를 만들었다. 이전 Preview 전체 214개 테스트와 기존 main 문제 재현 TAP·최소 수정 patch·실제 3역할 결과·Storage 복원 JSON은 HTML 보고서의 `main-readiness/`에 보존했다. 이 214개는 이번 로컬 관련 테스트 36개나 실제 후보 UI·남은 런타임 검사와 구분한다. main 최소 수정 커밋 `c062d7a`는 로컬 후보로만 존재하고 원격 main에는 반영하지 않았다.

현재 알려진 이력 소유자 제한 결함이 있는 이전 main 배포로 되돌리는 것만으로 안전한 복구가 완성되지 않는다. 최소 보안 보완이 포함된 복구 후보도 검증해야 한다. 기존 API token 폐기는 OAuth 전환·운영 안정화·복구 기간 종료 후 검토한다.

## 현재 승인된 후보 검증과 별도 전환 판단 순서

이번 요청의 Production 후보 OAuth·문서·발송 차단 검증은 완료했다. 실제 UI·다운로드 파일과 로컬 검사 증거를 구분해 보존했다. main 병합·운영 도메인 전환·실발송은 자동으로 실행하지 않으며 야간 실제 전송 금지 요청을 유지한다.

1. 완료: 발송 이력 최소 후보 `c062d7a`의 14개·타입·lint·독립 빌드. Preview 전체 214개와 admin·operator·viewer 실제 각 11개, 총 33개 검증. 후보는 원격 main에 미반영이다. **이 최소 후보만 Production에 재배포해도 현재 준비된 `ALLOW_REAL_ZENDESK_SEND=false`가 새 빌드에 적용되므로 메일 발송 가능 상태가 달라진다.** 소스 변경 범위가 작다는 이유로 운영 영향이 없다고 보지 않고 발송 차단 시간과 작업 창을 정해야 한다. 기존 배포에는 새 변수값이 소급되지 않는다.
2. 완료: Production 후보 Ready·별칭 원상복구 후 ID 대조, 관리자 앱 로그인·새로고침·OAuth 6개 조회, CRM 실조회, 새 문서·서명·PDF, 실제 전송 선택 불가와 테스트 첨부 1개·dry-run 1회 성공. 00:17에는 raw HTTP·동일 키 재시도·직접 요청이 별도 미검증이었고, 00:31 후속 API 검사에서 완료했다.
3. 완료: 정상 서명·앱 목록, Storage 198개 백업·로컬 복원, check_server_recover의 연결 저장·PostgreSQL 인증·public/Auth/Storage 빈 상태 읽기 전용 검사. 추가로 업무 데이터 8개 테이블·967행 부분 백업·두 차례 조회 대조, 10파일 ZIP 로컬 복원, 기존 Storage 사본에 대한 196개 참조 대조를 완료했다. **대상 정보 재입력은 불필요**하며 원본 대시보드 로그인도 완료됐다. 이후 전체 DB 백업과 최신 Storage 200개 백업까지 확보했다. 앞선 실패·진단 DB 복원은 롤백했고 REVOKE 보완 후 최종 데이터·권한 검사를 통과해 커밋했다. Storage200개·원격 해시·참조197개 검사도 완료했다. 분리 복구 앱 관리자 실제 로그인까지 완료했고 승인된 Drive 사본의 업로드·재다운로드 크기/SHA 검증도 완료했다. 부분 백업만으로 전체 복구 통과나 main 반영 준비 완료로 처리하지 않는다.
4. **후속 개선·추가 검증:** CRM 초기 연결 표시 갱신의 정확한 발생 조건을 재현하고 PDF CPU % 단위를 보완한다. 동일 키 런타임 재시도와 직접 요청의 강제 차단은 00:31 후속 API 검사에서 완료했다. 실제 전송 금지는 유지한다.
5. 후보 검증 결과와 역할·소유권·검색 범위, 작업 시간·담당자·복구 후보 및 발송 차단 영향을 종합해 main·운영 도메인 전환을 별도로 결정한다. 이번 새 문서·테스트 이력은 앞선 백업 이후 자료이므로 **전환 직전 최신 백업** 확보 여부도 검토한다. 실제 발송은 샌드박스가 없으므로 지정된 테스트 수신처와 실행 범위의 별도 승인 후 검증한다.

## 확인 근거

현재 Production 후보의 안전한 요약 근거(HTML 보고서 폴더 기준):

- `main-readiness/production-candidate-verification-2026-10-19.json`: 후보 Ready·소스 기준·환경 등록 메타데이터·로컬 36개 테스트·별칭 일시 변경과 원상복구 후 ID 대조. 이후 실제 런타임 근거는 다음 자료와 함께 확인한다.
- `main-readiness/production-oauth-runtime-ui-2026-10-20.json`: 실제 관리자 로그인·OAuth 자동 연결·6개 조회 가능 UI.
- `main-readiness/production-crm-runtime-ui-2026-10-20.json`: 새로고침 후 CRM 연결·LO24123103 실제 조회·앱 로그인 유지.
- `main-readiness/production-send-mode-ui-2026-10-20.json`: 조회 권한만 요청·실발송 차단 표시·실제 전송 선택 비활성·dry-run 선택.
- `main-readiness/production-document-file-verification-2026-10-20.json`: DOCX/PDF 다운로드 크기·SHA, 내부 서명 해시와 PDF A4 1쪽 렌더 검증.
- `main-readiness/production-dry-run-runtime-ui-2026-10-20.json`: 테스트 PDF 첨부 1개·dry-run 1회 성공·실제 Zendesk 티켓 미생성 완료 UI. 해당 UI 근거만으로 raw HTTP·직접 요청은 검증하지 않았으며, 후속 api-crm-cpu-direct-api 근거로 보완했다.

오늘 별도 복구의 안전한 집계 증거(HTML 보고서 폴더 기준, 민감 원본 다운로드 링크 없음):

- `main-readiness/recovery-app-login-verification-2026-10-19.json`: 후속 실제 관리자 로그인·새로고침 유지·문서 UI/API.
- `main-readiness/recovery-login-auth-evidence-2026-10-19.json`: 신규 관리자 세션1개·password 인증 claim1개, 식별자/비밀값 없음.
- `main-readiness/recovery-login-isolation-verification-2026-10-19.json`, `recovery-login-runtime-2026-10-19.json`: 대상 전용 연결·외부 업무 자격증명 미주입·실발송 차단.
- `main-readiness/offsite-package-verification-2026-10-19.json`: 로컬 ZIP224개 항목의 별도 압축해제·전체 해시 검증. 외부 업로드 완료 증거와 구분.
- `main-readiness/offsite-download-hash-verification-2026-10-19.json`: Drive에서 실제 재다운로드한 ZIP 크기·SHA의 원본 일치. 외부 사본 완료 근거.
- `main-readiness/offsite-upload-verification-2026-10-19.json`: 실제 4개 업로드·업로드 후 폴더 비공개 재확인·권한 변경 없음, 개별 파일 URL 미추정.

패키지 검증의 `externalUploadPerformed=false`는 생성 당시 기록이다. 최종 업로드·재다운로드 결과를 무효화하지 않으며 과거 ZIP/manifest를 소급 수정하지 않았다. 최신 로그인 JSON도 Drive에 별도 파일로 보관했다.

- `main-readiness/db-restore-verification-2026-10-19.json`: 실제 DB COMMIT·데이터·FK/RLS/ACL 검증.
- `main-readiness/storage-restore-verification-2026-10-19.json`: 원격 파일 200개 GET 해시·HTTP 메타데이터·버킷 설정.
- `main-readiness/target-final-reference-verification-2026-10-19.json`: 새 읽기 전용 연결에서 참조197개 누락0.
- `main-readiness/target-role-policy-verification-2026-10-19.json`: 11시대 SQL 역할/claims 4개. 이 기록 당시에는 실제 비밀번호 로그인 미검증.
- `main-readiness/target-auth-api-verification-2026-10-19.json`: Auth 관리 API HTTP200·사용자10명·DB ID 집합 일치.
- `main-readiness/target-data-api-verification-2026-10-19.json`: 실제 Data API 8/8·967행 집계 일치, 반환 행0.
- `main-readiness/target-schema-cache-reload-2026-10-19.json`: 대상에만 스키마 캐시 갱신, 데이터·권한 변경 없음.

- `src/lib/env.ts:7`, `:20`: OAuth 필수 변수와 실발송 gate.
- `src/lib/server/zendesk-oauth.ts:7`, `:16`, `:41`, `:124`: 변수명·코드 고정 scope·client credentials 요청·자동 토큰 재발급.
- `src/lib/server/zendesk.ts:61`: 별도 쓰기 없이 6개 조회 권한 검사.
- `src/app/api/zendesk/connection/route.ts:12`: 관리자 연결 확인.
- `src/lib/server/api.ts:76`: 실제 인증과 profile 역할 재조회.
- `src/app/api/history/ticket-sends/route.ts:9`, `:18`: operator 이상·admin 외 소유자 필터(검토 시작 기준).
- `src/app/api/documents/route.ts:27`, `src/app/api/documents/[id]/download/route.ts:28`, `:53`: 목록과 개별 다운로드의 역할/소유권 경계.
- `src/app/api/admin/invitations/route.ts:21`, `:116`: 관리자 초대·초대 URL 선택. 계정 준비가 필요하면 초대 메일의 실제 전송과 redirect 허용 목록도 따로 확인한다.
- `docs/MAIN_ROLLOUT_REVIEW_2026-10-16.md`: 기존 운영 배포, 공유 DB, 백업, 단계별 전환 검토.
- `scripts/export-recovery-app-data.mjs`, `tests/recovery-app-data-export.test.mjs`: 2026-10-19 원본 GET 전용 부분 백업과 11개 회귀 검사.
- HTML 보고서 폴더의 `main-readiness/app-data-backup-2026-10-19/manifest.json`: 8개 테이블 건수·SHA-256·두 차례 대조·백업 범위와 한계. 실제 데이터 행은 이 문서에 포함하지 않음.
- 같은 폴더의 `main-readiness/app-data-local-restore-verification-2026-10-19.json`: 부분 백업 ZIP 10파일의 별도 로컬 복원·해시 일치 및 기존 Storage 사본과 196개 참조 대조. 원격 복원·현재 원격 Storage 재조회는 포함하지 않음.

위 행 번호는 `d294d6b` 기준이며 후속 보완으로 달라질 수 있다. PKM 프로젝트 조회는 미등록(null)이어서 별도 지식 기록을 생성하지 않았다.
