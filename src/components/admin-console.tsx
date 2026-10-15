"use client";

import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import { RefreshCw, Search, Send, ShieldCheck } from "lucide-react";
import { Alert as UIAlert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PreviewApi } from "@/lib/preview/api";
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

type AdminTicketSend = {
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
};

type AdminConsoleProps = {
  accessToken: string;
  apiClient?: PreviewApi;
};

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
  pending: "생성 대기",
};

const emptySummary: AdminSummary = {
  auditEvents24h: 0,
  documents24h: 0,
  ticketSends24h: 0,
  failedTicketSends: 0,
  pendingInvites: 0,
};

export function AdminConsole({ accessToken, apiClient }: AdminConsoleProps) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [activeSection, setActiveSection] = useState<"audit" | "sends" | "documents" | "users">("audit");
  const [userQuery, setUserQuery] = useState("");
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("viewer");
  const [inviteName, setInviteName] = useState("");
  const [confirmAdminInvite, setConfirmAdminInvite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, apiClient]);

  const filteredAuditLogs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (overview?.auditLogs ?? [])
      .filter((row) => actionFilter === "all" || row.action === actionFilter)
      .filter((row) => matchesQuery(row, normalizedQuery));
  }, [actionFilter, overview?.auditLogs, query]);

  const filteredTicketSends = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (overview?.ticketSends ?? [])
      .filter((row) => statusFilter === "all" || row.status === statusFilter)
      .filter((row) => matchesQuery(row, normalizedQuery));
  }, [overview?.ticketSends, query, statusFilter]);

  const filteredDocuments = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (overview?.documents ?? []).filter((row) => matchesQuery(row, normalizedQuery));
  }, [overview?.documents, query]);

  const actionOptions = useMemo(() => {
    return Array.from(new Set((overview?.auditLogs ?? []).map((row) => row.action))).sort((left, right) =>
      formatAction(left).localeCompare(formatAction(right), "ko-KR"),
    );
  }, [overview?.auditLogs]);

  async function loadOverview(options: { auditSearch?: boolean } = {}) {
    await runBusy("관리자 로그를 불러오는 중입니다.", async () => {
      const params = new URLSearchParams({ limit: "100" });
      if (options.auditSearch) {
        params.set("audit", "search");
      }
      const trimmedQuery = query.trim();
      if (trimmedQuery) {
        params.set("q", trimmedQuery);
      }
      if (activeSection === "audit" && actionFilter !== "all") {
        params.set("action", actionFilter);
      }
      if (activeSection === "sends" && statusFilter !== "all") {
        params.set("status", statusFilter);
      }
      const data = await apiFetch<AdminOverview>(accessToken, `/api/admin/overview?${params.toString()}`, {}, apiClient);
      setOverview({
        summary: data.summary,
        users: data.users,
        auditLogs: data.auditLogs,
        ticketSends: data.ticketSends,
        documents: data.documents,
        authUserLookupWarning: data.authUserLookupWarning,
      });
    });
  }

  async function inviteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    await runBusy("초대 메일을 발송하는 중입니다.", async () => {
      await apiFetch(accessToken, "/api/admin/invitations", {
        method: "POST",
        body: JSON.stringify({
          email: inviteEmail,
          role: inviteRole,
          displayName: inviteName,
        }),
      }, apiClient);
      setNotice(`${inviteEmail} 주소로 초대 메일을 발송했습니다.`);
      setInviteEmail("");
      setInviteName("");
      setInviteRole("viewer");
      setConfirmAdminInvite(false);
      await loadOverview();
    });
  }

  async function runBusy(label: string, action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : label);
    } finally {
      setBusy(false);
    }
  }

  const summary = overview?.summary ?? emptySummary;
  const adminInviteNeedsConfirmation = inviteRole === "admin" && !confirmAdminInvite;

  const filteredUsers = (overview?.users ?? []).filter((user) => matchesQuery(user, userQuery.trim().toLowerCase()));
  const sectionNames = { audit: "감사 로그", sends: "발송 이력", documents: "문서 이력", users: "사용자 · 초대" } as const;

  return (
    <section className="space-y-4 py-6" aria-labelledby="admin-panel-title">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="admin-panel-title" className="text-xl font-semibold tracking-tight">관리자</h2><p className="mt-1 text-sm text-muted-foreground">기록 조회와 팀원 관리를 목적별로 확인하세요.</p></div>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => void loadOverview()} disabled={busy}><RefreshCw aria-hidden />{busy ? "조회 중" : "새로고침"}</Button>
      </header>
      <ZendeskConnectionPanel key={accessToken} accessToken={accessToken} apiClient={apiClient} />
      <p className="rounded-lg border bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground">아래 수치와 목록은 서버에서 불러온 최근 조회 표본 기준입니다. 기본 목록은 최대 100건이며, 검색도 최근 최대 1,000개 후보 안에서 수행합니다. 전체 데이터의 전수 검색·정확한 전체 통계로 해석하지 마세요.</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="표본 내 24시간 이벤트" value={summary.auditEvents24h} />
        <SummaryCard label="표본 내 문서 생성" value={summary.documents24h} />
        <SummaryCard label="표본 내 메일 처리" value={summary.ticketSends24h} />
        <SummaryCard label="표본 내 발송 실패" value={summary.failedTicketSends} tone={summary.failedTicketSends > 0 ? "danger" : "default"} />
        <SummaryCard label="확인된 초대 대기" value={summary.pendingInvites} />
      </div>
      <div role="group" aria-label="관리자 화면 선택" className="flex flex-wrap gap-2 border-b pb-3">
        {(Object.keys(sectionNames) as Array<keyof typeof sectionNames>).map((section) => <Button key={section} type="button" className="min-h-11" variant={activeSection === section ? "default" : "outline"} aria-pressed={activeSection === section} onClick={() => setActiveSection(section)}>{sectionNames[section]}</Button>)}
      </div>
      {error && <UIAlert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></UIAlert>}
      {notice && <UIAlert role="status"><AlertDescription>{notice}</AlertDescription></UIAlert>}
      {activeSection !== "users" && <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" aria-hidden />{sectionNames[activeSection]} 검색</CardTitle><CardDescription>조회된 표본을 먼저 필터링합니다. 검색 버튼으로 서버의 최근 후보를 다시 조회합니다.</CardDescription></CardHeader>
        <CardContent><form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); if (!busy) void loadOverview({ auditSearch: true }); }}>
          <label className="min-w-[180px] flex-1 space-y-1.5"><span className="text-xs font-medium text-muted-foreground">검색어</span><Input className="h-11" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="기록의 사용자, 고객사, 시리얼, 티켓 ID" /></label>
          {activeSection === "audit" && <div className="w-full space-y-1.5 sm:w-56"><Label>이벤트 종류</Label><Select value={actionFilter} onValueChange={(value) => setActionFilter(value ?? "all")}><SelectTrigger className="min-h-11 w-full" aria-label="이벤트 종류"><SelectValue>{actionFilter === "all" ? "모든 이벤트" : formatAction(actionFilter)}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">모든 이벤트</SelectItem>{actionOptions.map((action) => <SelectItem key={action} value={action}>{formatAction(action)}</SelectItem>)}</SelectContent></Select></div>}
          {activeSection === "sends" && <div className="w-full space-y-1.5 sm:w-40"><Label>처리 결과</Label><Select value={statusFilter} onValueChange={(value) => setStatusFilter(value ?? "all")}><SelectTrigger className="min-h-11 w-full" aria-label="발송 처리 결과"><SelectValue>{statusFilter === "all" ? "모든 상태" : formatSendStatus(statusFilter)}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">모든 상태</SelectItem><SelectItem value="success">성공</SelectItem><SelectItem value="dry_run">테스트</SelectItem><SelectItem value="failed">실패</SelectItem><SelectItem value="pending">대기</SelectItem></SelectContent></Select></div>}
          <Button type="submit" variant="secondary" className="min-h-11" disabled={busy}><Search aria-hidden />검색</Button>
        </form></CardContent>
      </Card>}
      {activeSection === "audit" && <Card><CardHeader><CardTitle>감사 이벤트 {filteredAuditLogs.length}건</CardTitle><CardDescription>시리얼 조회, 문서 생성, 메일 처리, 설정 변경과 초대 기록입니다.</CardDescription></CardHeader><CardContent><LogTable logs={filteredAuditLogs} /></CardContent></Card>}
      {activeSection === "sends" && <TicketSendTable rows={filteredTicketSends} />}
      {activeSection === "documents" && <DocumentTable rows={filteredDocuments} />}
      {activeSection === "users" && <div className="space-y-4">
        {overview?.authUserLookupWarning && <UIAlert><AlertDescription>사용자 상세 일부를 확인하지 못했습니다. 아래 목록은 확인된 정보이며, 미확인 상태를 탈퇴나 가입 전으로 단정하지 마세요.</AlertDescription></UIAlert>}
        <label className="block max-w-xl space-y-1.5"><span className="text-sm font-medium">사용자 목록에서 검색</span><Input className="h-11" value={userQuery} onChange={(event) => setUserQuery(event.target.value)} placeholder="사용자 이름, 이메일, 역할" /></label>
        <UserList users={filteredUsers} />
        <div className="max-w-2xl"><Card>
            <CardHeader>
              <CardTitle>팀원 초대</CardTitle>
              <CardDescription>초대받은 팀원이 직접 비밀번호를 설정합니다.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={inviteUser}>
                <div className="space-y-1.5">
                  <Label htmlFor="invite-email">이메일</Label>
                  <Input
                    className="h-11"
                    id="invite-email"
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="member@example.com"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invite-name">표시 이름</Label>
                  <Input
                    className="h-11"
                    id="invite-name"
                    value={inviteName}
                    onChange={(event) => setInviteName(event.target.value)}
                    placeholder="선택 입력"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>역할</Label>
                  <Select
                    value={inviteRole}
                    onValueChange={(value) => {
                      const nextRole = (value as UserRole | null) ?? "viewer";
                      setInviteRole(nextRole);
                      if (nextRole !== "admin") {
                        setConfirmAdminInvite(false);
                      }
                    }}
                  >
                    <SelectTrigger className="min-h-11 w-full" aria-label="초대 역할">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viewer">조회자</SelectItem>
                      <SelectItem value="operator">운영자</SelectItem>
                      <SelectItem value="admin">관리자</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    조회자는 열람, 운영자는 점검/발송, 관리자는 사용자 초대와 설정 관리까지 가능합니다.
                  </p>
                </div>
                {inviteRole === "admin" ? (
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4"
                      checked={confirmAdminInvite}
                      onChange={(event) => setConfirmAdminInvite(event.target.checked)}
                    />
                    <span>관리자 권한은 팀원 초대와 운영 설정 변경 권한을 포함합니다. 이 권한으로 초대하는 것을 확인했습니다.</span>
                  </label>
                ) : null}
                <Button type="submit" className="min-h-11 w-full" disabled={busy || adminInviteNeedsConfirmation}>
                  <Send />
                  초대 보내기
                </Button>
              </form>
            </CardContent>
          </Card></div>
        {apiClient && <p className="text-xs text-muted-foreground">가상 데이터 화면에서는 실제 초대 메일을 발송하지 않습니다.</p>}
      </div>}
    </section>
  );
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

function SummaryCard({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "danger" }) {
  return (
    <Card size="sm" className={tone === "danger" ? "border-red-200 bg-red-50/60 dark:border-red-500/30 dark:bg-red-500/10" : ""}>
      <CardContent>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}

function LogTable({ logs }: { logs: AdminAuditLog[] }) {
  if (logs.length === 0) {
    return <EmptyState text="감사 로그가 없습니다." />;
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[760px] text-left text-xs">
        <thead className="bg-muted/60 text-muted-foreground">
          <tr>
            <Th>시간</Th>
            <Th>사용자</Th>
            <Th>작업</Th>
            <Th>대상</Th>
            <Th>요약</Th>
          </tr>
        </thead>
        <tbody>
          {logs.map((row) => (
            <tr key={row.id} className="border-t">
              <Td>{formatDateTime(row.createdAt)}</Td>
              <Td>{row.actorEmail ?? row.actorId ?? "-"}</Td>
              <Td>
                <Badge variant={row.action.includes("failed") ? "destructive" : "outline"}>{formatAction(row.action)}</Badge>
              </Td>
              <Td>{formatTarget(row.targetType, row.targetId, row.metadata)}</Td>
              <Td className="max-w-[280px] truncate">{summarizeMetadata(row.metadata)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TicketSendTable({ rows }: { rows: AdminTicketSend[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>젠데스크 발송 이력</CardTitle>
        <CardDescription>수신자, 제목, 티켓 ID와 발송 결과입니다.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState text="발송 이력이 없습니다." />
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.id} className="rounded-lg border p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-medium">{row.subject}</p>
                  <Badge variant={row.status === "failed" ? "destructive" : "secondary"}>{formatSendStatus(row.status)}</Badge>
                </div>
                <p className="mt-1 text-muted-foreground">{row.requesterEmail ?? "-"} · {row.actorEmail ?? "-"}</p>
                <p className="mt-1 text-muted-foreground">{formatDateTime(row.createdAt)} · 첨부 {row.attachmentCount}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DocumentTable({ rows }: { rows: AdminDocument[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>점검서 생성 이력</CardTitle>
        <CardDescription>생성된 DOCX/PDF와 메일 첨부 여부입니다.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState text="생성된 점검서가 없습니다." />
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.id} className="rounded-lg border p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-medium">{row.companyName}</p>
                  <Badge variant={row.pdfStatus === "success" ? "secondary" : "outline"}>{formatDocumentStatus(row.pdfStatus)}</Badge>
                </div>
                <p className="mt-1 text-muted-foreground">{row.serial} · {row.actorEmail ?? "-"}</p>
                <p className="mt-1 text-muted-foreground">{formatDateTime(row.createdAt)} · 메일 첨부 {row.attachedToMail ? "완료" : "대기"}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function UserList({ users }: { users: AdminUser[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>사용자</CardTitle>
        <CardDescription>역할과 초대/로그인 상태입니다.</CardDescription>
      </CardHeader>
      <CardContent>
        {users.length === 0 ? (
          <EmptyState text="사용자가 없습니다." />
        ) : (
          <div className="space-y-2">
            {users.map((user) => {
              const status = getUserStatus(user);
              return (
                <div key={user.id} className="rounded-lg border p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-medium">{user.email ?? user.id}</p>
                    <Badge variant={user.role === "admin" ? "default" : "outline"}>{roleLabels[user.role as UserRole] ?? user.role}</Badge>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {status} · 마지막 로그인 {user.lastSignInAt ? formatDateTime(user.lastSignInAt) : "-"}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
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
  if (user.lastSignInAt) {
    return "활성 사용자";
  }
  if (user.invitedAt && !user.emailConfirmedAt) {
    return "초대 대기";
  }
  if (user.emailConfirmedAt) {
    return "가입 완료 · 미접속";
  }
  return "미접속";
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
