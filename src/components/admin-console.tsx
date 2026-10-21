"use client";

import { FormEvent, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Copy, RefreshCw, Search, Send, ShieldCheck, UserPlus } from "lucide-react";
import { Alert as UIAlert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DetailDrawer } from "@/components/detail-drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PreviewApi } from "@/lib/preview/api";
import { formatAutoSolveLabel, formatAutoSolveRecord, type AutoSolveOutcome } from "@/lib/ticket-send-presentation";
import { ZendeskConnectionPanel } from "@/components/zendesk-connection-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type UserRole = "viewer" | "operator" | "admin";

type ApiFailure = {
  ok: false;
  code: string;
  message: string;
  requestId?: string;
};

type ApiSuccess<T> = T & {
  ok: true;
  requestId: string;
};

type AdminSummary = {
  auditEvents24h: number;
  documents24h: number;
  ticketSends24h: number;
  failedTicketSends: number;
  pendingInvites: number;
};

type AdminUser = {
  id: string;
  email: string | null;
  displayName: string | null;
  role: string;
  createdAt: string;
  updatedAt: string | null;
  invitedAt: string | null;
  emailConfirmedAt: string | null;
  lastSignInAt: string | null;
  authLookupFailed?: boolean;
};

type AdminAuditLog = {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type AdminTicketSend = AutoSolveOutcome & {
  id: string;
  actorEmail: string | null;
  zendeskTicketId: string | null;
  zendeskTicketUrl: string | null;
  organizationId: string | null;
  requesterEmail: string | null;
  assigneeEmail: string | null;
  subject: string;
  attachmentCount: number;
  status: string;
  errorSummary: string | null;
  createdAt: string;
};

type AdminDocument = {
  id: string;
  actorEmail: string | null;
  companyName: string;
  serial: string;
  engineerName: string | null;
  pdfStatus: string;
  attachedToMail: boolean;
  createdAt: string;
  expiresAt: string;
};

type AdminOverview = {
  summary: AdminSummary;
  users: AdminUser[];
  auditLogs: AdminAuditLog[];
  ticketSends: AdminTicketSend[];
  documents: AdminDocument[];
  authUserLookupWarning: string | null;
  pageInfo?: { section: AdminSection; total: number; hasMore: boolean; nextCursor: string | null; startCursor: string; asOf: string; limit: number };
};

type AdminConsoleProps = {
  accessToken: string;
  apiClient?: PreviewApi;
};

const attachmentRecordNote = "과거 테스트 처리 기록이 포함될 수 있으며, 실제 업로드·메일 발송 완료를 증명하지 않습니다.";

const roleLabels: Record<UserRole, string> = {
  viewer: "조회자",
  operator: "운영자",
  admin: "관리자",
};

const actionLabels: Record<string, string> = {
  "admin.overview.search": "관리자 로그 검색",
  "admin.overview.view": "관리자 화면 조회",
  "admin.user.invite": "팀원 초대",
  "admin.user.invite_failed": "팀원 초대 실패",
  "admin.user.invite_profile_failed": "초대 권한 저장 실패",
  "document.check_report.generate": "점검서 생성",
  "document.check_report.download": "점검서 다운로드",
  "document.check_report.preview": "점검서 미리보기",
  "engineer_signature.upload": "점검자 서명 등록",
  "engineer_signature.delete": "점검자 서명 삭제",
  "settings.zendesk.update": "젠데스크 설정 변경",
  "solution.checkup": "점검 데이터 조회",
  "solution.checkup_failed": "점검 데이터 조회 실패",
  "solution.login": "CRM 로그인",
  "solution.login_failed": "CRM 로그인 실패",
  "solution.logout": "CRM 로그아웃",
  "zendesk.groups.list": "젠데스크 그룹 조회",
  "zendesk.ticket.preview": "메일 미리보기",
  "zendesk.ticket.send": "젠데스크 발송",
  "zendesk.ticket.send_duplicate": "젠데스크 중복 발송 차단",
  "zendesk.ticket.send_failed": "젠데스크 발송 실패",
  "zendesk.ticket.solve_failed": "젠데스크 해결 처리 실패",
  "zendesk.uploads.create": "메일 첨부 업로드",
  "zendesk.uploads.generated": "생성 문서 첨부",
};

const targetTypeLabels: Record<string, string> = {
  admin_console: "관리자 화면",
  app_setting: "앱 설정",
  document: "점검서",
  engineer_signature: "점검자 서명",
  generated_document: "생성 문서",
  solution_serial: "점검 시리얼",
  solution_session: "CRM 세션",
  user: "사용자",
  user_invite: "사용자 초대",
  zendesk_group: "젠데스크 그룹",
  zendesk_ticket: "젠데스크 티켓",
  zendesk_upload: "젠데스크 첨부",
};

const sendStatusLabels: Record<string, string> = {
  success: "성공",
  failed: "실패",
  dry_run: "테스트",
  pending: "대기",
};

const documentStatusLabels: Record<string, string> = {
  success: "생성 완료",
  failed: "생성 실패",
  unavailable: "변환기 사용 불가",
  not_requested: "PDF 미요청",
};

const emptySummary: AdminSummary = {
  auditEvents24h: 0,
  documents24h: 0,
  ticketSends24h: 0,
  failedTicketSends: 0,
  pendingInvites: 0,
};

type AdminSection = "audit" | "sends" | "documents" | "users";
type AdminDetail =
  | { kind: "audit"; row: AdminAuditLog }
  | { kind: "sends"; row: AdminTicketSend }
  | { kind: "documents"; row: AdminDocument }
  | { kind: "users"; row: AdminUser };

const sectionNames: Record<AdminSection, string> = { audit: "감사 로그", sends: "발송 이력", documents: "문서 이력", users: "사용자 · 초대" };
const pageSize = 15;

export function AdminConsole({ accessToken, apiClient }: AdminConsoleProps) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [activeSection, setActiveSection] = useState<AdminSection>("audit");
  const [userQuery, setUserQuery] = useState("");
  const [userRole, setUserRole] = useState("all");
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [actorFilter, setActorFilter] = useState("all");
  const [range, setRange] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const loadedParams = useRef<URLSearchParams | null>(null);
  const [detail, setDetail] = useState<AdminDetail | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("viewer");
  const [inviteName, setInviteName] = useState("");
  const [confirmAdminInvite, setConfirmAdminInvite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const request = useRef<AbortController | null>(null);
  const sessionVersion = useRef(0);
  const detailTrigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    sessionVersion.current += 1;
    // Clear privileged data immediately when the authenticated session changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOverview(null);
    setDetail(null);
    setInviteOpen(false);
    void loadOverview();
    return () => { sessionVersion.current += 1; request.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, apiClient]);

  const serverPaging = Boolean(overview?.pageInfo);
  const filteredAuditLogs = useMemo(() => serverPaging ? (overview?.auditLogs ?? []) : (overview?.auditLogs ?? [])
    .filter(row => actionFilter === "all" || row.action === actionFilter)
    .filter(row => actorFilter === "all" || row.actorEmail === actorFilter)
    .filter(row => withinRange(row.createdAt, range, loadedAt))
    .filter(row => matchesQuery(row, query.trim().toLowerCase())),
  [serverPaging, actionFilter, actorFilter, overview?.auditLogs, query, range, loadedAt]);

  const filteredTicketSends = useMemo(() => serverPaging ? (overview?.ticketSends ?? []) : (overview?.ticketSends ?? [])
    .filter(row => statusFilter === "all" || row.status === statusFilter)
    .filter(row => withinRange(row.createdAt, range, loadedAt))
    .filter(row => matchesQuery(row, query.trim().toLowerCase())),
  [serverPaging, overview?.ticketSends, query, statusFilter, range, loadedAt]);

  const filteredDocuments = useMemo(() => serverPaging ? (overview?.documents ?? []) : (overview?.documents ?? [])
    .filter(row => withinRange(row.createdAt, range, loadedAt))
    .filter(row => matchesQuery(row, query.trim().toLowerCase())),
  [serverPaging, overview?.documents, query, range, loadedAt]);

  const actionOptions = useMemo(() => Array.from(new Set([...Object.keys(actionLabels), ...(overview?.auditLogs ?? []).map(row => row.action)]))
    .sort((left, right) => formatAction(left).localeCompare(formatAction(right), "ko-KR")), [overview?.auditLogs]);
  const filteredUsers = serverPaging ? (overview?.users ?? []) : (overview?.users ?? [])
    .filter(user => matchesQuery(user, userQuery.trim().toLowerCase()))
    .filter(user => userRole === "all" || user.role === userRole);

  async function loadOverview(options: { auditSearch?: boolean; section?: AdminSection; cursor?: string | null; page?: number; useApplied?: boolean; reset?: boolean } = {}) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const version = sessionVersion.current;
    const section = options.section ?? activeSection;
    const params = options.useApplied && loadedParams.current ? new URLSearchParams(loadedParams.current) : new URLSearchParams({ limit: String(pageSize), section });
    params.delete("cursor"); params.delete("audit");
    if (!options.useApplied && !options.reset) {
      const search = section === "users" ? userQuery.trim() : query.trim();
      if (search) params.set("q", search);
      if (section === "users") {
        if (userRole !== "all") params.set("role", userRole);
      } else {
        params.set("range", range);
        if (actorFilter !== "all" && actorFilter.trim()) params.set("actor", actorFilter.trim());
        if (section === "audit" && actionFilter !== "all") params.set("action", actionFilter);
        const statuses = section === "documents" ? ["success", "failed", "unavailable", "not_requested"] : ["success", "failed", "dry_run", "pending"];
        if ((section === "sends" || section === "documents") && statuses.includes(statusFilter)) params.set("status", statusFilter);
      }
    }
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.auditSearch) params.set("audit", "search");
    setBusy(true); setError(null);
    try {
      const data = await apiFetch<AdminOverview>(accessToken, `/api/admin/overview?${params}`, { signal: controller.signal }, apiClient);
      if (controller.signal.aborted || version !== sessionVersion.current) return;
      setOverview(data); setLoadedAt(Date.now()); setDetail(null);
      const nextPage = options.page ?? 0;
      setPage(nextPage);
      if (nextPage === 0) setCursors([data.pageInfo?.startCursor ?? null]);
      else setCursors(previous => [...previous.slice(0, nextPage), options.cursor ?? null]);
      loadedParams.current = params;
    } catch (nextError) {
      if (!controller.signal.aborted && version === sessionVersion.current) setError(nextError instanceof Error ? nextError.message : "관리자 기록을 불러오지 못했습니다.");
    } finally {
      if (request.current === controller && version === sessionVersion.current) setBusy(false);
    }
  }

  function changePage(nextPage: number) {
    if (!serverPaging) { setPage(nextPage); return; }
    const cursor = nextPage > page ? overview?.pageInfo?.nextCursor : cursors[nextPage];
    if (nextPage > page && !cursor) return;
    void loadOverview({ cursor, page: nextPage, useApplied: true });
  }

  async function inviteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || (inviteRole === "admin" && !confirmAdminInvite)) return;
    setNotice(null);
    const version = sessionVersion.current;
    await runBusy("초대 결과를 확인하지 못했습니다. 사용자 목록을 새로 조회한 뒤 확인해 주세요.", async () => {
      const email = inviteEmail.trim();
      await apiFetch(accessToken, "/api/admin/invitations", {
        method: "POST",
        body: JSON.stringify({ email, role: inviteRole, displayName: inviteName }),
      }, apiClient);
      if (version !== sessionVersion.current) return;
      setNotice(`${email} 주소로 초대 메일을 발송했습니다.`);
      setInviteEmail(""); setInviteName(""); setInviteRole("viewer"); setConfirmAdminInvite(false); setInviteOpen(false);
      await loadOverview();
    });
  }

  async function runBusy(label: string, action: () => Promise<void>) {
    const version = sessionVersion.current;
    setBusy(true); setError(null);
    try { await action(); }
    catch (nextError) {
      if (version === sessionVersion.current && !(nextError instanceof DOMException && nextError.name === "AbortError")) {
        setError(nextError instanceof Error ? nextError.message : label);
      }
    } finally { if (version === sessionVersion.current) setBusy(false); }
  }

  function changeSection(section: AdminSection) {
    setActiveSection(section); setPage(0); setDetail(null); setOverview(null);
    const statuses = section === "documents" ? ["all", "success", "failed", "unavailable", "not_requested"] : ["all", "success", "failed", "dry_run", "pending"];
    if (!statuses.includes(statusFilter)) setStatusFilter("all");
    void loadOverview({ section });
  }

  function showDetail(next: AdminDetail, trigger: HTMLElement) {
    detailTrigger.current = trigger; setDetail(next);
  }

  function resetFilters() {
    setQuery(""); setActionFilter("all"); setActorFilter("all"); setRange("all"); setStatusFilter("all");
    setUserQuery(""); setUserRole("all"); setPage(0);
    void loadOverview({ reset: true });
  }

  const summary = overview?.summary ?? emptySummary;
  const rowCount = activeSection === "audit" ? filteredAuditLogs.length : activeSection === "sends" ? filteredTicketSends.length : activeSection === "documents" ? filteredDocuments.length : filteredUsers.length;
  const count = overview?.pageInfo?.total ?? rowCount;
  const currentPage = serverPaging ? page : Math.min(page, Math.max(0, Math.ceil(count / pageSize) - 1));
  const start = serverPaging ? 0 : currentPage * pageSize;
  const displayStart = currentPage * pageSize;
  const summaryItems = [
    { label: "24시간 이벤트", value: summary.auditEvents24h },
    { label: "24시간 문서 생성", value: summary.documents24h },
    { label: "24시간 메일 처리", value: summary.ticketSends24h },
    { label: serverPaging ? "24시간 발송 실패" : "조회된 발송 실패", value: summary.failedTicketSends, danger: summary.failedTicketSends > 0 },
    { label: "현재 페이지 초대 대기", value: activeSection === "users" ? summary.pendingInvites : null },
  ];

  return (
    <section className="admin-workspace space-y-5" aria-label="관리자 운영 기록">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b">
        <nav aria-label="관리자 하위 화면" className="-mb-px flex flex-wrap gap-1 sm:gap-3">
          {(Object.keys(sectionNames) as AdminSection[]).map(section => <button key={section} type="button" aria-current={activeSection === section ? "page" : undefined} disabled={busy} onClick={() => changeSection(section)} className={`min-h-11 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${activeSection === section ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{sectionNames[section]}</button>)}
        </nav>
        <Button type="button" variant="ghost" className="min-h-10" onClick={() => void loadOverview()} disabled={busy}><RefreshCw className={busy ? "animate-spin" : ""} aria-hidden />새로고침</Button>
      </div>

      <div>
        <div className="grid grid-cols-2 divide-x divide-y rounded-lg border bg-card sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
          {summaryItems.map(item => <div key={item.label} className="px-4 py-3"><p className="text-xs text-muted-foreground">{item.label}</p><p className={`mt-1 text-xl font-semibold tabular-nums ${item.danger ? "text-destructive" : ""}`}>{overview ? item.value?.toLocaleString() ?? "—" : "—"}<span className="ml-1 text-xs font-normal text-muted-foreground">건</span></p></div>)}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{apiClient ? "가상 데이터에서 조회한 기록 기준입니다." : "24시간 집계는 전체 DB 기준이며 목록 검색 조건과 별개입니다. 초대 대기는 현재 사용자 페이지에서 확인한 수치입니다."}</p>
      </div>

      {error && !inviteOpen && <UIAlert variant="destructive" role="alert"><AlertDescription>{error} 기존 조회 결과는 유지됩니다.</AlertDescription></UIAlert>}
      {notice && <UIAlert role="status"><AlertDescription>{notice}</AlertDescription></UIAlert>}
      {activeSection === "users" && overview?.authUserLookupWarning && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">사용자 상세 일부를 확인하지 못했습니다. 확인된 목록은 유지되며 미확인 상태는 별도로 표시합니다.</p>}

      <div className={`grid items-start gap-5 ${detail ? "min-[1440px]:grid-cols-[minmax(0,1fr)_420px]" : "grid-cols-1"}`}><div className="min-w-0 space-y-4">
      {activeSection !== "users" ? <form className="flex flex-wrap items-center gap-2" aria-label="관리자 기록 검색" onSubmit={event => { event.preventDefault(); if (!busy) void loadOverview({ auditSearch: true }); }}>
        <CompactSelect label="관리자 기록 기간" value={range} onChange={value => { setRange(value); if (!serverPaging) setPage(0); }} options={[["all", "전체 기간"], ["1", "최근 24시간"], ["7", "최근 7일"], ["30", "최근 30일"], ["90", "최근 90일"]]} />
        <label><span className="sr-only">실행자 이메일 또는 사용자 ID</span><Input className="h-10 w-52" value={actorFilter === "all" ? "" : actorFilter} onChange={event => setActorFilter(event.target.value || "all")} placeholder="실행자 이메일 또는 사용자 ID" /></label>
        {activeSection === "audit" && <CompactSelect label="이벤트 종류" value={actionFilter} onChange={value => { setActionFilter(value); if (!serverPaging) setPage(0); }} options={[["all", "모든 작업"], ...actionOptions.map(value => [value, formatAction(value)] as [string, string])]} />}
        {(activeSection === "sends" || activeSection === "documents") && <CompactSelect label={activeSection === "documents" ? "PDF 처리 결과" : "발송 처리 결과"} value={statusFilter} onChange={value => { setStatusFilter(value); if (!serverPaging) setPage(0); }} options={activeSection === "documents" ? [["all", "모든 PDF 결과"], ["success", "성공"], ["failed", "실패"], ["unavailable", "변환기 사용 불가"], ["not_requested", "PDF 미요청"]] : [["all", "모든 결과"], ["success", "성공"], ["dry_run", "테스트"], ["failed", "실패"], ["pending", "대기"]]} />}
        <label className="relative min-w-48 flex-1"><span className="sr-only">기록 검색어</span><Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" aria-hidden /><Input className="h-10 pl-9" value={query} onChange={event => { setQuery(event.target.value); if (!serverPaging) setPage(0); }} placeholder={activeSection === "audit" ? "작업, 고객사, 시리얼, 대상 ID 검색" : activeSection === "sends" ? "제목, 수신자, 티켓 ID 검색" : "고객사, 시리얼, 점검자 검색"} /></label>
        <Button type="submit" className="min-h-10" disabled={busy}>검색</Button>
        <Button type="button" variant="ghost" className="min-h-10" onClick={resetFilters}>초기화</Button>
      </form> : <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); if (!busy) void loadOverview({ auditSearch: true }); }}>
        <label className="relative min-w-48 flex-1"><span className="sr-only">사용자 목록 검색</span><Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" aria-hidden /><Input className="h-10 pl-9" value={userQuery} onChange={event => { setUserQuery(event.target.value); if (!serverPaging) setPage(0); }} placeholder="사용자 이름, 이메일 검색" /></label>
        <CompactSelect label="사용자 역할" value={userRole} onChange={value => { setUserRole(value); if (!serverPaging) setPage(0); }} options={[["all", "모든 역할"], ["viewer", "조회자"], ["operator", "운영자"], ["admin", "관리자"]]} />
        <Button type="submit" className="min-h-10" disabled={busy}>검색</Button>
        <Button type="button" className="min-h-10" onClick={() => { setDetail(null); setInviteOpen(true); setError(null); }}><UserPlus aria-hidden />팀원 초대</Button>
      </form>}

      <div className="space-y-2" aria-busy={busy}>
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground"><p>{apiClient ? "가상 데이터 내 검색" : "검색 조건에 맞는 전체 기록을 서버에서 조회 · 검색 버튼으로 조건 적용"}</p><p role="status">{busy ? "조회 중 · 이전 결과 표시" : `${sectionNames[activeSection]} ${count.toLocaleString()}건`}</p></div>
        {!overview && busy ? <div className="rounded-lg border bg-card px-5 py-12 text-center text-sm text-muted-foreground">관리자 기록을 불러오는 중입니다.</div> : rowCount === 0 ? <EmptyState text={query || userQuery || actionFilter !== "all" || userRole !== "all" ? "검색 조건에 맞는 기록이 없습니다. 조건을 초기화하거나 서버 검색을 다시 실행하세요." : "현재 조회 범위에 기록이 없습니다."} /> : <div className="overflow-x-auto rounded-lg border bg-card">
          {activeSection === "audit" && <table className="w-full min-w-[760px] text-left text-[13px]"><caption className="sr-only">감사 로그. 작업명을 선택하면 상세 정보를 확인합니다.</caption><thead className="bg-muted/40 text-muted-foreground"><tr><Th>시간</Th><Th>사용자</Th><Th>작업</Th><Th>대상</Th><Th>기록</Th></tr></thead><tbody>{filteredAuditLogs.slice(start, start + pageSize).map(row => <tr key={row.id} className={`h-12 border-t hover:bg-muted/30 ${detail?.row.id === row.id ? "bg-primary/5" : ""}`}><Td className="whitespace-nowrap tabular-nums text-muted-foreground">{formatDateTime(row.createdAt)}</Td><Td><Person name={row.actorEmail ?? row.actorId ?? "시스템"} /></Td><Td><button type="button" className="min-h-10 text-left font-medium text-foreground hover:text-primary hover:underline" onClick={event => showDetail({ kind: "audit", row }, event.currentTarget)}>{formatAction(row.action)}</button></Td><Td className="max-w-64 truncate">{formatTarget(row.targetType, row.targetId, row.metadata)}</Td><Td><Badge variant={row.action.includes("failed") ? "destructive" : "outline"}>{row.action.includes("failed") ? "실패" : "기록됨"}</Badge></Td></tr>)}</tbody></table>}
          {activeSection === "sends" && <table className="w-full min-w-[760px] text-left text-[13px]"><caption className="sr-only">발송 이력. 제목을 선택하면 상세 정보를 확인합니다.</caption><thead className="bg-muted/40 text-muted-foreground"><tr><Th>시간</Th><Th>제목 · 수신자</Th><Th>담당자</Th><Th>첨부</Th><Th>결과</Th><Th>티켓</Th></tr></thead><tbody>{filteredTicketSends.slice(start, start + pageSize).map(row => <tr key={row.id} className="h-12 border-t hover:bg-muted/30"><Td className="whitespace-nowrap tabular-nums text-muted-foreground">{formatDateTime(row.createdAt)}</Td><Td><button type="button" className="block min-h-10 max-w-80 text-left font-medium hover:text-primary" onClick={event => showDetail({ kind: "sends", row }, event.currentTarget)}><span className="block truncate">{row.subject || "제목 없음"}</span><span className="block truncate text-xs font-normal text-muted-foreground">{row.requesterEmail || "수신자 미확인"}</span></button></Td><Td>{row.actorEmail || "—"}</Td><Td>{row.attachmentCount}개</Td><Td><Badge variant={row.status === "failed" ? "destructive" : "outline"}>{formatSendStatus(row.status)}</Badge>{row.status === "success" && <p className="mt-1 text-xs text-muted-foreground">{formatAutoSolveLabel(row)}</p>}</Td><Td className="font-mono">{row.zendeskTicketId ? `#${row.zendeskTicketId}` : "—"}</Td></tr>)}</tbody></table>}
          {activeSection === "documents" && <table className="w-full min-w-[700px] text-left text-[13px]"><caption className="sr-only">문서 생성 이력. 고객사명을 선택하면 상세 정보를 확인합니다.</caption><thead className="bg-muted/40 text-muted-foreground"><tr><Th>생성 시간</Th><Th>고객사 · 시리얼</Th><Th>점검자</Th><Th>PDF</Th><Th>첨부 처리 기록</Th><Th>사용 만료</Th></tr></thead><tbody>{filteredDocuments.slice(start, start + pageSize).map(row => <tr key={row.id} className="h-12 border-t hover:bg-muted/30"><Td className="whitespace-nowrap tabular-nums text-muted-foreground">{formatDateTime(row.createdAt)}</Td><Td><button type="button" className="min-h-10 text-left font-medium hover:text-primary" onClick={event => showDetail({ kind: "documents", row }, event.currentTarget)}>{row.companyName}<span className="block font-mono text-xs font-normal text-muted-foreground">{row.serial}</span></button></Td><Td>{row.engineerName || row.actorEmail || "—"}</Td><Td><Badge variant={row.pdfStatus === "failed" ? "destructive" : "outline"}>{formatDocumentStatus(row.pdfStatus)}</Badge></Td><Td>{row.attachedToMail ? "기록 있음" : "기록 없음"}</Td><Td className="whitespace-nowrap text-muted-foreground">{formatDateTime(row.expiresAt)}</Td></tr>)}</tbody></table>}
          {activeSection === "users" && <table className="w-full min-w-[660px] text-left text-[13px]"><caption className="sr-only">사용자 및 초대 목록. 이름을 선택하면 상세 정보를 확인합니다.</caption><thead className="bg-muted/40 text-muted-foreground"><tr><Th>이름 · 이메일</Th><Th>역할</Th><Th>상태</Th><Th>마지막 로그인</Th><Th>초대 날짜</Th></tr></thead><tbody>{filteredUsers.slice(start, start + pageSize).map(user => <tr key={user.id} className="h-14 border-t hover:bg-muted/30"><Td><button type="button" className="flex min-h-10 items-center gap-3 text-left hover:text-primary" onClick={event => showDetail({ kind: "users", row: user }, event.currentTarget)}><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{(user.displayName || user.email || "?").slice(0, 1).toUpperCase()}</span><span><span className="block font-medium">{user.displayName || "이름 미등록"}</span><span className="block text-xs text-muted-foreground">{user.email || user.id}</span></span></button></Td><Td><Badge variant={user.role === "admin" ? "secondary" : "outline"}>{roleLabels[user.role as UserRole] || user.role}</Badge></Td><Td>{getUserStatus(user)}</Td><Td className="whitespace-nowrap text-muted-foreground">{formatDateTime(user.lastSignInAt)}</Td><Td className="whitespace-nowrap text-muted-foreground">{formatDateTime(user.invitedAt)}</Td></tr>)}</tbody></table>}
        </div>}
        {activeSection === "documents" && <p className="text-xs leading-relaxed text-muted-foreground">{attachmentRecordNote}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs text-muted-foreground"><p>{rowCount ? `${displayStart + 1}–${Math.min(displayStart + (serverPaging ? rowCount : pageSize), count)} / 검색 결과 ${count}건` : `현재 페이지 0건 / 검색 결과 ${count}건`}{loadedAt && <span className="ml-2">· {formatDateTime(new Date(loadedAt).toISOString())} 조회</span>}</p><div className="flex items-center gap-2"><Button type="button" variant="outline" size="icon" aria-label="이전 관리자 기록 페이지" disabled={busy || currentPage === 0} onClick={() => changePage(currentPage - 1)}><ChevronLeft aria-hidden /></Button><span className="min-w-14 text-center">{currentPage + 1} / {Math.max(1, Math.ceil(count / pageSize))}</span><Button type="button" variant="outline" size="icon" aria-label="다음 관리자 기록 페이지" disabled={busy || (serverPaging ? !overview?.pageInfo?.hasMore : start + pageSize >= count)} onClick={() => changePage(currentPage + 1)}><ChevronRight aria-hidden /></Button></div></div>
      </div>

      </div>
      <DetailDrawer open={Boolean(detail)} onOpenChange={open => { if (!open) setDetail(null); }} title={detail ? `${sectionNames[detail.kind]} 상세` : "기록 상세"} description="선택한 기록의 대상과 처리 정보를 확인합니다." returnFocus={() => detailTrigger.current}>
        {detail && <DetailContent detail={detail} onCopy={async value => { try { await navigator.clipboard.writeText(value); setNotice("진단 ID를 복사했습니다."); } catch { setNotice("복사하지 못했습니다. 상세 화면의 ID를 직접 선택해 복사하세요."); } }} />}
      </DetailDrawer>
      </div>

      <details className="admin-connections rounded-lg border bg-card" open>
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm font-medium"><ShieldCheck className="size-4 text-primary" aria-hidden />업무 시스템 연결<ChevronDown className="ml-auto size-4 text-muted-foreground" aria-hidden /></summary>
        <div className="border-t [&_section]:rounded-none [&_section]:border-0 [&_section]:p-4 [&_h3]:text-sm [&_p]:text-xs"><ZendeskConnectionPanel key={accessToken} accessToken={accessToken} apiClient={apiClient} /></div>
      </details>

      <AdminDrawer open={inviteOpen} onOpenChange={open => { if (!busy) setInviteOpen(open); }} title="팀원 초대" description="초대 이메일과 부여할 역할을 확인하세요. 초대받은 팀원이 직접 비밀번호를 설정합니다.">
        <form className="space-y-5" onSubmit={inviteUser}>
          {error && <UIAlert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></UIAlert>}
          <div className="space-y-2"><Label htmlFor="invite-email">이메일</Label><Input id="invite-email" type="email" className="h-11" value={inviteEmail} onChange={event => { setInviteEmail(event.target.value); setConfirmAdminInvite(false); }} placeholder="member@example.com" required disabled={busy} /></div>
          <div className="space-y-2"><Label htmlFor="invite-name">표시 이름 <span className="font-normal text-muted-foreground">선택</span></Label><Input id="invite-name" className="h-11" value={inviteName} onChange={event => setInviteName(event.target.value)} placeholder="팀원 이름" disabled={busy} /></div>
          <div className="space-y-2"><Label>역할</Label><Select value={inviteRole} disabled={busy} onValueChange={value => { setInviteRole((value as UserRole | null) || "viewer"); setConfirmAdminInvite(false); }}><SelectTrigger className="min-h-11 w-full" aria-label="초대 역할"><SelectValue>{roleLabels[inviteRole]}</SelectValue></SelectTrigger><SelectContent><SelectItem value="viewer">조회자</SelectItem><SelectItem value="operator">운영자</SelectItem><SelectItem value="admin">관리자</SelectItem></SelectContent></Select><p className="text-xs leading-relaxed text-muted-foreground">조회자: 기록 열람 · 운영자: 점검과 발송 · 관리자: 사용자 초대와 운영 설정 관리</p></div>
          {inviteRole === "admin" && <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><input type="checkbox" className="mt-0.5 size-4" checked={confirmAdminInvite} disabled={busy} onChange={event => setConfirmAdminInvite(event.target.checked)} /><span>관리자 권한으로 초대합니다. 사용자 초대와 운영 설정 변경 권한을 부여하는 것을 확인했습니다.</span></label>}
          <div className="rounded-lg bg-muted/50 px-4 py-3 text-sm"><p className="font-medium break-all">{inviteEmail.trim() || "초대 이메일을 입력하세요"}</p><p className="mt-1 text-muted-foreground">부여 역할: {roleLabels[inviteRole]}</p></div>
          {apiClient && <p className="text-xs text-muted-foreground">가상 데이터 화면에서는 실제 초대 메일을 발송하지 않습니다.</p>}
          <div className="flex gap-2 border-t pt-4"><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => setInviteOpen(false)}>닫기</Button><Button type="submit" className="min-h-11 flex-1" disabled={busy || !inviteEmail.trim() || (inviteRole === "admin" && !confirmAdminInvite)}><Send aria-hidden />{busy ? "초대 중" : "초대 보내기"}</Button></div>
        </form>
      </AdminDrawer>
    </section>
  );
}

function CompactSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return <Select value={value} onValueChange={next => onChange(next || "all")}><SelectTrigger className="min-h-10 max-w-64 text-[13px]" aria-label={label}><SelectValue>{options.find(option => option[0] === value)?.[1] || value}</SelectValue></SelectTrigger><SelectContent>{options.map(([key, text]) => <SelectItem key={key} value={key}>{text}</SelectItem>)}</SelectContent></Select>;
}

function Person({ name }: { name: string }) {
  return <span className="flex items-center gap-2"><span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">{name.slice(0, 1).toUpperCase()}</span><span className="max-w-40 truncate" title={name}>{name}</span></span>;
}

function AdminDrawer({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; children: ReactNode }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="detail-drawer top-0 right-0 left-auto h-dvh w-full max-w-full translate-x-0 translate-y-0 content-start gap-6 overflow-y-auto rounded-none border-l p-6 sm:max-w-[440px]"><div className="space-y-2 border-b pb-5 pr-7"><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></div>{children}</DialogContent></Dialog>;
}

function DetailContent({ detail, onCopy }: { detail: AdminDetail; onCopy: (value: string) => Promise<void> }) {
  const { row } = detail;
  let fields: [string, string | null][] = [];
  let heading = "";
  let status = "";
  let failed = false;
  if (detail.kind === "audit") {
    heading = formatAction(detail.row.action); failed = detail.row.action.includes("failed"); status = failed ? "실패 기록" : "감사 기록";
    fields = [["사용자", detail.row.actorEmail || detail.row.actorId], ["대상", formatTarget(detail.row.targetType, detail.row.targetId, detail.row.metadata)], ["작업", detail.row.action], ["요약", summarizeMetadata(detail.row.metadata)]];
  } else if (detail.kind === "sends") {
    heading = detail.row.subject || "제목 없음"; status = formatSendStatus(detail.row.status); failed = detail.row.status === "failed";
    fields = [["실행자", detail.row.actorEmail], ["수신자", detail.row.requesterEmail], ["담당자", detail.row.assigneeEmail], ["조직 ID", detail.row.organizationId], ["티켓 ID", detail.row.zendeskTicketId], ["첨부", `${detail.row.attachmentCount}개`], ["처리 오류", detail.row.errorSummary]];
    if (detail.row.status === "success") fields.push(["자동 해결", formatAutoSolveLabel(detail.row)], ["해결 오류", detail.row.autoSolveError ?? null]);
    const solveRecord = formatAutoSolveRecord(detail.row);
    if (solveRecord) fields.push(["결과 기록", solveRecord]);
  } else if (detail.kind === "documents") {
    heading = detail.row.companyName; status = formatDocumentStatus(detail.row.pdfStatus); failed = detail.row.pdfStatus === "failed";
    fields = [["시리얼", detail.row.serial], ["생성자", detail.row.actorEmail], ["점검자", detail.row.engineerName], ["첨부 처리 기록", detail.row.attachedToMail ? "기록 있음" : "기록 없음"], ["사용 만료", formatDateTime(detail.row.expiresAt)]];
  } else {
    heading = detail.row.displayName || detail.row.email || "사용자"; status = getUserStatus(detail.row);
    fields = [["이메일", detail.row.email], ["역할", roleLabels[detail.row.role as UserRole] || detail.row.role], ["초대 날짜", formatDateTime(detail.row.invitedAt)], ["이메일 확인", formatDateTime(detail.row.emailConfirmedAt)], ["마지막 로그인", formatDateTime(detail.row.lastSignInAt)]];
  }
  const requestId = detail.kind === "audit" ? stringValue(detail.row.metadata.requestId) || stringValue(detail.row.metadata.request_id) : "";
  return <div className="space-y-6"><div className={`rounded-lg p-4 ${failed ? "bg-red-50 text-red-900" : "bg-muted/60"}`}><Badge variant={failed ? "destructive" : "outline"}>{status}</Badge><h3 className="mt-3 text-base font-semibold break-words">{heading}</h3><p className="mt-1 text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</p></div><dl className="space-y-4">{fields.map(([label, value]) => <div key={label} className="grid grid-cols-[88px_1fr] gap-3 text-[13px]"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 break-words">{value || "—"}</dd></div>)}</dl>{detail.kind === "documents" && <p className="text-xs leading-relaxed text-muted-foreground">{attachmentRecordNote}</p>}{detail.kind === "sends" && safeTicketUrl(detail.row.zendeskTicketUrl) && <a className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-primary hover:underline" href={detail.row.zendeskTicketUrl!} target="_blank" rel="noreferrer">Zendesk에서 티켓 확인<ArrowUpRight className="size-4" aria-hidden /></a>}<div className="space-y-3 border-t pt-5"><h3 className="text-sm font-semibold">추적 정보</h3>{requestId && <CopyField label="요청 ID" value={requestId} onCopy={onCopy} />}<CopyField label={detail.kind === "users" ? "사용자 ID" : "기록 ID"} value={row.id} onCopy={onCopy} /><p className="text-xs text-muted-foreground">기록 생성: {formatDateTime(row.createdAt)}</p></div></div>;
}

function CopyField({ label, value, onCopy }: { label: string; value: string; onCopy: (value: string) => Promise<void> }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><div className="mt-1 flex items-start gap-2"><code className="min-w-0 flex-1 break-all text-xs">{value}</code><Button type="button" variant="ghost" size="icon" className="size-9 shrink-0" aria-label={`${label} 복사`} onClick={() => void onCopy(value)}><Copy className="size-3.5" aria-hidden /></Button></div></div>;
}

function withinRange(value: string, range: string, now: number | null) {
  if (range === "all" || now === null) return true;
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= now - Number(range) * 86_400_000;
}

function safeTicketUrl(value: string | null) {
  if (!value) return false;
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname.endsWith(".zendesk.com"); } catch { return false; }
}

async function apiFetch<T>(accessToken: string, path: string, init: RequestInit = {}, apiClient?: PreviewApi) {
  if (apiClient) return await apiClient(path, init) as ApiSuccess<T>;
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  headers.set("x-request-id", crypto.randomUUID());
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(path, { ...init, headers });
  const data = (await response.json()) as ApiSuccess<T> | ApiFailure;
  if (!data.ok) {
    throw new Error(data.message || "요청을 처리할 수 없습니다.");
  }
  return data as ApiSuccess<T>;
}

function Th({ children }: { children: ReactNode }) {
  return <th className="px-3 py-2 font-medium">{children}</th>;
}

function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-middle ${className}`}>{children}</td>;
}

function EmptyState({ text }: { text: string }) {
  return <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">{text}</p>;
}

function matchesQuery(value: unknown, query: string) {
  if (!query) {
    return true;
  }
  return JSON.stringify(value).toLowerCase().includes(query);
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatAction(action: string) {
  return actionLabels[action] ?? humanizeInternalKey(action);
}

function formatSendStatus(status: string) {
  return sendStatusLabels[status] ?? humanizeInternalKey(status);
}

function formatDocumentStatus(status: string) {
  return documentStatusLabels[status] ?? humanizeInternalKey(status);
}

function formatTarget(targetType: string | null, targetId: string | null, metadata: Record<string, unknown> = {}) {
  const typeLabel = targetType ? targetTypeLabels[targetType] ?? humanizeInternalKey(targetType) : "";
  const fileName = stringValue(metadata.fileName);
  if (targetType === "document" && fileName) {
    return `${typeLabel || "점검서"} / ${fileName}`;
  }
  return [typeLabel, targetId].filter(Boolean).join(" / ") || "-";
}

function humanizeInternalKey(value: string) {
  return value.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim() || value;
}

function getUserStatus(user: AdminUser) {
  if (user.authLookupFailed) return "인증 정보 미확인";
  if (user.lastSignInAt) {
    return "활성 사용자";
  }
  if (user.invitedAt && !user.emailConfirmedAt) {
    return "초대 대기";
  }
  if (user.emailConfirmedAt) {
    return "가입 완료 · 미접속";
  }
  return "미확인";
}

function summarizeMetadata(metadata: Record<string, unknown>) {
  const serial = stringValue(metadata.serial);
  const company = stringValue(metadata.companyName);
  const fileName = stringValue(metadata.fileName);
  const type = stringValue(metadata.type).toUpperCase();
  const requester = stringValue(metadata.requesterEmail);
  const error = stringValue(metadata.errorSummary);
  return [fileName, type, serial, company, requester, error].filter(Boolean).join(" · ") || "-";
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
