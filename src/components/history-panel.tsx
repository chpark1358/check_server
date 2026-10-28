"use client";

import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, CircleDashed, Copy, Download, ExternalLink, FlaskConical, History, Loader2, RotateCcw, Search, TriangleAlert, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DetailDrawer } from "@/components/detail-drawer";
import { formatAutoSolveRecord, formatCcRecipients, type AutoSolveOutcome, type CcRecipientRecord } from "@/lib/ticket-send-presentation";
import { HISTORY_PAGE_SIZES } from "@/lib/history-export";

export type HistoryItem = AutoSolveOutcome & CcRecipientRecord & {
  id: string;
  type: "check" | "document" | "mail";
  action: string;
  status: string;
  actorEmail: string | null;
  companyName: string;
  serial: string | null;
  organizationId?: string | null;
  title: string;
  summary: string;
  targetId: string | null;
  ticketUrl?: string | null;
  documentId?: string | null;
  createdAt: string;
};

export type HistoryAppliedFilters = {
  range: string;
  from?: string | null;
  to?: string | null;
  type: string;
  status: string;
  q: string;
  sort?: string;
  limit?: number;
  timezone?: string;
  asOf?: string;
};

export type HistoryOverview = {
  summary: { checks: number; documents: number; mails: number; failures: number } | null;
  items: HistoryItem[];
  hasMore?: boolean;
  nextCursor?: string | null;
  appliedFilters?: HistoryAppliedFilters;
};

export type HistoryPanelProps = {
  overview: HistoryOverview | null;
  range: string;
  type: string;
  status: string;
  query: string;
  busy: boolean;
  onRangeChange: (value: string) => void;
  onTypeChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  from?: string;
  to?: string;
  sort?: string;
  onFromChange?: (value: string) => void;
  onToChange?: (value: string) => void;
  onSortChange?: (value: string) => void;
  loading?: boolean;
  error?: string | null;
  pageNumber?: number;
  canPrevious?: boolean;
  hasMore?: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  onReset?: () => void;
  appliedFilters?: HistoryAppliedFilters;
  pageSize?: number;
  onPageSizeChange?: (value: number) => void;
  exportBusy?: boolean;
  exportCount?: number;
  exportError?: string | null;
  exportNotice?: string | null;
  onExport?: (scope: "page" | "filtered") => void;
  onCancelExport?: () => void;
};

const selectClass = "h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50";
const rangeNames: Record<string, string> = { today: "오늘", "7d": "최근 7일", "30d": "최근 30일", "90d": "최근 90일", "365d": "최근 1년", all: "전체 기간", custom: "기간 지정" };
const typeNames: Record<string, string> = { check: "점검 조회", document: "문서 생성", mail: "메일 처리" };
const statusNames: Record<string, string> = { success: "성공", failed: "실패", dry_run: "테스트", pending: "처리 대기", completed: "완료" };

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "시각 확인 불가" : new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function mailSolveStatus(item: HistoryItem) {
  return item.autoSolveStatus ?? (item.autoSolveRequested === false ? "not_requested" : "unknown");
}

function Status({ item }: { item: HistoryItem }) {
  const { status } = item;
  if (item.type === "mail" && status === "success") {
    const solveStatus = mailSolveStatus(item);
    const needsReview = solveStatus === "failed" || solveStatus === "unknown";
    const Icon = needsReview ? TriangleAlert : CheckCircle2;
    const label = solveStatus === "failed" ? "티켓 생성 · 해결 실패" : solveStatus === "unknown" ? "티켓 생성 · 해결 미확인" : solveStatus === "solved" ? "티켓 생성 · 자동 해결 완료" : "티켓 생성";
    return <span className={"inline-flex max-w-48 items-start gap-1.5 text-xs font-medium " + (needsReview ? "text-amber-700 dark:text-amber-400" : "text-primary")}><Icon className="size-4 shrink-0" aria-hidden /><span>{label}</span></span>;
  }
  const Icon = status === "failed" ? XCircle : status === "dry_run" ? FlaskConical : status === "pending" ? CircleDashed : CheckCircle2;
  return <span className={"inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium " + (status === "failed" ? "text-destructive" : status === "success" || status === "completed" ? "text-primary" : "text-muted-foreground")}><Icon className="size-4 shrink-0" aria-hidden />{statusNames[status] ?? status}</span>;
}

function MailOutcomeDetails({ item }: { item: HistoryItem }) {
  if (item.type !== "mail") return null;
  const recordNote = formatAutoSolveRecord(item);
  if (item.status !== "success") {
    return recordNote ? <p className="text-xs leading-relaxed text-muted-foreground">{item.status === "dry_run" && "테스트 처리이며 실제 자동 해결은 실행하지 않았습니다. "}{recordNote}</p> : null;
  }
  const solveStatus = mailSolveStatus(item);
  const needsReview = solveStatus === "failed" || solveStatus === "unknown";
  const explanation = solveStatus === "failed"
    ? "티켓은 생성되었지만 자동 해결에 실패했습니다. 새 티켓을 다시 만들지 말고 기존 Zendesk 티켓을 확인하세요."
    : solveStatus === "unknown"
      ? "티켓은 생성되었지만 자동 해결 결과를 확인할 수 없습니다. 기존 Zendesk 티켓의 상태를 확인하세요."
      : solveStatus === "solved"
        ? "티켓 생성 후 자동 해결 완료가 기록되었습니다. 이후 Zendesk에서 변경된 현재 상태와는 다를 수 있습니다."
        : "티켓이 생성되었습니다. 자동 해결은 요청하지 않았습니다.";
  return <div className={"rounded-lg border p-4 text-sm leading-relaxed " + (needsReview ? "border-amber-500/30 bg-amber-500/5" : "bg-muted/30")}><p>{explanation}</p>{needsReview && item.autoSolveError && <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">{item.autoSolveError}</p>}{recordNote && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{recordNote}</p>}</div>;
}

function safeTicketUrl(value?: string | null) {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" ? url.href : null; } catch { return null; }
}

export function HistoryPanel({ overview, range, type, status, query, busy, onRangeChange, onTypeChange, onStatusChange, onQueryChange, onSearch, from = "", to = "", sort = "newest", onFromChange, onToChange, onSortChange, loading = false, error, pageNumber = 1, canPrevious = false, hasMore = overview?.hasMore ?? false, onPrevious, onNext, onReset, appliedFilters, pageSize = 20, onPageSizeChange, exportBusy = false, exportCount = 0, exportError, exportNotice, onExport, onCancelExport }: HistoryPanelProps) {
  const [exportScope, setExportScope] = useState<"page" | "filtered">("filtered");
  const [selected, setSelected] = useState<HistoryItem | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copyNotice, setCopyNotice] = useState("");
  const triggerRef = useRef<HTMLElement | null>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const items = overview?.items ?? [];
  const summary = overview?.summary;
  const applied = appliedFilters ?? overview?.appliedFilters;
  const pending = loading || busy;
  const customInvalid = range === "custom" && (!from || !to || from > to);
  const filtersChanged = Boolean(applied && (applied.range !== range || applied.type !== type || applied.status !== status || applied.q !== query.trim().toLowerCase() || (applied.sort ?? "newest") !== sort || (range === "custom" && (applied.from !== from || applied.to !== to))));
  const hasFilter = applied ? Boolean(applied.q || applied.type !== "all" || applied.status !== "all" || applied.range !== "all") : Boolean(query || type !== "all" || status !== "all" || range !== "all");
  const openDetails = (item: HistoryItem, trigger: HTMLElement) => { triggerRef.current = trigger; setSelected(item); setCopyNotice(""); setDetailsOpen(true); };
  const ticketUrl = safeTicketUrl(selected?.ticketUrl);
  const appliedRange = applied?.range ?? range;
  const filterChips = [
    appliedRange === "custom" ? (applied?.from ?? from) + " ~ " + (applied?.to ?? to) : rangeNames[appliedRange] ?? appliedRange,
    (applied?.type ?? type) !== "all" ? typeNames[applied?.type ?? type] : null,
    (applied?.status ?? status) !== "all" ? statusNames[applied?.status ?? status] : null,
    (applied?.q ?? query) ? "검색: " + (applied?.q ?? query) : null,
  ].filter(Boolean);
  const metrics: [string, number][] = summary ? [["점검", summary.checks], ["문서", summary.documents], ["메일", summary.mails], ["실패", summary.failures]] : [
    ["표시", items.length], ["성공", items.filter((item) => item.status === "success" || item.status === "completed").length],
    ["실패", items.filter((item) => item.status === "failed").length], ["테스트", items.filter((item) => item.status === "dry_run").length],
  ];
  const firstItem = items.length ? (pageNumber - 1) * (applied?.limit ?? 20) + 1 : 0;
  async function copyId() {
    if (!selected) return;
    try { await navigator.clipboard.writeText(selected.id); setCopyNotice("이벤트 ID를 복사했습니다."); }
    catch { setCopyNotice("복사하지 못했습니다. 표시된 ID를 선택해 복사하세요."); }
  }

  return (
    <section className={"grid min-w-0 items-start gap-5 " + (detailsOpen ? "min-[1440px]:grid-cols-[minmax(0,1fr)_420px]" : "")} aria-label="작업 이력">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" aria-live="polite">
          {metrics.map(([label, value]) => <span key={label} className="inline-flex items-center gap-2"><span className="text-muted-foreground">{label}</span><strong className={label === "실패" && value ? "font-semibold tabular-nums text-destructive" : "font-semibold tabular-nums"}>{value}건</strong></span>)}
          <span className="text-xs text-muted-foreground">{summary ? "조회 조건 전체" : "현재 페이지 기준"}</span>
        </div>
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (!pending && !customInvalid) onSearch(); }}>
          <div className="flex gap-2">
            <label className="relative min-w-0 flex-1"><span className="sr-only">이력 검색어</span><Search className="pointer-events-none absolute top-3.5 left-3.5 size-4 text-muted-foreground" aria-hidden /><Input className="h-11 bg-card pl-10" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="고객사, 시리얼, 티켓 ID, 요약 검색" /></label>
            <Button className="min-h-11 px-5" type="submit" disabled={pending || customInvalid}>{loading ? "조회 중" : "조회"}</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="min-w-36 flex-1"><span className="sr-only">조회 기간</span><select aria-label="조회 기간" className={selectClass} value={range} onChange={(event) => onRangeChange(event.target.value)}>{Object.entries(rangeNames).map(([value, label]) => <option key={value} value={value} disabled={value === "custom" && (!onFromChange || !onToChange)}>{label}</option>)}</select></label>
            <label className="min-w-32 flex-1"><span className="sr-only">이벤트 유형</span><select aria-label="이벤트 유형" className={selectClass} value={type} onChange={(event) => onTypeChange(event.target.value)}><option value="all">모든 작업 유형</option>{Object.entries(typeNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="min-w-32 flex-1"><span className="sr-only">처리 결과</span><select aria-label="처리 결과" className={selectClass} value={status} onChange={(event) => onStatusChange(event.target.value)}><option value="all">모든 상태</option><option value="success">성공</option><option value="failed">실패</option><option value="dry_run">테스트</option><option value="pending">처리 대기</option></select></label>
            {onSortChange && <label className="min-w-28 flex-1"><span className="sr-only">정렬</span><select aria-label="정렬" className={selectClass} value={sort} onChange={(event) => onSortChange(event.target.value)}><option value="newest">최신순</option><option value="oldest">과거순</option></select></label>}
            {onReset && <Button type="button" variant="ghost" className="min-h-11 px-3 text-muted-foreground" disabled={pending} onClick={onReset}><RotateCcw className="size-4" aria-hidden />초기화</Button>}
          </div>
          {range === "custom" && <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1"><span className="text-xs text-muted-foreground">시작일 (KST)</span><Input type="date" className="h-11 bg-card" value={from} onChange={(event) => onFromChange?.(event.target.value)} aria-invalid={customInvalid} aria-describedby="history-date-hint" /></label><label className="space-y-1"><span className="text-xs text-muted-foreground">종료일 (해당 날짜 포함)</span><Input type="date" className="h-11 bg-card" value={to} onChange={(event) => onToChange?.(event.target.value)} aria-invalid={customInvalid} aria-describedby="history-date-hint" /></label></div>}
          {range === "custom" && <p id="history-date-hint" className={"text-xs " + (customInvalid ? "text-destructive" : "text-muted-foreground")}>{customInvalid ? "시작일과 종료일을 입력하세요. 종료일은 시작일보다 빠를 수 없습니다." : "한국 표준시 기준으로 시작일과 종료일을 모두 포함합니다."}</p>}
        </form>
        {(type === "all" || type === "mail" || items.some((item) => item.type === "mail")) && <p className="text-xs leading-relaxed text-muted-foreground">메일의 성공 상태는 티켓 생성을 뜻합니다. 메일 처리의 실패 필터·건수에는 티켓 생성 실패만 포함됩니다. 자동 해결 실패·미확인 기록은 유형 ‘메일 처리’, 상태 ‘성공’으로 조회해 확인하세요.</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5" aria-label="적용된 조회 조건">{filterChips.map((chip, index) => <Badge key={index} variant="secondary" className="rounded-full border border-primary/10 bg-primary/8 px-2.5 py-1 font-normal text-primary">{chip}</Badge>)}</div>
          <p className="text-xs text-muted-foreground">{filtersChanged ? "조건 변경됨 · 조회를 눌러 적용" : applied?.asOf ? "조회 " + dateLabel(applied.asOf) + " KST" : "한국 표준시 (KST)"}</p>
        </div>
        {onExport && <div className="rounded-xl border bg-card px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0"><p className="text-sm font-medium">이력 내보내기</p><p id="history-export-hint" className="mt-1 text-xs leading-relaxed text-muted-foreground">{exportScope === "filtered" ? "적용된 조회 조건 전체 · 최대 5,000건 · 다운로드 시작 시점까지 생성된 이력" : `현재 ${pageNumber}페이지에 표시된 ${items.length}건`}</p></div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <label className="min-w-36 flex-1 sm:flex-none"><span className="sr-only">엑셀 다운로드 범위</span><select aria-label="엑셀 다운로드 범위" className={selectClass} value={exportScope} disabled={exportBusy} onChange={event => setExportScope(event.target.value as "page" | "filtered")}><option value="filtered">조회 조건 전체</option><option value="page">현재 페이지</option></select></label>
              <Button type="button" variant="outline" className="min-h-11" disabled={pending || exportBusy || filtersChanged || Boolean(error) || !items.length} aria-describedby="history-export-hint" onClick={() => onExport(exportScope)}>{exportBusy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Download className="size-4" aria-hidden />}{exportBusy ? "파일 준비 중" : "XLSX 다운로드"}</Button>
              {exportBusy && onCancelExport && <Button type="button" variant="ghost" className="min-h-11" onClick={onCancelExport}>취소</Button>}
            </div>
          </div>
          {exportBusy && <p role="status" className="mt-2 text-xs text-muted-foreground">{exportCount ? `${exportCount.toLocaleString("ko-KR")}건 불러옴 · 엑셀 파일을 준비합니다.` : "이력을 불러오고 있습니다."}</p>}
          {exportError && <p role="alert" className="mt-2 text-sm text-destructive">{exportError}</p>}
          {!exportBusy && exportNotice && <p role="status" className="mt-2 text-xs text-muted-foreground">{exportNotice}</p>}
          {filtersChanged && <p className="mt-2 text-xs text-muted-foreground">변경한 조건으로 먼저 조회한 뒤 다운로드하세요.</p>}
        </div>}
        <p className="sr-only">검색은 원본 이벤트에 저장된 고객사·시리얼·티켓 ID·요약을 대상으로 하며, 메일에 시리얼이 저장되지 않았다면 시리얼 검색에는 포함되지 않습니다.</p>
        <div className="overflow-hidden rounded-xl border bg-card">
          <h2 ref={resultHeadingRef} tabIndex={-1} className="sr-only outline-none">이벤트 {items.length}건 표시</h2>
          <div aria-live="polite">{loading && <p className="border-b px-4 py-3 text-sm text-muted-foreground">{items.length ? "조회 중 · 마지막 조회 결과를 표시합니다." : "이력을 불러오고 있습니다."}</p>}</div>
          {error && <div role="alert" className="border-b border-destructive/20 bg-destructive/5 p-4 text-sm"><p className="font-medium text-destructive">이력을 불러오지 못했습니다.</p><p className="mt-1 break-words text-muted-foreground">{error}</p>{items.length > 0 && <p className="mt-1 text-xs text-muted-foreground">마지막 조회 결과와 입력 조건을 유지합니다.</p>}<Button type="button" variant="outline" className="mt-3 min-h-11" disabled={pending || customInvalid} onClick={onSearch}>다시 조회</Button></div>}
          {items.length > 0 ? <>
            <div className="hidden max-h-[640px] overflow-auto md:block" aria-busy={loading}>
              <table className="w-full min-w-[650px] text-left text-[13px]">
                <caption className="sr-only">개별 점검·문서·메일 이벤트 목록. 고객사를 선택하면 오른쪽 상세가 열립니다.</caption>
                <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground"><tr>{["시간 (KST)", "고객사 · 시리얼", "작업", "상태", "요약"].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
                <tbody>{items.map((item) => {
                  const isSelected = detailsOpen && selected?.id === item.id && selected?.type === item.type;
                  return <tr key={item.type + "-" + item.id} className={"cursor-pointer border-t transition-colors hover:bg-primary/5 " + (isSelected ? "bg-primary/10" : "")} onClick={(event) => openDetails(item, event.currentTarget.querySelector("button") ?? event.currentTarget)}>
                    <td className="w-32 whitespace-nowrap px-4 py-3 text-xs leading-5 tabular-nums text-muted-foreground"><time dateTime={item.createdAt}>{dateLabel(item.createdAt)}</time></td>
                    <td className="px-4 py-2"><button type="button" className="flex min-h-11 max-w-56 flex-col justify-center text-left outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring" aria-expanded={isSelected} aria-controls={isSelected ? "history-detail" : undefined} onClick={(event) => { event.stopPropagation(); openDetails(item, event.currentTarget); }}><span className="line-clamp-1 font-medium text-foreground">{item.companyName || item.title || "상세 보기"}</span><span className="mt-1 text-xs text-muted-foreground">{item.serial || (item.organizationId ? "조직 ID " + item.organizationId : "시리얼 기록 없음")}</span></button></td>
                    <td className="whitespace-nowrap px-4 py-3">{typeNames[item.type]}</td><td className="px-4 py-3"><Status item={item} /></td>
                    <td className="max-w-64 px-4 py-3 leading-relaxed text-muted-foreground"><p className="line-clamp-2">{item.summary || "추가 내용 없음"}</p>{item.type === "mail" && <p className="mt-1 line-clamp-2 break-all text-xs" title={formatCcRecipients(item)}>{formatCcRecipients(item)}</p>}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <ul className="divide-y md:hidden" aria-busy={loading}>{items.map((item) => <li key={item.type + "-" + item.id}><button type="button" className={"w-full space-y-2 p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring " + (detailsOpen && selected?.id === item.id && selected.type === item.type ? "bg-primary/10" : "")} onClick={(event) => openDetails(item, event.currentTarget)}><span className="flex items-start justify-between gap-3"><span className="font-medium">{item.companyName || item.title || "상세 보기"}</span><Status item={item} /></span><span className="block text-xs text-muted-foreground">{item.serial || (item.organizationId ? "조직 ID " + item.organizationId : "시리얼 기록 없음")} · {typeNames[item.type]}</span><span className="line-clamp-2 text-sm">{item.summary || "추가 내용 없음"}</span>{item.type === "mail" && <span className="block break-all text-xs text-muted-foreground">{formatCcRecipients(item)}</span>}<span className="block text-xs text-muted-foreground">{dateLabel(item.createdAt)} KST</span></button></li>)}</ul>
          </> : !loading && !error && <div className="px-5 py-16 text-center"><History className="mx-auto mb-3 size-6 text-muted-foreground" aria-hidden /><p className="font-medium">{hasFilter ? "조건에 맞는 이력이 없습니다." : "아직 작업 이력이 없습니다."}</p><p className="mt-2 text-sm text-muted-foreground">{hasFilter ? "조회 기간을 넓히거나 검색어를 변경해 보세요." : "점검·문서·메일 처리 내역이 여기에 표시됩니다."}</p>{hasFilter && onReset && <Button variant="outline" className="mt-4 min-h-11" onClick={onReset}>필터 초기화</Button>}</div>}
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-muted-foreground" aria-live="polite">{firstItem}–{firstItem ? firstItem + items.length - 1 : 0}건 표시 · {pageNumber}페이지</span>
              {onPageSizeChange && <label className="flex items-center gap-2 text-xs text-muted-foreground"><span>페이지당</span><select aria-label="작업 이력 표시 개수" className={selectClass + " !w-24"} value={pageSize} disabled={pending || exportBusy || filtersChanged} onChange={event => onPageSizeChange(Number(event.target.value))}>{HISTORY_PAGE_SIZES.map(size => <option key={size} value={size}>{size}건</option>)}</select></label>}
            </div>
            {(onPrevious || onNext) && <div className="flex gap-2"><Button type="button" variant="outline" className="min-h-10" disabled={pending || !canPrevious || filtersChanged} onClick={onPrevious}><ArrowLeft aria-hidden />이전</Button><Button type="button" variant="outline" className="min-h-10" disabled={pending || !hasMore || filtersChanged} onClick={onNext}>다음<ArrowRight aria-hidden /></Button></div>}
          </footer>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">기간은 조회 범위입니다. 이력의 삭제·보관 기간을 뜻하지 않습니다. 각 행은 독립적인 작업 기록입니다.</p>
      </div>
      <DetailDrawer id="history-detail" open={detailsOpen} onOpenChange={setDetailsOpen} title="작업 상세" description="선택한 작업 1건의 기록" returnFocus={() => triggerRef.current?.isConnected ? triggerRef.current : resultHeadingRef.current}>
        {selected && <div className="space-y-6">
          <div><div className="mb-2 flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{typeNames[selected.type]}</p><Status item={selected} /></div><h3 className="text-lg font-semibold">{selected.companyName || "고객사 기록 없음"}</h3><p className="mt-1 text-sm text-muted-foreground">{selected.serial || (selected.organizationId ? "조직 ID " + selected.organizationId : "시리얼 기록 없음")}</p></div>
          <MailOutcomeDetails item={selected} />
          <dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-3 text-[13px]">
            <dt className="text-muted-foreground">발생 시각</dt><dd>{dateLabel(selected.createdAt)} KST</dd>
            <dt className="text-muted-foreground">수행 계정</dt><dd className="break-all">{selected.actorEmail || "기록 없음"}</dd>
            {selected.type === "mail" && <><dt className="text-muted-foreground">참조(CC)</dt><dd className="break-all">{formatCcRecipients(selected)}<p className="mt-1 text-xs text-muted-foreground">요청 당시의 참조 기록이며 실제 수신 확인과는 다릅니다.</p></dd></>}
            <dt className="text-muted-foreground">이벤트 ID</dt><dd className="flex min-w-0 items-start gap-1"><code className="min-w-0 flex-1 break-all text-xs">{selected.id}</code><Button variant="ghost" size="icon" className="-mt-2 min-h-10 min-w-10 shrink-0" aria-label="이벤트 ID 복사" onClick={() => void copyId()}><Copy className="size-4" aria-hidden /></Button></dd>
            {selected.organizationId && <><dt className="text-muted-foreground">조직 ID</dt><dd>{selected.organizationId}</dd></>}
          </dl>
          {copyNotice && <p role="status" className="text-xs text-muted-foreground">{copyNotice}</p>}
          <div className="border-t pt-5"><h3 className="mb-3 text-sm font-semibold">{selected.status === "failed" ? "오류 내용" : "처리 내용"}</h3><div className={"rounded-lg border p-4 text-sm leading-relaxed " + (selected.status === "failed" ? "border-destructive/20 bg-destructive/5" : "bg-muted/30")}><p className="whitespace-pre-wrap break-words">{selected.summary || selected.title || "추가 처리 내용이 없습니다."}</p></div></div>
          <div className="space-y-3 border-t pt-5"><h3 className="text-sm font-semibold">관련 정보</h3><dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-3 text-xs"><dt className="text-muted-foreground">작업 코드</dt><dd className="break-all">{selected.action || "기록 없음"}</dd><dt className="text-muted-foreground">대상 ID</dt><dd className="break-all">{selected.targetId || "기록 없음"}</dd><dt className="text-muted-foreground">요청 ID</dt><dd className="text-muted-foreground">이 기록에 제공되지 않음</dd>{selected.documentId && <><dt className="text-muted-foreground">문서 ID</dt><dd className="break-all">{selected.documentId}</dd></>}</dl>
            {selected.documentId && <p className="text-xs leading-relaxed text-muted-foreground">연결된 파일의 만료·다운로드 가능 여부는 문서함에서 확인하세요.</p>}
            {ticketUrl && <a href={ticketUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary underline underline-offset-4">Zendesk 티켓 열기<ExternalLink className="size-4" aria-hidden /></a>}
          </div>
          {selected.serial && <div className="border-t pt-4"><Button variant="outline" className="min-h-11 w-full" onClick={() => { onQueryChange(selected.serial!); setDetailsOpen(false); window.requestAnimationFrame(() => resultHeadingRef.current?.focus()); }}><Search aria-hidden />이 시리얼로 검색 조건 설정</Button><p className="mt-2 text-xs text-muted-foreground">조회 버튼을 누르면 검색 조건을 적용합니다.</p></div>}
        </div>}
      </DetailDrawer>
    </section>
  );
}
