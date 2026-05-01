# UI 리디자인 plan + 진행상황

> **목표**: UX와 정보 구조는 그대로 두고 외관(가독성·입체감·일관성)만 갈아끼운다. shadcn/ui를 베이스로 채택해 운영 도구에 맞는 깔끔한 시각 톤을 확보한다.
>
> 진행하면서 각 단계의 결과를 이 문서 하단 "진행 로그"에 누적해 적는다. (마지막 업데이트 시점 = HEAD)

---

## 1. 결론

- **shadcn/ui 도입** — Radix UI primitives 위에 Tailwind 4로 작성된 컴포넌트를 우리 코드에 직접 복사해 사용. 라이브러리 lock-in 없음, 우리 코드 안에서 자유롭게 수정 가능, 접근성·키보드 동작 무료.
- 우리 강조색(`#0f7b6c`, 짙은 청록)을 디자인 토큰으로 등록해 그대로 가져간다.
- 단계적 마이그레이션 — 한 화면(메일 발송)부터 컴포넌트 단위로 교체. 코드 안 깨지게 점진 진행.
- 기존 `.input/.primary-button/.secondary-button/.danger-button` utility는 마이그레이션 끝나면 제거.

## 2. 비목표

- UX·정보 구조 변경 X (탭, 패널, 흐름, 클릭 시 동작 모두 동일)
- 새 기능 추가 X
- 다크모드 전환은 1차 범위 외 (토큰만 다크 변수도 같이 정의해두고 토글은 추후)

## 3. 도입 라이브러리

| 패키지 | 용도 |
|---|---|
| `class-variance-authority` | 버튼 variant 정의 (primary/secondary/destructive/ghost/outline 등) |
| `clsx`, `tailwind-merge` | className 병합 (`cn()` helper) |
| `lucide-react` | 아이콘 (현재 0개 → 핵심 액션에 의미 부여용 소수 도입) |
| `@radix-ui/react-*` | Tabs, Dialog, Select, Label 등 unstyled primitives |
| `tw-animate-css` 또는 native | 마이크로 모션 (CSS transition 우선, 필요 시) |
| `sonner` (선택) | toast 알림 — 현재 inline `<Alert>`를 보존하므로 1차에는 미도입 |

## 4. 디자인 토큰 (Tailwind 4 `@theme` 활용)

`globals.css`에 oklch 기반 토큰 정의. 색은 shadcn 기본(zinc neutral) + 우리 accent.

```
--color-bg            : #f7f8fb           /* 현재값 유지 */
--color-foreground    : oklch(0.21 0.025 260)
--color-muted         : oklch(0.55 0.012 260)
--color-card          : #ffffff
--color-border        : oklch(0.92 0.005 260)   /* 현재 #d8dee9 보다 살짝 약함 */
--color-ring          : oklch(0.55 0.13 175)    /* accent와 같은 hue */
--color-primary       : oklch(0.45 0.10 175)    /* #0f7b6c 근사 */
--color-primary-fg    : #ffffff
--color-destructive   : oklch(0.55 0.18 27)     /* red */
--shadow-sm           : 0 1px 2px rgb(15 23 42 / 0.04)
--shadow-md           : 0 1px 3px rgb(15 23 42 / 0.06), 0 4px 12px rgb(15 23 42 / 0.04)
--radius              : 8px                     /* 현재 6px 보다 살짝 부드럽게 */
```

타이포 스케일: 12 / 14 / 16 / 18 / 24 / 30 (Tailwind 기본). 한 화면 내 4단계 이내로 절제.

## 5. 컴포넌트 매핑

| 현재 | 신규 (shadcn) | 비고 |
|---|---|---|
| `<input className="input">` | `<Input />` | focus ring + emerald 그대로 |
| `<textarea className="input">` | `<Textarea />` | |
| `<select className="input">` | `<Select>` (Radix) | 키보드 nav 무료 |
| `.primary-button` | `<Button>` (default) | |
| `.secondary-button` | `<Button variant="outline">` | |
| `.danger-button` | `<Button variant="ghost">` text-red | |
| custom `<Panel>` | `<Card>` + `<CardHeader>` + `<CardContent>` | 내부 `<CardTitle>`로 제목 |
| custom `<Field>` | `<Label>` + 자식 input | |
| custom `<StatusBadge>` | `<Badge variant=...>` | tone → variant |
| custom `<Alert>` | `<Alert variant=...>` (Radix) | role=status |
| custom `<InfoRow>` | 그대로 둠 (작은 레이블+값 — shadcn에 정확 매칭 없음) | 스타일만 다듬음 |
| Tabs (`<button>` 2개) | `<Tabs>` (Radix) | URL 동기화 추후 |
| 최종 확인 modal | `<Dialog>` (Radix) | focus trap, ESC 닫기 무료 |
| 점검자 dropdown | `<Select>` | 한글 검색 가능 |

## 6. 작업 단계

| Phase | 내용 | 산출 |
|---|---|---|
| **U0** | 의존성 설치, shadcn init, globals 토큰, `cn()` helper | components.json, src/lib/utils.ts |
| **U1** | 베이스 컴포넌트 add (button, input, label, textarea, card, tabs, dialog, badge, alert, select, separator, skeleton) | src/components/ui/* |
| **U2** | `MailConsole` 인증 카드 (로그인 화면) 마이그레이션 | 첫 화면 적용 검증 |
| **U3** | `CheckFlowPanel` (좌측 점검 흐름) 마이그레이션 | |
| **U4** | `MailConsole` 점검 데이터 탭 (확인서 생성 + 생성 문서) | |
| **U5** | `MailConsole` 메일 발송 탭 (조직 검색/요청자/본문/첨부/발송 설정/최종 확인 dialog) + 발송 이력 | |
| **U6** | 헤더(title/badge), 글로벌 background, 인쇄/대화면 균형 | |
| **U7** | `globals.css` legacy class 제거, 미사용 의존 정리 | |
| **U8** | 검증: typecheck/lint/build + 자동 a11y(`web-design-guidelines` skill) + 배포 | production 적용 |

## 7. 위험 / 롤백

- **Tailwind 4 + shadcn/ui 호환성** — 최근에 안정화됐으나 일부 변형은 Tailwind 3 기준 코드. shadcn CLI가 4 감지 시 새 디렉티브로 생성하지만 한 두 군데는 손봐야 할 수 있음.
- **React 19** — Radix 1.1+에서 React 19 호환. 안 맞는 패키지 발견 시 즉시 명시.
- **롤백 단위** = phase 단위. 각 phase 끝나면 commit. 문제 시 해당 phase만 revert.
- **UX 변화 의심** — 사용자가 한 번씩 봐주시면 즉시 조정.

## 8. 검증 체크리스트

- [ ] typecheck/lint/build 통과
- [ ] 점검자 로그인 흐름 (Solution + Supabase)
- [ ] 점검 데이터 가져오기 → 확인서 생성 → Storage 업로드 → 자동 첨부
- [ ] 조직 검색 → 요청자 자동 매칭 → 메일 본문 → dry-run 발송
- [ ] 모달 ESC/외부 클릭 닫기, focus trap
- [ ] Tab 키로만 모든 인터랙션 가능
- [ ] dialog 열릴 때 body scroll lock
- [ ] 모바일/태블릿 좁은 화면에서 깨짐 없음
- [ ] 다크모드 토큰 정의 (실 토글은 추후)

---

## 9. 진행 로그

> 새 단계 끝날 때마다 짧게 추가. 사진/스크린샷은 운영자가 직접 보는 것을 전제로 하고, 여기는 텍스트로 변경 요점만.

### 2026-05-01 — Plan 작성

- 본 문서 초안 작성. shadcn/ui 도입 결정.

### 2026-05-01 — U0 / U1 / U2 완료

**U0 — shadcn init**
- `npx shadcn@latest init --defaults` (Tailwind 4, Next 16 자동 감지)
- 추가된 의존성: `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `tw-animate-css`, `@base-ui/react`(Base UI primitives) 등
- 새 파일: `components.json` (style: `base-nova`, baseColor: `neutral`, icon: `lucide`), `src/lib/utils.ts` (`cn()`)
- 수정된 파일:
  - `src/app/globals.css` — 디자인 토큰 redefine (oklch primary/ring을 우리 emerald `#0f7b6c` 톤으로 조정), `@theme inline` 매핑, dark mode 토큰 (토글은 추후), `tw-animate-css` import. legacy `.input/.primary-button/.secondary-button/.danger-button`은 일단 보존(U7에서 제거 예정).
  - `src/app/layout.tsx` — Geist 폰트 추가 (`next/font/google`), `<html>`에 `font-sans` + `--font-sans` 변수 적용
- typecheck/lint 통과

**U1 — 베이스 컴포넌트 12개 추가**
- `npx shadcn@latest add button input textarea label select card tabs dialog badge alert separator skeleton`
- 위치: `src/components/ui/`
- Button variants: `default | outline | secondary | ghost | destructive | link`, sizes `default | xs | sm | lg | icon | icon-xs | icon-sm | icon-lg`
- Alert variants: `default | destructive` (성공 톤은 별도 작업 시 추가 또는 인라인 className으로 처리)
- typecheck/lint 통과

**U2 — 인증 카드 마이그레이션**
- `MailConsole`의 운영자 로그인 화면 (`!session`일 때 표시되는 카드)을 shadcn 컴포넌트로 교체
- 변경: `<section>` + 직접 만든 `Field` + `<input className="input">` + `.primary-button` → `Card / CardHeader / CardTitle / CardDescription / CardContent / Label / Input / Button`
- `Alert`은 외부에서 import한 shadcn 버전을 `UIAlert`로 alias (기존 internal `Alert` 함수와 이름 충돌 회피)
- size="lg" 적용해 버튼이 입력 필드와 시각적 균형

### 2026-05-01 — U3 ~ U8 완료 (one-shot 마이그레이션)

**U3 — `CheckFlowPanel` 마이그레이션**
- 외부 `<section>` → `Card` + `CardHeader` + `CardTitle` + `CardContent`
- 토큰 만료 표시 → `Badge variant="outline"` + 60초 임박 시 destructive 톤
- 로그인/로그아웃/시리얼 입력 폼 → `Label` + `Input` + `Button`
- LO prefix 박스를 `inline-flex` + 토큰 색으로 처리
- 결과 요약(`ResultSummary`) 영역의 모든 inline 색을 design token 기반으로 교체 (`bg-muted/40`, `text-muted-foreground` 등)
- 서비스 상태 / 원본 값 / warnings 모두 톤 정리
- 미사용 internal `Field` 제거, `InfoRow`만 보존

**U4 — 점검 데이터 탭**
- 점검자 dropdown: 네이티브 `<select>` → shadcn `Select` (Base UI primitive 기반, `value`/`onValueChange` API). null deselect 케이스는 `?? ""` 후 무시
- 점검 의견 textarea → shadcn `Textarea`
- 제품명 read-only input → shadcn `Input`
- DOCX/PDF 생성 버튼 → `<Button>` (default variant)
- 생성 문서 패널 톤 정리 (`bg-muted/40`, `text-muted-foreground`)
- PDF 미생성 안내 문구 amber 톤으로

**U5 — 메일 발송 탭**
- 상단 탭 (점검 데이터 / Zendesk 메일 발송) 두 button → shadcn `Tabs` + `TabsList` + `TabsTrigger` + `TabsContent`. URL sync는 추후 옵션
- 조직 검색 입력/버튼 → `Input` + `Button` (outline)
- 조직 검색 결과 카드 hover/active를 design token (primary/border)로
- 요청자 dropdown → shadcn `Select` ("__none" sentinel value로 빈 선택 처리)
- 제목 input → shadcn `Input`, 본문 textarea → shadcn `Textarea`
- 첨부 영역 카드: 파일 선택을 hidden input + `Button` 트리거 패턴으로 (Button이 label로 못 들어가서)
- 자동 첨부 배지를 shadcn `Badge` (emerald tone)
- 제거 버튼들을 `Button variant="ghost"` + `text-destructive`로 (이전 `.danger-button`)
- 발송 설정 panel/체크박스/발송 전 확인 버튼/로그아웃 button 모두 토큰 정리
- 발송 이력 카드 스테이터스 `<span>` → shadcn `Badge variant="secondary"`
- 최종 확인 modal: 직접 만든 fixed-overlay → shadcn `Dialog` + `DialogContent` + `DialogHeader` + `DialogFooter` (focus trap / ESC 닫기 / scroll lock 무료)

**U6 — 헤더 + 글로벌 잔손질**
- `<main>` background `bg-[#f5f7fb]` → `bg-background`, text 색도 `text-foreground`
- 헤더 좌측 small label `Zendesk 메일 발송` → `Check Server` (브랜드명, 토큰 primary)
- h1 `tracking-tight` 추가
- header `border-b` 색을 토큰으로

**U7 — legacy CSS 제거**
- `globals.css`에서 `.input / .primary-button / .secondary-button / .danger-button` 모두 제거
- 유일하게 남은 `secondary-button` 사용처 (점검 데이터 탭 좌측 로그아웃) → `Button variant="outline"` 으로 교체
- 미사용 `Separator` import 정리

**U8 — 검증**
- typecheck ✅ / lint ✅ / build ✅ (모든 라우트 등록됨)
- 다음: production redeploy 후 시각 검증

---

### 미해결 / 후속

- 다크모드 토글 (UI 자체) — 토큰은 정의돼 있으나 운영자가 직접 모드 전환 UI 없음. 추후 헤더에 토글 버튼.
- StatusBadge의 `tone="green"` / `tone="orange"` 매핑이 inline className으로 처리됨 — 향후 Badge에 `success` / `warning` variant 정식 추가 권장
- 일부 inline 색이 amber/emerald Tailwind 색에 의존 (정상/이상 표시 등). 토큰 시스템에 success/warning 색 추가하면 더 깔끔
- toast (sonner) 미도입 — notice/error를 `Alert` inline으로 유지. 사용자 피드백 강한 알림이 필요해지면 도입
