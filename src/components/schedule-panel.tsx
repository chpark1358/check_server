"use client";

import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, CircleHelp, ExternalLink, Eye, Link2, Loader2, LockKeyhole, RefreshCw, RotateCcw, Search, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DetailDrawer } from "@/components/detail-drawer";
import { defaultScheduleFilters, type ScheduleCategory, type ScheduleFilters, type ScheduleItem, type ScheduleOverview } from "@/lib/schedule-types";

export type SchedulePanelProps = {
  overview: ScheduleOverview | null;
  filters: ScheduleFilters;
  onFiltersChange: (filters: ScheduleFilters) => void;
  onSearch: () => void;
  onRefresh: () => void;
  onPageChange: (page: number) => void;
  loading: boolean;
  error: { message: string; status?: number } | null;
  role: string | null;
};

const categoryNames: Record<ScheduleCategory | "all", string> = {
  review: "검토할 일정", hold: "미실시·보류", partner: "협력사 기록", completed: "완료 기록", all: "전체 기록",
};
const rangeNames: Record<ScheduleFilters["range"], string> = {
  "7d": "향후 7일", "30d": "향후 30일", all: "전체 기간", custom: "기간 지정",
};
const selectClass = "h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50";

function timestampLabel(value: string | null) {
  if (!value) return "아직 조회하지 않음";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "조회 시각 확인 필요";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date) + " KST";
}

function sourceLink(overview: ScheduleOverview | null) {
  if (!overview) return null;
  try {
    const url = new URL(overview.source.url);
    return url.protocol === "https:" && url.hostname === "docs.google.com" &&
      url.pathname === "/spreadsheets/d/" + overview.source.spreadsheetId + "/edit"
      ? url.href : null;
  } catch { return null; }
}

function sameFilters(left: ScheduleFilters, right: ScheduleFilters) {
  return left.range === right.range && left.category === right.category &&
    left.q.trim().toLowerCase() === right.q.trim().toLowerCase() && left.pageSize === right.pageSize &&
    (left.range !== "custom" || (left.from === right.from && left.to === right.to));
}

function CategoryBadge({ item }: { item: ScheduleItem }) {
  const needsReview = item.issues.length > 0;
  const Icon = needsReview ? TriangleAlert : item.category === "completed" ? CheckCircle2 : CircleHelp;
  return <span className={"inline-flex items-center gap-1.5 text-xs font-medium " + (needsReview ? "text-amber-700 dark:text-amber-400" : item.category === "completed" ? "text-primary" : "text-muted-foreground")}>
    <Icon className="size-4 shrink-0" aria-hidden />{categoryNames[item.category]}
  </span>;
}

function itemNote(item: ScheduleItem) {
  if (item.issues.length) return item.issues.join(" · ");
  if (item.category === "partner") return "협력사 수행 기록 · 우리 실행 대상으로 판단하지 않음";
  if (item.category === "hold") return "미실시 사유와 이후 계획을 확인하세요.";
  if (item.category === "completed") return "원본 시트의 완료 표기 기준";
  return "대략 예정 시기 · 실제 수행 범위 확인";
}

export function SchedulePanel({ overview, filters, onFiltersChange, onSearch, onRefresh, onPageChange, loading, error, role }: SchedulePanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const unauthorized = error?.status === 401 || error?.status === 403 || role === "viewer";
  const available = Boolean(overview && (overview.status === "ready" || overview.stale) && !unauthorized);
  const items = available ? overview!.items : [];
  const selected = items.find(item => item.id === selectedId) ?? null;
  const applied = available ? overview!.filters : null;
  const dirty = Boolean(applied && !sameFilters(filters, applied));
  const customInvalid = filters.range === "custom" && (!filters.from || !filters.to || filters.from > filters.to);
  const sourceUrl = available ? sourceLink(overview) : null;
  const page = applied?.page ?? 1;
  const pageSize = applied?.pageSize ?? filters.pageSize;
  const total = available ? overview!.total : 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = items.length ? (page - 1) * pageSize + 1 : 0;
  const issueCount = available ? overview!.counts.issues : 0;
  const connectionProblem = overview && !available && !unauthorized ? overview.status : null;
  const problemTitle = connectionProblem === "unconfigured" ? "일정 시트 연결이 필요합니다."
    : connectionProblem === "access_denied" ? "Google 원본 시트에 접근할 수 없습니다."
    : connectionProblem === "schema_error" ? "원본 시트의 열 구조를 확인해야 합니다."
    : "일정을 불러오지 못했습니다.";
  function update<K extends keyof ScheduleFilters>(key: K, value: ScheduleFilters[K]) {
    onFiltersChange({ ...filters, [key]: value, page: 1 });
  }
  function openDetails(item: ScheduleItem, trigger: HTMLElement) {
    triggerRef.current = trigger; setSelectedId(item.id); setDetailsOpen(true);
  }

  return <section aria-label="점검 일정" className={"grid min-w-0 items-start gap-5 " + (detailsOpen && selected ? "min-[1440px]:grid-cols-[minmax(0,1fr)_420px]" : "")}>
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card px-4 py-4">
        <div className="min-w-0 space-y-1.5"><div className="flex items-center gap-2 text-sm font-medium"><Eye className="size-4 text-primary" aria-hidden /><span>읽기 전용 일정</span><Badge variant="secondary" className="font-normal">시트 원본 유지</Badge></div>
          <p className="text-sm leading-relaxed text-muted-foreground">영업의 대략적인 예정 시기를 참고해 준비할 점검을 확인하세요. 확정 실행일이나 자동 실행 대상 수를 뜻하지 않습니다.</p>
          {available && <p className="text-xs leading-relaxed text-muted-foreground">{overview!.source.title || "연결된 일정 시트"} · {timestampLabel(overview!.fetchedAt)} 기준{overview!.stale ? " · 마지막 정상 조회 자료" : ""}</p>}
        </div>
        <Button type="button" variant="outline" className="min-h-11 shrink-0" disabled={loading || unauthorized} onClick={onRefresh}>{loading ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : <RefreshCw aria-hidden className="size-4" />}{loading ? "확인 중" : "다시 확인"}</Button>
      </div>

      {unauthorized ? <div role="alert" className="rounded-xl border bg-card p-6"><LockKeyhole className="mb-3 size-6 text-muted-foreground" aria-hidden /><h2 className="font-semibold">{error?.status === 401 ? "로그인 시간이 만료되었습니다." : "일정 조회 권한이 필요합니다."}</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{error?.status === 401 ? "앱에 다시 로그인한 뒤 점검 일정을 확인하세요." : "현재 계정에는 팀 일정 조회가 허용되지 않습니다. 관리자에게 조회 권한을 문의하세요."}</p></div> : <>
        {connectionProblem && !loading && <div role="alert" className="rounded-xl border bg-card p-5 sm:p-6">
          <Link2 className="mb-3 size-6 text-muted-foreground" aria-hidden /><h2 className="text-base font-semibold">{problemTitle}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{overview?.message || "관리자가 Google 읽기 연결과 원본 시트 공유 권한을 확인해야 합니다."}</p>
          {connectionProblem === "unconfigured" && role === "admin" && <div className="mt-4 space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
            <p className="font-medium">Google 읽기 연결 준비</p>
            <ol className="list-decimal space-y-2 pl-5 text-muted-foreground"><li>Google Cloud에서 Sheets API와 조회용 서비스 계정을 준비합니다.</li><li>원본 스프레드시트를 서비스 계정에 <strong className="font-medium text-foreground">뷰어</strong>로 공유합니다.</li><li>Vercel 환경변수에 연결 정보를 등록하고 재배포합니다. 비밀키는 이 화면이나 채팅에 입력하지 않습니다.</li></ol>
            {overview?.setup?.serviceAccountEmail && <p className="break-all">연결 계정: {overview.setup.serviceAccountEmail}</p>}
            {Boolean(overview?.setup?.missing.length) && <p className="break-words text-xs text-muted-foreground">미등록 설정: {overview!.setup!.missing.join(", ")}</p>}
          </div>}
          {role !== "admin" && <p className="mt-3 text-sm text-muted-foreground">관리자에게 연결 설정을 요청하세요.</p>}
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">연결 전에는 실제 일정과 건수를 표시하지 않습니다.</p>
        </div>}

        {error && <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm"><p className="font-medium text-destructive">일정을 불러오지 못했습니다.</p><p className="mt-1 break-words text-muted-foreground">{error.message}</p>{available && <p className="mt-1 text-xs text-muted-foreground">마지막 조회 자료와 입력한 검색 조건을 유지합니다. 기준 시각을 확인한 뒤 다시 시도하세요.</p>}</div>}
        {available && overview!.stale && <div role="status" className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden /><div><p className="font-medium">최신 자료를 확인하지 못했습니다.</p><p className="mt-1 text-muted-foreground">{overview!.message || "마지막으로 정상 조회한 자료를 표시합니다."} 기준: {timestampLabel(overview!.fetchedAt)}</p></div></div>}
        {available && !overview!.stale && overview!.message && <div role="status" className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden /><p className="leading-relaxed text-muted-foreground">{overview!.message}</p></div>}

        {(available || loading || !overview) && <>
          {available && <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="기간과 검색어 기준 집계">
            {([ ["검토 기록", overview!.counts.review], ["확인 필요", issueCount], ["미실시·보류", overview!.counts.hold], ["협력사 기록", overview!.counts.partner], ["완료 기록", overview!.counts.completed] ] as const).map(([label, count]) => <div key={label} className="rounded-xl border bg-card px-4 py-3"><p className="text-xs text-muted-foreground">{label}</p><p className={"mt-1 text-2xl font-semibold tabular-nums " + (label === "확인 필요" && count ? "text-amber-700 dark:text-amber-400" : "")}>{count.toLocaleString("ko-KR")}<span className="ml-1 text-xs font-normal text-muted-foreground">건</span></p></div>)}
          </div>}
          {available && <p className="text-xs leading-relaxed text-muted-foreground">집계는 적용한 기간·검색어의 모든 분류를 포함합니다. ‘확인 필요’는 다른 분류와 중복될 수 있습니다.</p>}
          <form className="space-y-3 rounded-xl border bg-card p-4" onSubmit={event => { event.preventDefault(); if (!loading && !customInvalid) onSearch(); }}>
            <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(140px,1fr)_minmax(150px,1fr)_minmax(200px,2fr)_auto]">
              <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">예정 시기</span><select className={selectClass} value={filters.range} onChange={event => update("range", event.target.value as ScheduleFilters["range"])}>{Object.entries(rangeNames).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">기록 분류</span><select className={selectClass} value={filters.category} onChange={event => update("category", event.target.value as ScheduleFilters["category"])}>{Object.entries(categoryNames).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">고객사·시리얼</span><div className="relative"><Search className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground" aria-hidden /><Input className="h-11 pl-9" value={filters.q} maxLength={200} onChange={event => update("q", event.target.value)} placeholder="고객사 또는 시리얼 검색" /></div></label>
              <Button type="submit" className="min-h-11 px-5" disabled={loading || customInvalid}>조회</Button>
            </div>
            {filters.range === "custom" && <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1.5"><span className="text-xs text-muted-foreground">시작일 (KST)</span><Input type="date" className="h-11" value={filters.from} aria-invalid={customInvalid} aria-describedby="schedule-date-hint" onChange={event => update("from",event.target.value)} /></label><label className="space-y-1.5"><span className="text-xs text-muted-foreground">종료일 (해당 날짜 포함)</span><Input type="date" className="h-11" value={filters.to} aria-invalid={customInvalid} aria-describedby="schedule-date-hint" onChange={event => update("to",event.target.value)} /></label></div>}
            {filters.range === "custom" && <p id="schedule-date-hint" className={"text-xs " + (customInvalid ? "text-destructive" : "text-muted-foreground")}>{customInvalid ? "시작일과 종료일을 확인하세요. 종료일은 시작일보다 빠를 수 없습니다." : "한국 표준시 기준으로 시작일과 종료일을 모두 포함합니다."}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{dirty ? "조건 변경됨 · 조회를 눌러 적용하세요." : applied ? `${rangeNames[applied.range]} · ${categoryNames[applied.category]} · 예정 시기 순` : "원하는 기간과 분류를 선택하세요."}</p><Button type="button" variant="ghost" className="min-h-11 px-2 text-muted-foreground" disabled={loading} onClick={() => onFiltersChange({...defaultScheduleFilters})}><RotateCcw className="size-4" aria-hidden />조건 초기화</Button></div>
          </form>
          <div className="overflow-hidden rounded-xl border bg-card" aria-busy={loading}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-4"><h2 ref={headingRef} tabIndex={-1} className="text-sm font-semibold outline-none">확인할 예정 기록</h2>{available && <span className="text-xs text-muted-foreground">조회 조건에 맞는 {total.toLocaleString("ko-KR")}건</span>}</div>
            {loading && <p role="status" className="border-b px-4 py-3 text-sm text-muted-foreground">{available ? "확인 중 · 마지막 조회 자료를 표시합니다." : "점검 일정을 불러오고 있습니다."}</p>}
            {loading && !available && <div aria-hidden className="space-y-4 p-4">{Array.from({length:5},(_,i)=><div key={i} className="h-12 rounded-md bg-muted motion-safe:animate-pulse" />)}</div>}
            {items.length > 0 ? <>
              <div className="hidden max-h-[640px] overflow-auto md:block"><table className="w-full min-w-[680px] text-left text-[13px]"><caption className="sr-only">읽기 전용 점검 예정 기록. 고객사를 선택하면 원본 표기와 상세가 열립니다.</caption><thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground"><tr>{["대략 예정 시기", "고객사 · 시리얼", "회차", "기록 분류", "확인할 내용"].map(label=><th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{items.map(item=><tr key={item.id} className={"border-t transition-colors hover:bg-primary/5 " + (detailsOpen && selectedId===item.id ? "bg-primary/10" : "")}>
                <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums">{item.plannedDate || <span className="text-amber-700 dark:text-amber-400">날짜 확인 필요</span>}</td>
                <td className="px-4 py-2"><button type="button" className="flex min-h-11 max-w-64 flex-col justify-center text-left outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring" aria-expanded={detailsOpen && selectedId===item.id} aria-controls={detailsOpen && selectedId===item.id ? "schedule-detail" : undefined} onClick={event=>openDetails(item,event.currentTarget)}><span className="line-clamp-2 font-medium">{item.companyName || "고객사 확인 필요"}</span><span className="mt-1 break-all text-xs text-muted-foreground">{item.serialRaw || "시리얼 공란"}</span></button></td>
                <td className="px-4 py-3">{item.round || "미기록"}</td><td className="px-4 py-3"><CategoryBadge item={item} /></td><td className="max-w-72 px-4 py-3 leading-relaxed text-muted-foreground"><p className="line-clamp-2">{itemNote(item)}</p></td>
              </tr>)}</tbody></table></div>
              <ul className="divide-y md:hidden">{items.map(item=><li key={item.id}><button type="button" className={"w-full space-y-2 p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring " + (detailsOpen && selectedId===item.id ? "bg-primary/10" : "")} aria-expanded={detailsOpen && selectedId===item.id} onClick={event=>openDetails(item,event.currentTarget)}><span className="flex items-start justify-between gap-3"><strong className="min-w-0 font-medium">{item.companyName || "고객사 확인 필요"}</strong><CategoryBadge item={item} /></span><span className="block break-all text-xs text-muted-foreground">{item.serialRaw || "시리얼 공란"} · 회차 {item.round || "미기록"}</span><span className="block text-sm tabular-nums">{item.plannedDate || "날짜 확인 필요"} <span className="text-xs text-muted-foreground">· 대략 예정</span></span><span className="block text-xs leading-relaxed text-muted-foreground">{itemNote(item)}</span></button></li>)}</ul>
            </> : !loading && available && <div className="px-5 py-14 text-center"><CalendarDays className="mx-auto mb-3 size-6 text-muted-foreground" aria-hidden /><p className="font-medium">조건에 맞는 예정 기록이 없습니다.</p><p className="mt-2 text-sm text-muted-foreground">기간이나 기록 분류를 바꾸고 다시 조회하세요. 예정 기록은 실제 점검 완료 여부와 별개입니다.</p></div>}
            {available && <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3"><span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">{first}–{first ? first+items.length-1 : 0}건 표시 · {page}/{pageCount}페이지</span><div className="flex gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={loading || dirty || page<=1} onClick={()=>onPageChange(page-1)}><ArrowLeft aria-hidden />이전</Button><Button type="button" variant="outline" className="min-h-11" disabled={loading || dirty || page>=pageCount} onClick={()=>onPageChange(page+1)}>다음<ArrowRight aria-hidden /></Button></div></footer>}
          </div>
        </>}
        {available && <div className="flex flex-wrap items-center justify-between gap-3 text-xs leading-relaxed text-muted-foreground"><p>{overview!.refreshAfterSeconds > 0 ? `원본 갱신까지 최대 ${Math.ceil(overview!.refreshAfterSeconds/60)}분 동안 같은 조회 자료를 사용합니다.` : "다시 확인하면 원본 조회 상태를 확인합니다."}</p>{sourceUrl && <a className="inline-flex min-h-11 items-center gap-1.5 font-medium text-primary underline underline-offset-4" href={sourceUrl} target="_blank" rel="noopener noreferrer">원본 시트 열기<ExternalLink className="size-3.5" aria-hidden /></a>}</div>}
      </>}
      <p className="text-xs leading-relaxed text-muted-foreground">‘실제 수행 주체’는 점검 후 기록하는 값입니다. 공란을 사전 담당자 누락으로 판단하지 않으며, X/x 기록을 자동으로 재시도하지 않습니다.</p>
    </div>
    <DetailDrawer id="schedule-detail" open={detailsOpen && Boolean(selected)} onOpenChange={setDetailsOpen} title="일정 상세" description="원본 시트의 예정 시기와 수행 기록" returnFocus={()=>triggerRef.current?.isConnected ? triggerRef.current : headingRef.current}>
      {selected && <div className="space-y-5"><div><CategoryBadge item={selected} /><h3 className="mt-3 text-lg font-semibold">{selected.companyName || "고객사 확인 필요"}</h3><p className="mt-1 break-all text-sm text-muted-foreground">{selected.serialRaw || "시리얼 공란"}</p></div>
        <dl className="grid grid-cols-[105px_minmax(0,1fr)] gap-x-3 gap-y-3 text-[13px]">{[["대략 예정 시기",selected.plannedDateRaw],["점검 회차",selected.round],["완료 여부 원본",selected.completionRaw],["실제 점검일",selected.completedDateRaw],["실제 수행 주체",selected.executorRaw],["계약 시작일",selected.contractStartRaw],["계약 만료일",selected.contractEndRaw]].map(([label,value])=><div key={label} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="break-words">{value || "공란"}{label==="실제 수행 주체" && <p className="mt-1 text-xs text-muted-foreground">점검 후 기록하는 항목</p>}</dd></div>)}</dl>
        <div className="rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed"><p>{itemNote(selected)}</p><p className="mt-2 text-xs text-muted-foreground">예정 시기를 실제 실행일로 확정하거나, 과거 수행 주체를 앞으로의 담당자로 배정하지 않습니다.</p></div>
        {selected.issues.length>0 && <div><h3 className="text-sm font-semibold">원본 확인이 필요한 항목</h3><ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-muted-foreground">{selected.issues.map((issue,index)=><li key={index}>{issue}</li>)}</ul></div>}
        {selected.notes && <div className="border-t pt-4"><h3 className="mb-2 text-sm font-semibold">특이사항 · 비고</h3><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{selected.notes}</p></div>}
        <div className="space-y-2 border-t pt-4 text-xs text-muted-foreground"><p>원본 위치: 조회 당시 {selected.sourceRow}행 · 시트 정렬 시 위치가 달라질 수 있습니다.</p><p>조회 기준: {timestampLabel(overview?.fetchedAt ?? null)}</p>{sourceUrl && <a className="inline-flex min-h-11 items-center gap-2 font-medium text-primary underline underline-offset-4" href={sourceUrl} target="_blank" rel="noopener noreferrer">원본 시트 확인<ExternalLink className="size-3.5" aria-hidden /></a>}</div>
      </div>}
    </DetailDrawer>
  </section>;
}
