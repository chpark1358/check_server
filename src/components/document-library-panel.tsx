"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Download, Eye, FileText, Paperclip, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
  busy: boolean;
  onQueryChange: (value: string) => void;
  onAttachedFilterChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  onSearch: () => void;
  onDownload: (url: string, fileName: string) => void;
  onPreviewPdf: (url: string) => void;
  onUseForMail: (doc: DocumentLibraryItem) => void;
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
const selectClass = "h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30";

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
  return ({ failed: "PDF 실패", disabled: "변환 미설정", not_requested: "PDF 미생성", pending: "PDF 처리 대기" } as Record<string, string>)[doc.pdfStatus] ?? "PDF 미생성";
}

function sizeLabel(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function ExpiryBadge({ doc, now }: { doc: DocumentLibraryItem; now: number }) {
  const state = expiration(doc, now);
  return <Badge variant={state === "expired" ? "destructive" : "outline"}>{state === "expired" ? "사용 기한 만료" : state === "expiring" ? "7일 내 만료" : state === "unknown" ? "기한 확인 필요" : "사용 가능"}</Badge>;
}

export function DocumentLibraryPanel({ documents, summary, query, attachedFilter, statusFilter, busy, onQueryChange, onAttachedFilterChange, onStatusFilterChange, onSearch, onDownload, onPreviewPdf, onUseForMail, loading = false, error, hasLoaded = true, pageNumber = 1, canPrevious = false, hasMore = false, onPrevious, onNext, onReset }: DocumentLibraryPanelProps) {
  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState<DocumentLibraryItem | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", refresh); };
  }, []);
  const pending = loading || busy;
  const expired = documents.filter((doc) => expiration(doc, now) === "expired").length;
  const expiring = documents.filter((doc) => expiration(doc, now) === "expiring").length;
  const hasFilter = Boolean(query.trim() || attachedFilter !== "all" || statusFilter !== "all");
  const selectedExpiry = selected ? expiration(selected, now) : "unknown";
  const fileActionsDisabled = pending || selectedExpiry === "expired" || selectedExpiry === "unknown";
  const selectedPdfError = selected?.pdfErrorSummary || (selected && typeof selected.pdfStatus === "object" && !selected.pdfStatus.ok ? selected.pdfStatus.message : null);
  const openDetails = (doc: DocumentLibraryItem, trigger: HTMLElement) => { triggerRef.current = trigger; setSelected(doc); setActionError(null); setDetailsOpen(true); };
  const runFileAction = (action: () => void) => {
    if (!selected || pending) return;
    const state = expiration(selected, Date.now());
    if (state === "expired" || state === "unknown") { setNow(Date.now()); setActionError(state === "expired" ? "문서의 사용 기한이 만료되어 파일을 사용할 수 없습니다." : "사용 기한을 확인할 수 없습니다. 목록을 다시 조회하세요."); return; }
    setActionError(null);
    action();
  };

  return (
    <section className="space-y-5 py-6" aria-labelledby="document-library-title">
      <header><h2 id="document-library-title" className="text-xl font-semibold tracking-tight">문서함</h2><p className="mt-1 text-sm text-muted-foreground">생성한 확인서와 파일의 사용 기한을 확인하세요. 첨부 업로드 이력은 발송 완료를 뜻하지 않습니다.</p></header>
      {hasLoaded && <dl className="flex flex-wrap gap-x-7 gap-y-2 rounded-lg border bg-card px-4 py-3 text-sm">
        {[["조회 조건의 문서", summary.total], ["PDF 완료", summary.pdfReady], ["첨부 업로드 이력", summary.attached]].map(([label, value]) => <div key={label} className="flex items-center gap-2"><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums">{value}건</dd></div>)}
      </dl>}
      <div className="overflow-hidden rounded-xl border bg-card">
        <form className="space-y-3 border-b p-4 sm:p-5" onSubmit={(event) => { event.preventDefault(); if (!pending) onSearch(); }}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_170px_170px_auto]">
            <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">검색어</span><Input className="h-11" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="고객사, 시리얼, 점검자" /></label>
            <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">첨부 업로드 이력</span><select className={selectClass} value={attachedFilter} onChange={(event) => onAttachedFilterChange(event.target.value)}><option value="all">모두</option><option value="true">이력 있음</option><option value="false">이력 없음</option></select></label>
            <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">PDF 생성 상태</span><select className={selectClass} value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value)}><option value="all">모든 상태</option><option value="pdf_success">PDF 생성 완료</option><option value="not_requested">DOCX만 생성</option><option value="failed">PDF 실패</option></select></label>
            <Button type="submit" className="min-h-11 self-end px-5" disabled={pending}><Search aria-hidden />{loading ? "검색 중" : "검색"}</Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">검색어와 필터를 바꾼 뒤 검색을 눌러 적용하세요.</p>{onReset && <Button type="button" variant="ghost" className="min-h-11" disabled={pending} onClick={onReset}>필터 초기화</Button>}</div>
        </form>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5"><h3 ref={resultHeadingRef} tabIndex={-1} className="text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">문서 {documents.length}건 표시</h3><p className="text-xs text-muted-foreground">현재 목록 기준: 7일 내 만료 {expiring}건 · 만료 {expired}건</p></div>
        {hasLoaded && !onNext && summary.total > documents.length && <p className="mx-4 mb-3 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground sm:mx-5">조회 조건에 맞는 {summary.total}건 중 최근 {documents.length}건을 표시합니다. 현재 목록에는 다음 페이지가 없어 검색 조건을 좁혀 조회해야 합니다.</p>}
        <div className="px-4 sm:px-5" aria-live="polite">{loading && <p className="mb-3 text-sm text-muted-foreground">{documents.length ? "문서를 조회하고 있습니다. 이전 결과를 표시합니다." : "문서 목록을 불러오고 있습니다."}</p>}</div>
        {error && <div role="alert" className="mx-4 mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm sm:mx-5"><p className="font-medium text-destructive">문서 목록을 불러오지 못했습니다.</p><p className="mt-1 break-words text-muted-foreground">{error}</p>{documents.length > 0 && <p className="mt-1 text-xs text-muted-foreground">아래는 마지막으로 불러온 결과입니다.</p>}<Button type="button" variant="outline" className="mt-2 min-h-11" disabled={pending} onClick={onSearch}>현재 조건으로 다시 조회</Button></div>}
        {documents.length > 0 ? <>
          <div className="hidden overflow-x-auto md:block" aria-busy={loading}><table className="w-full min-w-[780px] text-left text-sm"><caption className="sr-only">생성 문서별 DOCX·PDF 산출물과 사용 기한</caption><thead className="bg-muted/50 text-xs text-muted-foreground"><tr>{["고객 · 시리얼", "생성 시각 (KST)", "점검자", "파일", "사용 기한", "첨부 이력"].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{documents.map((doc) => <tr key={doc.id} className="border-t"><td className="px-4 py-3"><Button variant="link" className="min-h-11 max-w-60 justify-start whitespace-normal px-0 text-left" onClick={(event) => openDetails(doc, event.currentTarget)}>{doc.companyName || "고객사 정보 없음"}</Button><p className="text-xs text-muted-foreground">{doc.serial || "시리얼 정보 없음"}</p></td><td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums">{dateLabel(doc.createdAt)}</td><td className="px-4 py-3 text-xs">{doc.engineerName || "기록 없음"}</td><td className="px-4 py-3"><div className="flex flex-wrap gap-1"><Badge variant="outline">DOCX</Badge><Badge variant={!doc.pdf && selectedPdfFailed(doc) ? "destructive" : "outline"}>{pdfLabel(doc)}</Badge></div></td><td className="px-4 py-3"><ExpiryBadge doc={doc} now={now} /><p className="mt-1 text-xs text-muted-foreground">{dateLabel(doc.expiresAt)}</p></td><td className="px-4 py-3 text-xs text-muted-foreground">{doc.attachedToMail ? "업로드 이력 있음" : "없음"}</td></tr>)}</tbody></table></div>
          <ul className="divide-y border-t md:hidden" aria-busy={loading}>{documents.map((doc) => <li key={doc.id} className="space-y-2 p-4"><div className="flex items-start justify-between gap-3"><Button variant="link" className="min-h-11 justify-start whitespace-normal px-0 text-left" onClick={(event) => openDetails(doc, event.currentTarget)}>{doc.companyName || "고객사 정보 없음"}</Button><ExpiryBadge doc={doc} now={now} /></div><p className="text-xs text-muted-foreground">{doc.serial || "시리얼 정보 없음"} · 점검자 {doc.engineerName || "기록 없음"}</p><div className="flex flex-wrap gap-1"><Badge variant="outline">DOCX</Badge><Badge variant={!doc.pdf && selectedPdfFailed(doc) ? "destructive" : "outline"}>{pdfLabel(doc)}</Badge></div><p className="text-xs text-muted-foreground">생성 {dateLabel(doc.createdAt)} KST<br />기한 {dateLabel(doc.expiresAt)} KST</p></li>)}</ul>
        </> : !loading && !error && <div className="border-t px-5 py-12 text-center"><FileText className="mx-auto mb-3 size-6 text-muted-foreground" aria-hidden /><p className="font-medium">{!hasLoaded ? "문서 목록을 준비하고 있습니다." : hasFilter ? "조건에 맞는 문서가 없습니다." : "생성된 문서가 없습니다."}</p><p className="mt-2 text-sm text-muted-foreground">{hasFilter ? "검색어 또는 필터를 변경해 보세요." : "점검 데이터에서 확인서를 생성하면 여기에 표시됩니다."}</p></div>}
        {(onPrevious || onNext) && <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 sm:px-5"><span className="text-xs text-muted-foreground">{pageNumber}페이지</span><div className="flex gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={pending || !canPrevious} onClick={onPrevious}><ArrowLeft aria-hidden />이전</Button><Button type="button" variant="outline" className="min-h-11" disabled={pending || !hasMore} onClick={onNext}>다음<ArrowRight aria-hidden /></Button></div></div>}
      </div>
      <p className="text-xs text-muted-foreground">사용 기한 만료는 파일 접근 제한입니다. 문서 기록이나 실제 파일의 삭제 여부와는 구분됩니다.</p>
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" finalFocus={() => triggerRef.current?.isConnected ? triggerRef.current : resultHeadingRef.current}>
          <DialogHeader><DialogTitle>문서 상세</DialogTitle><DialogDescription>한 번 생성한 문서의 DOCX·PDF 산출물입니다. 파일을 열거나 메일에 첨부할 수 있습니다.</DialogDescription></DialogHeader>
          {selected && <div className="space-y-5"><dl className="grid grid-cols-[90px_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm"><dt className="text-muted-foreground">고객사</dt><dd className="break-words">{selected.companyName || "기록 없음"}</dd><dt className="text-muted-foreground">시리얼</dt><dd>{selected.serial || "기록 없음"}</dd><dt className="text-muted-foreground">생성 시각</dt><dd>{dateLabel(selected.createdAt)} KST</dd><dt className="text-muted-foreground">사용 기한</dt><dd className="space-y-1"><ExpiryBadge doc={selected} now={now} /><p>{dateLabel(selected.expiresAt)} KST</p></dd><dt className="text-muted-foreground">점검자</dt><dd>{selected.engineerName || "기록 없음"}</dd><dt className="text-muted-foreground">생성 계정</dt><dd className="break-all">{selected.actorEmail || "기록 없음"}</dd><dt className="text-muted-foreground">문서 ID</dt><dd className="break-all font-mono text-xs">{selected.id}</dd><dt className="text-muted-foreground">첨부 이력</dt><dd>{selected.attachedToMail ? "첨부 업로드 이력 있음 · 발송 완료 여부는 메일 이력에서 확인" : "첨부 업로드 이력 없음"}</dd></dl>
            <div className="space-y-3 border-t pt-4"><h4 className="font-medium">파일</h4><div className="rounded-lg border p-3"><p className="break-all text-sm font-medium">{selected.docx.fileName}</p><p className="mt-1 text-xs text-muted-foreground">DOCX · {sizeLabel(selected.docx.size)}</p><Button variant="outline" className="mt-3 min-h-11" disabled={fileActionsDisabled} onClick={() => runFileAction(() => onDownload(selected.docx.downloadUrl, selected.docx.fileName))}><Download aria-hidden />DOCX 다운로드</Button></div>{selected.pdf ? <div className="rounded-lg border p-3"><p className="break-all text-sm font-medium">{selected.pdf.fileName}</p><p className="mt-1 text-xs text-muted-foreground">PDF · {sizeLabel(selected.pdf.size)}</p><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" className="min-h-11" disabled={fileActionsDisabled} onClick={() => runFileAction(() => onPreviewPdf(selected.pdf!.downloadUrl))}><Eye aria-hidden />PDF 미리보기</Button><Button variant="outline" className="min-h-11" disabled={fileActionsDisabled} onClick={() => runFileAction(() => onDownload(selected.pdf!.downloadUrl, selected.pdf!.fileName))}><Download aria-hidden />PDF 다운로드</Button></div></div> : <div className="rounded-lg border border-dashed p-3"><p className="text-sm font-medium">{pdfLabel(selected)}</p><p className="mt-1 break-words text-xs text-muted-foreground">{selectedPdfError || "사용 가능한 PDF가 없습니다. DOCX 생성 결과와 별도로 확인하세요."}</p></div>}</div>
            {(selectedExpiry === "expired" || selectedExpiry === "unknown") && <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{selectedExpiry === "expired" ? "사용 기한이 만료되어 다운로드·미리보기·첨부를 사용할 수 없습니다. 이 문서의 기록은 계속 확인할 수 있습니다." : "사용 기한을 확인할 수 없어 파일 작업을 차단했습니다. 목록을 다시 조회하세요."}</p>}
            {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
            <div className="border-t pt-4"><Button className="min-h-11" disabled={fileActionsDisabled || !selected.pdf} onClick={() => runFileAction(() => { setDetailsOpen(false); onUseForMail(selected); })}><Paperclip aria-hidden />PDF를 메일 첨부에 추가</Button><p className="mt-2 text-xs text-muted-foreground">선택한 발송 모드에 따라 첨부를 업로드합니다. 메일 발송은 작성 화면의 최종 확인에서 별도로 진행합니다.</p></div>
          </div>}
          <DialogFooter><DialogClose render={<Button variant="outline" className="min-h-11" />}>목록으로 돌아가기</DialogClose></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function selectedPdfFailed(doc: DocumentLibraryItem) {
  return typeof doc.pdfStatus === "object" ? !doc.pdfStatus.ok : doc.pdfStatus === "failed";
}
