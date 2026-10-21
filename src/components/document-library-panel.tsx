"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Clock3, Download, Eye, FileText, Loader2, LockKeyhole, Paperclip, RotateCcw, Search, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DetailDrawer } from "@/components/detail-drawer";

export type DocumentFileMeta = { fileName: string; size: number; downloadUrl: string };
export type PdfStatus = { ok: true } | { ok: false; code: string; message: string };
export type DocumentLibraryItem = {
  id: string;
  companyName: string;
  serial: string;
  createdAt: string;
  expiresAt: string;
  docx: DocumentFileMeta;
  pdf: (DocumentFileMeta & { status: "success" }) | null;
  pdfStatus: PdfStatus | string;
  actorEmail: string | null;
  engineerName: string | null;
  pdfErrorSummary: string | null;
  attachedToMail: boolean;
};
export type DocumentLibrarySummary = { total: number; pdfReady: number; attached: number };
export type DocumentLibraryPanelProps = {
  documents: DocumentLibraryItem[];
  summary: DocumentLibrarySummary;
  query: string;
  attachedFilter: string;
  statusFilter: string;
  expiryFilter: string;
  createdRange: string;
  asOf?: string;
  busy: boolean;
  onQueryChange: (value: string) => void;
  onAttachedFilterChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  onExpiryFilterChange: (value: string) => void;
  onCreatedRangeChange: (value: string) => void;
  onSearch: () => void;
  onDownload: (url: string, fileName: string) => void;
  onPreviewPdf: (url: string) => void;
  onResolvePdfPreview?: (url: string) => Promise<string | null>;
  onUseForMail: (doc: DocumentLibraryItem) => void;
  onRetryPdf?: (doc: DocumentLibraryItem) => Promise<DocumentLibraryItem>;
  loading?: boolean;
  error?: string | null;
  hasLoaded?: boolean;
  pageNumber?: number;
  canPrevious?: boolean;
  hasMore?: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  onReset?: () => void;
};

const weekMs = 7 * 24 * 60 * 60 * 1000;
const attachmentRecordNote = "과거 테스트 처리 기록이 포함될 수 있으며, 실제 업로드·메일 발송 완료를 증명하지 않습니다.";
const selectClass = "h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50";

function expiration(doc: DocumentLibraryItem, now: number) {
  const timestamp = Date.parse(doc.expiresAt);
  if (!Number.isFinite(timestamp)) return "unknown";
  if (timestamp <= now) return "expired";
  return timestamp - now <= weekMs ? "expiring" : "available";
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "확인 불가" : new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function pdfLabel(doc: DocumentLibraryItem) {
  if (doc.pdf) return "PDF 완료";
  if (typeof doc.pdfStatus === "object") return doc.pdfStatus.ok ? "PDF 확인 필요" : "PDF 실패";
  return ({ failed: "PDF 실패", unavailable: "PDF 변환 불가", not_requested: "DOCX만 생성" } as Record<string, string>)[doc.pdfStatus] ?? "PDF 미생성";
}

function selectedPdfFailed(doc: DocumentLibraryItem) {
  return typeof doc.pdfStatus === "object" ? !doc.pdfStatus.ok : doc.pdfStatus === "failed";
}

function sizeLabel(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "크기 정보 없음";
  return bytes >= 1024 * 1024 ? (bytes / (1024 * 1024)).toFixed(1) + " MB" : Math.ceil(bytes / 1024) + " KB";
}

function ExpiryBadge({ doc, now }: { doc: DocumentLibraryItem; now: number }) {
  const state = expiration(doc, now);
  const Icon = state === "expired" || state === "unknown" ? LockKeyhole : state === "expiring" ? Clock3 : CheckCircle2;
  return <span className={"inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium " + (state === "available" ? "text-primary" : "text-muted-foreground")}><Icon className="size-3.5 shrink-0" aria-hidden />{state === "expired" ? "사용 기한 만료" : state === "expiring" ? "7일 내 만료" : state === "unknown" ? "기한 확인 필요" : "사용 가능"}</span>;
}

function PdfBadge({ doc }: { doc: DocumentLibraryItem }) {
  return <span className={"inline-flex items-center gap-1 text-xs " + (!doc.pdf && selectedPdfFailed(doc) ? "text-destructive" : "text-muted-foreground")}>{!doc.pdf && selectedPdfFailed(doc) && <XCircle className="size-3.5" aria-hidden />}{pdfLabel(doc)}</span>;
}

export function DocumentLibraryPanel({ documents, summary, query, attachedFilter, statusFilter, expiryFilter, createdRange, asOf, busy, onQueryChange, onAttachedFilterChange, onStatusFilterChange, onExpiryFilterChange, onCreatedRangeChange, onSearch, onDownload, onPreviewPdf, onResolvePdfPreview, onUseForMail, onRetryPdf, loading = false, error, hasLoaded = true, pageNumber = 1, canPrevious = false, hasMore = false, onPrevious, onNext, onReset }: DocumentLibraryPanelProps) {
  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState<DocumentLibraryItem | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const retryLock = useRef(false);
  const selectedIdRef = useRef<string | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const previewRequest = useRef(0);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", refresh); };
  }, []);
  useEffect(() => () => { if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => () => { previewRequest.current += 1; }, []);
  const pending = loading || busy || retryingId !== null;
  const visibleDocuments = documents;
  const hasFilter = Boolean(query.trim() || attachedFilter !== "all" || statusFilter !== "all" || expiryFilter !== "all" || createdRange !== "all");
  const selectedExpiry = selected ? expiration(selected, now) : "unknown";
  const fileActionsDisabled = pending || selectedExpiry === "expired" || selectedExpiry === "unknown";
  const selectedPdfError = selected?.pdfErrorSummary || (selected && typeof selected.pdfStatus === "object" && !selected.pdfStatus.ok ? selected.pdfStatus.message : null);

  const resetPreview = () => {
    previewRequest.current += 1;
    setPreviewUrl(null);
    setPreviewLoading(false);
    setPreviewMessage(null);
  };
  const openDetails = (doc: DocumentLibraryItem, trigger: HTMLElement) => { selectedIdRef.current = doc.id; triggerRef.current = trigger; resetPreview(); setSelected(doc); setActionError(null); setDetailsOpen(true); };
  const handleOpenChange = (open: boolean) => { setDetailsOpen(open); if (!open) { selectedIdRef.current = null; resetPreview(); } };
  const resetFilters = () => { onReset?.(); };
  async function retryPdf() {
    if (!selected || selected.pdf || !onRetryPdf || pending || retryLock.current) return;
    if (!["available", "expiring"].includes(expiration(selected, Date.now()))) {
      setNow(Date.now()); setActionError("문서의 사용 기한을 확인해 주세요."); return;
    }
    const id = selected.id;
    retryLock.current = true; setRetryingId(id); setActionError(null);
    try {
      const updated = await onRetryPdf(selected);
      setSelected(current => current?.id === id ? updated : current);
    } catch (error) {
      if (selectedIdRef.current === id) setActionError(error instanceof Error ? error.message : "PDF 재시도에 실패했습니다. DOCX는 보존됩니다.");
    } finally { retryLock.current = false; setRetryingId(null); }
  }
  const runFileAction = (action: () => void) => {
    if (!selected || pending) return;
    const state = expiration(selected, Date.now());
    if (state === "expired" || state === "unknown") { setNow(Date.now()); setActionError(state === "expired" ? "문서의 사용 기한이 만료되어 파일을 사용할 수 없습니다." : "사용 기한을 확인할 수 없습니다. 목록을 다시 조회하세요."); return; }
    setActionError(null);
    action();
  };
  async function loadPreview() {
    if (!selected?.pdf || previewLoading || !onResolvePdfPreview) return;
    const request = ++previewRequest.current;
    setPreviewLoading(true);
    setPreviewMessage(null);
    try {
      const url = await onResolvePdfPreview(selected.pdf.downloadUrl);
      if (previewRequest.current !== request) { if (url?.startsWith("blob:")) URL.revokeObjectURL(url); return; }
      setPreviewUrl(url);
      if (!url) setPreviewMessage("이 미리보기 데이터에는 실제 PDF 파일이 없습니다. 아래에서 파일 정보를 확인할 수 있습니다.");
    } catch (caught) {
      if (previewRequest.current === request) setPreviewMessage(caught instanceof Error ? caught.message : "PDF를 불러오지 못했습니다. 다시 시도해 주세요.");
    } finally {
      if (previewRequest.current === request) setPreviewLoading(false);
    }
  }
  const statusTiles = [
    { label: "검색 결과", count: summary.total }, { label: "PDF 생성 완료", count: summary.pdfReady },
    { label: "첨부 처리 기록", count: summary.attached },
  ];

  return (
    <section className={"grid min-w-0 items-start gap-5 " + (detailsOpen ? "min-[1440px]:grid-cols-[minmax(0,1fr)_420px]" : "")} aria-label="문서함">
      <div className="min-w-0 space-y-4">
        <div className="rounded-xl border bg-card">
          <dl className="grid grid-cols-3 divide-x">{statusTiles.map((tile) => <div key={tile.label} className="px-3 py-3 sm:px-5"><dt className="text-xs text-muted-foreground">{tile.label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{hasLoaded ? tile.count : "—"}</dd></div>)}</dl>
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">내 문서 전체에서 마지막 검색 조건으로 집계{asOf ? " · 조회 기준 " + dateLabel(asOf) + " KST" : ""}</p>
        </div>
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (!pending) onSearch(); }}>
          <div className="flex gap-2"><label className="relative min-w-0 flex-1"><span className="sr-only">문서 검색어</span><Search className="pointer-events-none absolute top-3.5 left-3.5 size-4 text-muted-foreground" aria-hidden /><Input className="h-11 bg-card pl-10" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="고객사, 시리얼, 점검자 검색" /></label><Button type="submit" className="min-h-11 px-5" disabled={pending}>{loading ? "검색 중" : "검색"}</Button></div>
          <div className="flex flex-wrap gap-2">
            <label className="min-w-36 flex-1"><span className="sr-only">PDF 생성 상태</span><select aria-label="PDF 생성 상태" className={selectClass} value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value)}><option value="all">모든 파일 상태</option><option value="pdf_success">PDF 생성 완료</option><option value="not_requested">DOCX만 생성</option><option value="failed">PDF 실패</option><option value="unavailable">PDF 변환 불가</option></select></label>
            <label className="min-w-32 flex-1"><span className="sr-only">첨부 처리 기록</span><select aria-label="첨부 처리 기록" className={selectClass} value={attachedFilter} onChange={(event) => onAttachedFilterChange(event.target.value)}><option value="all">모든 첨부 처리 기록</option><option value="true">기록 있음</option><option value="false">기록 없음</option></select></label>
            <label className="min-w-32 flex-1"><span className="sr-only">사용 기한</span><select aria-label="사용 기한" className={selectClass} value={expiryFilter} onChange={(event) => onExpiryFilterChange(event.target.value)}><option value="all">모든 사용 기한</option><option value="available">사용 가능</option><option value="expiring">7일 내 만료</option><option value="expired">만료</option></select></label>
            <label className="min-w-32 flex-1"><span className="sr-only">생성 기간</span><select aria-label="생성 기간" className={selectClass} value={createdRange} onChange={(event) => onCreatedRangeChange(event.target.value)}><option value="all">모든 생성 기간</option><option value="7d">최근 7일 생성</option><option value="30d">최근 30일 생성</option><option value="90d">최근 90일 생성</option><option value="365d">최근 365일 생성</option></select></label>
            <Button type="button" variant="ghost" className="min-h-11 px-3 text-muted-foreground" disabled={pending} onClick={resetFilters}><RotateCcw className="size-4" aria-hidden />초기화</Button>
          </div>
        </form>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">{expiryFilter !== "all" && <Badge variant="secondary" className="rounded-full bg-primary/8 px-2.5 py-1 font-normal text-primary">{({ available: "사용 가능", expiring: "7일 내 만료", expired: "만료" } as Record<string, string>)[expiryFilter]}</Badge>}{createdRange !== "all" && <Badge variant="secondary" className="rounded-full bg-primary/8 px-2.5 py-1 font-normal text-primary">최근 {createdRange.replace("d", "")}일 생성</Badge>}</div>
          <p className="text-xs text-muted-foreground">모든 필터는 검색 버튼으로 적용 · 생성 기간은 한국 시간 기준</p>
        </div>
        <div className="overflow-hidden rounded-xl border bg-card">
          <h2 ref={resultHeadingRef} tabIndex={-1} className="sr-only outline-none">문서 {visibleDocuments.length}건 표시</h2>
          {hasLoaded && !onNext && summary.total > documents.length && <p className="border-b bg-muted/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">검색 조건에 맞는 {summary.total}건 중 최근 {documents.length}건을 불러왔습니다. 이전 문서는 고객사·시리얼·점검자로 검색 범위를 좁혀 확인하세요.</p>}
          <div aria-live="polite">{loading && <p className="border-b px-4 py-3 text-sm text-muted-foreground">{documents.length ? "조회 중 · 마지막 조회 결과를 표시합니다." : "문서 목록을 불러오고 있습니다."}</p>}</div>
          {error && <div role="alert" className="border-b border-destructive/20 bg-destructive/5 p-4 text-sm"><p className="font-medium text-destructive">문서 목록을 불러오지 못했습니다.</p><p className="mt-1 break-words text-muted-foreground">{error}</p>{documents.length > 0 && <p className="mt-1 text-xs text-muted-foreground">마지막 조회 결과와 입력 조건을 유지합니다.</p>}<Button type="button" variant="outline" className="mt-3 min-h-11" disabled={pending} onClick={onSearch}>다시 조회</Button></div>}
          {visibleDocuments.length > 0 ? <>
            <div className="hidden max-h-[640px] overflow-auto md:block" aria-busy={loading}>
              <table className="w-full min-w-[650px] text-left text-[13px]"><caption className="sr-only">생성 문서별 파일 상태와 사용 기한. 고객사를 선택하면 상세가 열립니다.</caption>
                <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground"><tr>{["고객사 · 시리얼", "생성일 (KST)", "파일 상태", "사용 기한", "점검자", "보기"].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
                <tbody>{visibleDocuments.map((doc) => {
                  const isSelected = detailsOpen && selected?.id === doc.id;
                  return <tr key={doc.id} className={"cursor-pointer border-t transition-colors hover:bg-primary/5 " + (isSelected ? "bg-primary/10" : "")} onClick={(event) => openDetails(doc, event.currentTarget.querySelector("button") ?? event.currentTarget)}>
                    <td className="px-4 py-2"><button type="button" className="flex min-h-11 max-w-56 items-center gap-2.5 text-left outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring" aria-expanded={isSelected} aria-controls={isSelected ? "document-detail" : undefined} onClick={(event) => { event.stopPropagation(); openDetails(doc, event.currentTarget); }}><FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden /><span><span className="line-clamp-1 font-medium">{doc.companyName || "고객사 정보 없음"}</span><span className="mt-1 block text-xs text-muted-foreground">{doc.serial || "시리얼 정보 없음"}</span></span></button></td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-muted-foreground">{dateLabel(doc.createdAt)}</td>
                    <td className="px-4 py-3"><div className="text-xs font-medium">DOCX{doc.pdf ? " · PDF" : ""}</div><div className="mt-1"><PdfBadge doc={doc} /></div></td>
                    <td className="px-4 py-3"><ExpiryBadge doc={doc} now={now} /><p className="mt-1 whitespace-nowrap text-xs text-muted-foreground">{dateLabel(doc.expiresAt)}</p></td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{doc.engineerName || "기록 없음"}</td>
                    <td className="px-3 py-2"><Button variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={(doc.companyName || doc.serial) + " 문서 상세 보기"} onClick={(event) => { event.stopPropagation(); openDetails(doc, event.currentTarget); }}><Eye className="size-4" aria-hidden /></Button></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <ul className="divide-y md:hidden" aria-busy={loading}>{visibleDocuments.map((doc) => <li key={doc.id}><button type="button" className={"w-full space-y-2 p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring " + (detailsOpen && selected?.id === doc.id ? "bg-primary/10" : "")} onClick={(event) => openDetails(doc, event.currentTarget)}><span className="flex items-start justify-between gap-3"><span className="font-medium">{doc.companyName || "고객사 정보 없음"}</span><ExpiryBadge doc={doc} now={now} /></span><span className="block text-xs text-muted-foreground">{doc.serial || "시리얼 정보 없음"} · 점검자 {doc.engineerName || "기록 없음"}</span><span className="flex items-center gap-2 text-xs">DOCX{doc.pdf ? " · PDF" : ""}<PdfBadge doc={doc} /></span><span className="block text-xs text-muted-foreground">생성 {dateLabel(doc.createdAt)} KST<br />기한 {dateLabel(doc.expiresAt)} KST</span></button></li>)}</ul>
          </> : !loading && !error && <div className="px-5 py-16 text-center"><FileText className="mx-auto mb-3 size-6 text-muted-foreground" aria-hidden /><p className="font-medium">{!hasLoaded ? "문서 목록을 준비하고 있습니다." : hasFilter ? "조건에 맞는 문서가 없습니다." : "아직 생성된 문서가 없습니다."}</p><p className="mt-2 text-sm text-muted-foreground">{hasFilter ? "검색어 또는 필터를 변경해 보세요." : "점검 데이터에서 확인서를 생성하면 여기에 표시됩니다."}</p>{hasFilter && <Button variant="outline" className="mt-4 min-h-11" onClick={resetFilters}>필터 초기화</Button>}</div>}
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3"><span className="text-xs text-muted-foreground">검색 결과 {summary.total}건 · {pageNumber}페이지 · {documents.length}건 표시</span>{(onPrevious || onNext) && <div className="flex gap-2"><Button type="button" variant="outline" className="min-h-10" disabled={pending || !canPrevious} onClick={onPrevious}><ArrowLeft aria-hidden />이전</Button><Button type="button" variant="outline" className="min-h-10" disabled={pending || !hasMore} onClick={onNext}>다음<ArrowRight aria-hidden /></Button></div>}</footer>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">만료된 문서는 파일 사용이 제한됩니다. 작업 기록은 확인할 수 있습니다. {attachmentRecordNote}</p>
      </div>
      <DetailDrawer id="document-detail" open={detailsOpen} onOpenChange={handleOpenChange} title="문서 미리보기" description="파일과 사용 가능 기간을 확인하세요." returnFocus={() => triggerRef.current?.isConnected ? triggerRef.current : resultHeadingRef.current}>
        {selected && <div className="space-y-5">
          <div className="flex items-start justify-between gap-3"><div><h3 className="text-base font-semibold">{selected.companyName || "고객사 기록 없음"}</h3><p className="mt-1 text-sm text-muted-foreground">{selected.serial || "시리얼 기록 없음"}</p></div><ExpiryBadge doc={selected} now={now} /></div>
          {previewUrl && !fileActionsDisabled ? <div className="overflow-hidden rounded-lg border bg-muted"><iframe title={selected.companyName + " 점검 확인서 PDF"} src={previewUrl + "#toolbar=0"} className="h-[480px] w-full" /></div> : <div className="rounded-lg border bg-muted/30 px-5 py-7 text-center"><FileText className="mx-auto mb-3 size-9 text-muted-foreground" aria-hidden /><p className="break-words text-sm font-medium">{selected.pdf?.fileName ?? selected.docx.fileName}</p><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{selectedExpiry === "expired" ? "파일 사용 기한이 만료되었습니다." : selectedExpiry === "unknown" ? "파일 사용 기한을 확인할 수 없습니다." : selected.pdf ? "PDF를 불러와 문서 내용을 확인하세요." : "DOCX 파일을 다운로드해 내용을 확인하세요."}</p>{selected.pdf && <Button variant="outline" className="mt-4 min-h-11" disabled={fileActionsDisabled || previewLoading} onClick={() => runFileAction(() => { if (onResolvePdfPreview) void loadPreview(); else onPreviewPdf(selected.pdf!.downloadUrl); })}>{previewLoading ? <Loader2 className="animate-spin" aria-hidden /> : <Eye aria-hidden />}{previewLoading ? "불러오는 중" : "PDF 미리보기"}</Button>}</div>}
          {previewMessage && <p role="status" className="text-xs leading-relaxed text-muted-foreground">{previewMessage}</p>}
          {!selected.pdf && onRetryPdf && <div className="rounded-lg border bg-primary/5 p-3"><Button variant="outline" className="min-h-11 w-full" disabled={fileActionsDisabled} onClick={() => void retryPdf()}>{retryingId === selected.id ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}{retryingId === selected.id ? "PDF 변환 중" : "PDF만 다시 시도"}</Button><p role="status" className="mt-2 text-xs leading-relaxed text-muted-foreground">저장된 DOCX로 변환합니다. 원본과 문서 ID·보관 기한은 유지됩니다.</p></div>}
          <div className="grid gap-2 sm:grid-cols-2"><Button variant="outline" className="min-h-11" disabled={fileActionsDisabled} onClick={() => runFileAction(() => onDownload(selected.pdf?.downloadUrl ?? selected.docx.downloadUrl, selected.pdf?.fileName ?? selected.docx.fileName))}><Download aria-hidden />{selected.pdf ? "PDF 다운로드" : "DOCX 다운로드"}</Button><Button className="min-h-11" disabled={fileActionsDisabled || !selected.pdf} onClick={() => runFileAction(() => { handleOpenChange(false); onUseForMail(selected); })}><Paperclip aria-hidden />메일에 연결</Button></div>
          {(selectedExpiry === "expired" || selectedExpiry === "unknown") && <p className="flex gap-2 rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground"><LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden />{selectedExpiry === "expired" ? "다운로드·미리보기·첨부를 사용할 수 없습니다. 새 파일이 필요하면 점검 데이터에서 확인서를 생성하세요." : "사용 기한을 확인할 수 없어 파일 작업을 차단했습니다. 목록을 다시 조회하세요."}</p>}
          {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
          <dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-3 border-t pt-5 text-[13px]"><dt className="text-muted-foreground">생성 시각</dt><dd>{dateLabel(selected.createdAt)} KST</dd><dt className="text-muted-foreground">만료 시각</dt><dd>{dateLabel(selected.expiresAt)} KST</dd><dt className="text-muted-foreground">점검자</dt><dd>{selected.engineerName || "기록 없음"}</dd><dt className="text-muted-foreground">생성 계정</dt><dd className="break-all">{selected.actorEmail || "기록 없음"}</dd><dt className="text-muted-foreground">문서 ID</dt><dd className="break-all font-mono text-xs">{selected.id}</dd></dl>
          <div className="space-y-3 border-t pt-5"><h3 className="text-sm font-semibold">생성 파일</h3><div className="rounded-lg border p-3"><div className="flex items-start justify-between gap-2"><p className="min-w-0 break-all text-xs font-medium">{selected.docx.fileName}</p><Badge variant="outline" className="shrink-0">DOCX</Badge></div><div className="mt-2 flex items-center justify-between"><p className="text-xs text-muted-foreground">{sizeLabel(selected.docx.size)}</p><Button variant="ghost" className="min-h-10 text-xs" disabled={fileActionsDisabled} onClick={() => runFileAction(() => onDownload(selected.docx.downloadUrl, selected.docx.fileName))}><Download className="size-3.5" aria-hidden />다운로드</Button></div></div>{selected.pdf ? <div className="flex items-start justify-between gap-2 rounded-lg border p-3"><div><p className="break-all text-xs font-medium">{selected.pdf.fileName}</p><p className="mt-1 text-xs text-muted-foreground">{sizeLabel(selected.pdf.size)}</p></div><Badge variant="outline" className="shrink-0">PDF</Badge></div> : <div className="rounded-lg border border-dashed p-3"><PdfBadge doc={selected} /><p className="mt-2 break-words text-xs leading-relaxed text-muted-foreground">{selectedPdfError || "PDF 산출물이 없습니다. DOCX 생성 결과는 사용할 수 있습니다."}</p></div>}</div>
          <div className="space-y-2 border-t pt-4"><h3 className="text-sm font-semibold">첨부 처리 기록</h3><p className="text-xs text-muted-foreground">{selected.attachedToMail ? "기록 있음" : "기록 없음"}</p><p className="text-xs leading-relaxed text-muted-foreground">{attachmentRecordNote} 메일에 연결하면 작성 화면에서 수신자와 내용을 검토할 수 있습니다. 발송 완료 여부는 메일 이력에서 확인하세요.</p></div>
        </div>}
      </DetailDrawer>
    </section>
  );
}
