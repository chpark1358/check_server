"use client";

import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type HistoryItem = {
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
};

const selectClass = "h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30";
const rangeNames: Record<string, string> = { today: "오늘", "7d": "최근 7일", "30d": "최근 30일", "90d": "최근 90일", "365d": "최근 1년", all: "전체 기간", custom: "직접 기간" };
const typeNames: Record<string, string> = { check: "점검 조회", document: "문서 생성", mail: "메일 처리" };
const statusNames: Record<string, string> = { success: "성공", failed: "실패", dry_run: "테스트", pending: "처리 대기", completed: "완료" };

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "시각 확인 불가" : new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function Status({ status }: { status: string }) {
  return <Badge variant={status === "failed" ? "destructive" : "outline"}>{statusNames[status] ?? status}</Badge>;
}

function safeTicketUrl(value?: string | null) {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" ? url.href : null; } catch { return null; }
}

export function HistoryPanel({ overview, range, type, status, query, busy, onRangeChange, onTypeChange, onStatusChange, onQueryChange, onSearch, from = "", to = "", sort = "newest", onFromChange, onToChange, onSortChange, loading = false, error, pageNumber = 1, canPrevious = false, hasMore = overview?.hasMore ?? false, onPrevious, onNext, onReset, appliedFilters }: HistoryPanelProps) {
  const [selected, setSelected] = useState<HistoryItem | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const items = overview?.items ?? [];
  const summary = overview?.summary;
  const applied = appliedFilters ?? overview?.appliedFilters;
  const pending = loading || busy;
  const customInvalid = range === "custom" && (!from || !to || from > to);
  const filtersChanged = Boolean(applied && (applied.range !== range || applied.type !== type || applied.status !== status || applied.q !== query.trim().toLowerCase() || (applied.sort ?? "newest") !== sort || (range === "custom" && (applied.from !== from || applied.to !== to))));
  const hasFilter = applied ? Boolean(applied.q || applied.type !== "all" || applied.status !== "all" || applied.range !== "all") : Boolean(query || type !== "all" || status !== "all" || range !== "all");
  const openDetails = (item: HistoryItem, trigger: HTMLElement) => { triggerRef.current = trigger; setSelected(item); setDetailsOpen(true); };
  const ticketUrl = safeTicketUrl(selected?.ticketUrl);

  return (
    <section className="space-y-5 py-6" aria-labelledby="history-panel-title">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="history-panel-title" className="text-xl font-semibold tracking-tight">내 작업 이력</h2><p className="mt-1 text-sm text-muted-foreground">점검·문서·메일 이벤트를 찾고, 각각의 처리 결과를 확인하세요.</p></div>
        <span className="text-xs text-muted-foreground">표시 시각: 한국 표준시 (KST)</span>
      </header>
      {summary && <dl className="flex flex-wrap gap-x-7 gap-y-2 rounded-lg border bg-card px-4 py-3 text-sm">
        {[["점검 조회", summary.checks], ["문서 생성", summary.documents], ["메일 처리", summary.mails], ["실패", summary.failures]].map(([label, value]) => <div key={label} className="flex items-center gap-2"><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums">{value}건</dd></div>)}
      </dl>}
      <div className="overflow-hidden rounded-xl border bg-card">
        <form className="space-y-3 border-b p-4 sm:p-5" onSubmit={(event) => { event.preventDefault(); if (!pending && !customInvalid) onSearch(); }}>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">검색어</span><Input className="h-11" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="고객사, 시리얼, 티켓 ID" /></label>
            <Button className="min-h-11 self-end px-5" type="submit" disabled={pending || customInvalid}><Search aria-hidden />{loading ? "검색 중" : "검색"}</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">조회 기간</span><select className={selectClass} value={range} onChange={(event) => onRangeChange(event.target.value)}>{Object.entries(rangeNames).map(([value, label]) => <option key={value} value={value} disabled={value === "custom" && (!onFromChange || !onToChange)}>{label}</option>)}</select></label>
            <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">이벤트 유형</span><select className={selectClass} value={type} onChange={(event) => onTypeChange(event.target.value)}><option value="all">모든 유형</option>{Object.entries(typeNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">처리 결과</span><select className={selectClass} value={status} onChange={(event) => onStatusChange(event.target.value)}><option value="all">모든 상태</option><option value="success">성공</option><option value="failed">실패</option><option value="dry_run">테스트</option><option value="pending">처리 대기</option></select></label>
            {onSortChange && <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">정렬</span><select className={selectClass} value={sort} onChange={(event) => onSortChange(event.target.value)}><option value="newest">최신순</option><option value="oldest">과거순</option></select></label>}
          </div>
          {range === "custom" && <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">시작일 (KST)</span><Input type="date" className="h-11" value={from} onChange={(event) => onFromChange?.(event.target.value)} aria-invalid={customInvalid} aria-describedby="history-date-hint" /></label><label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">종료일 (해당 날짜 포함)</span><Input type="date" className="h-11" value={to} onChange={(event) => onToChange?.(event.target.value)} aria-invalid={customInvalid} aria-describedby="history-date-hint" /></label></div>}
          {range === "custom" && <p id="history-date-hint" className={`text-xs ${customInvalid ? "text-destructive" : "text-muted-foreground"}`}>{customInvalid ? "시작일과 종료일을 입력하세요. 종료일은 시작일보다 빠를 수 없습니다." : "한국 표준시 기준으로 시작일과 종료일을 모두 포함합니다."}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{filtersChanged ? "조건이 변경되었습니다. 검색을 누르면 적용됩니다." : "기간은 조회 조건입니다. 이력의 삭제·보관 기간을 뜻하지 않습니다."}</p>{onReset && <Button type="button" variant="ghost" className="min-h-11" disabled={pending} onClick={onReset}>필터 초기화</Button>}</div>
        </form>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5"><h3 ref={resultHeadingRef} tabIndex={-1} className="text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">이벤트 {items.length}건 표시</h3>{applied && <p className="text-xs text-muted-foreground">적용 기간: {applied.range === "custom" ? `${applied.from} ~ ${applied.to}` : rangeNames[applied.range] ?? applied.range}{applied.q ? ` · 검색: ${applied.q}` : ""}</p>}</div>
        <div className="px-4 sm:px-5" aria-live="polite">{loading && <p className="mb-3 text-sm text-muted-foreground">{items.length ? "새 결과를 조회하고 있습니다. 이전 결과를 표시합니다." : "이력을 불러오고 있습니다."}</p>}</div>
        {error && <div role="alert" className="mx-4 mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm sm:mx-5"><p className="font-medium text-destructive">이력을 불러오지 못했습니다.</p><p className="mt-1 break-words text-muted-foreground">{error}</p>{items.length > 0 && <p className="mt-1 text-xs text-muted-foreground">아래는 마지막으로 불러온 결과입니다.</p>}<Button type="button" variant="outline" className="mt-2 min-h-11" disabled={pending || customInvalid} onClick={onSearch}>현재 조건으로 다시 조회</Button></div>}
        {items.length > 0 ? <>
          <div className="hidden overflow-x-auto md:block" aria-busy={loading}><table className="w-full min-w-[760px] text-left text-sm"><caption className="sr-only">개별 점검·문서·메일 이벤트 목록</caption><thead className="bg-muted/50 text-xs text-muted-foreground"><tr>{["발생 시각", "고객 · 시리얼", "이벤트", "결과", "요약"].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{items.map((item) => <tr key={`${item.type}-${item.id}`} className="border-t"><td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums">{dateLabel(item.createdAt)}</td><td className="px-4 py-3"><Button variant="link" className="min-h-11 max-w-64 justify-start whitespace-normal px-0 text-left" onClick={(event) => openDetails(item, event.currentTarget)}>{item.companyName || item.title || "상세 보기"}</Button><p className="text-xs text-muted-foreground">{item.serial || (item.organizationId ? `조직 ID ${item.organizationId}` : "시리얼 정보 없음")}</p></td><td className="px-4 py-3 text-xs">{typeNames[item.type]}</td><td className="px-4 py-3"><Status status={item.status} /></td><td className="max-w-xs px-4 py-3 text-xs leading-relaxed text-muted-foreground"><p className="line-clamp-2">{item.summary || "상세 정보에서 확인하세요."}</p></td></tr>)}</tbody></table></div>
          <ul className="divide-y border-t md:hidden" aria-busy={loading}>{items.map((item) => <li key={`${item.type}-${item.id}`} className="p-4"><div className="flex items-start justify-between gap-3"><Button variant="link" className="min-h-11 justify-start whitespace-normal px-0 text-left" onClick={(event) => openDetails(item, event.currentTarget)}>{item.companyName || item.title || "상세 보기"}</Button><Status status={item.status} /></div><p className="text-xs text-muted-foreground">{item.serial || (item.organizationId ? `조직 ID ${item.organizationId}` : "시리얼 정보 없음")} · {typeNames[item.type]}</p><p className="mt-2 text-sm line-clamp-2">{item.summary || "상세 정보에서 확인하세요."}</p><p className="mt-2 text-xs text-muted-foreground">{dateLabel(item.createdAt)} KST</p></li>)}</ul>
        </> : !loading && !error && <div className="border-t px-5 py-12 text-center"><p className="font-medium">{hasFilter ? "조건에 맞는 이력이 없습니다." : "조회할 이력이 없습니다."}</p><p className="mt-2 text-sm text-muted-foreground">{hasFilter ? "조회 기간을 넓히거나 검색어·필터를 변경해 보세요." : "점검·문서·메일 처리 내역이 여기에 표시됩니다."}</p></div>}
        {(onPrevious || onNext) && <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 sm:px-5"><span className="text-xs text-muted-foreground">{pageNumber}페이지 · {items.length}건 표시</span><div className="flex gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={pending || !canPrevious || filtersChanged} onClick={onPrevious}><ArrowLeft aria-hidden />이전</Button><Button type="button" variant="outline" className="min-h-11" disabled={pending || !hasMore || filtersChanged} onClick={onNext}>다음<ArrowRight aria-hidden /></Button></div></div>}
      </div>
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" finalFocus={() => triggerRef.current?.isConnected ? triggerRef.current : resultHeadingRef.current}>
          <DialogHeader><DialogTitle>이벤트 상세</DialogTitle><DialogDescription>선택한 이벤트 한 건의 기록입니다. 별도 근거 없이 다른 작업과 연결하지 않습니다.</DialogDescription></DialogHeader>
          {selected && <div className="space-y-5"><dl className="grid grid-cols-[90px_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm"><dt className="text-muted-foreground">고객사</dt><dd className="break-words">{selected.companyName || "기록된 고객사 정보 없음"}</dd><dt className="text-muted-foreground">시리얼</dt><dd>{selected.serial || "기록된 시리얼 없음"}</dd>{selected.organizationId && <><dt className="text-muted-foreground">조직 ID</dt><dd>{selected.organizationId}</dd></>}<dt className="text-muted-foreground">발생 시각</dt><dd>{dateLabel(selected.createdAt)} KST</dd><dt className="text-muted-foreground">이벤트</dt><dd>{typeNames[selected.type]}</dd><dt className="text-muted-foreground">결과</dt><dd><Status status={selected.status} /></dd><dt className="text-muted-foreground">수행 계정</dt><dd className="break-all">{selected.actorEmail || "기록 없음"}</dd><dt className="text-muted-foreground">이벤트 ID</dt><dd className="break-all font-mono text-xs">{selected.id}</dd></dl><div className="border-t pt-4"><h4 className="font-medium">처리 내용</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{selected.summary || selected.title || "추가 처리 내용이 없습니다."}</p></div>{selected.documentId && <p className="break-all text-xs text-muted-foreground">관련 문서 ID: {selected.documentId} · 파일의 사용 가능 여부는 문서함에서 확인하세요.</p>}{ticketUrl && <a href={ticketUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary underline underline-offset-4">Zendesk 티켓 열기<ExternalLink className="size-4" aria-hidden /></a>}</div>}
          <DialogFooter><DialogClose render={<Button variant="outline" className="min-h-11" />}>목록으로 돌아가기</DialogClose></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
