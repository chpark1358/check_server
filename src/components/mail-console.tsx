"use client";

import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { CheckFlowPanel } from "@/components/check-flow/check-flow-panel";
import type { CheckResult } from "@/components/check-flow/check-flow-panel";

type ZendeskSettings = {
  defaultGroupId: string | null;
  defaultGroupName: string | null;
  fixedAssigneeEmail: string | null;
  autoSolveDefault: boolean;
  fields: Record<string, string | number>;
  defaultValues: Record<string, string>;
};

type Organization = {
  id: number | string;
  name?: string;
  details?: string | null;
  external_id?: string | null;
  matched_serial?: string | null;
  organization_fields?: Record<string, unknown> | null;
};

type ZendeskUser = {
  id: number | string;
  name?: string | null;
  email?: string | null;
  match_score?: number;
  match_reason?: string;
};

type TicketSendRow = {
  id: string;
  zendesk_ticket_id: string | null;
  zendesk_ticket_url: string | null;
  organization_id: string | null;
  requester_email: string | null;
  subject: string;
  attachment_count: number;
  auto_solved: boolean;
  status: "pending" | "success" | "failed" | "dry_run";
  error_summary: string | null;
  created_at: string;
};

type UploadResult = {
  token: string;
  fileName: string;
  size: number;
  dryRun: boolean;
};

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

const maxFiles = 5;
const maxFileBytes = 10 * 1024 * 1024;
const maxTotalBytes = 25 * 1024 * 1024;
const allowedExtensions = new Set([
  ".csv",
  ".doc",
  ".docx",
  ".jpeg",
  ".jpg",
  ".log",
  ".pdf",
  ".png",
  ".txt",
  ".xls",
  ".xlsx",
  ".zip",
]);

export function MailConsole() {
  const [clientState] = useState<{ supabase: SupabaseClient | null; error: string | null }>(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return {
        supabase: null,
        error: "NEXT_PUBLIC_SUPABASE_URL 또는 NEXT_PUBLIC_SUPABASE_ANON_KEY 설정이 필요합니다.",
      };
    }

    try {
      return { supabase: createBrowserSupabaseClient(), error: null };
    } catch (nextError) {
      return {
        supabase: null,
        error: nextError instanceof Error ? nextError.message : "Supabase 설정을 확인할 수 없습니다.",
      };
    }
  });
  const supabase = clientState.supabase;
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(clientState.error);
  const [settings, setSettings] = useState<ZendeskSettings | null>(null);
  const [sendMode, setSendMode] = useState<"real" | "dry-run" | null>(null);
  const [appEnv, setAppEnv] = useState<string | null>(null);
  const [history, setHistory] = useState<TicketSendRow[]>([]);
  const [query, setQuery] = useState("");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [users, setUsers] = useState<ZendeskUser[]>([]);
  const [requesterEmail, setRequesterEmail] = useState("");
  const [requesterName, setRequesterName] = useState("");
  const [latestCheckResult, setLatestCheckResult] = useState<CheckResult | null>(null);
  const [orgMatchStatus, setOrgMatchStatus] = useState("자동 매칭 대기");
  const [subjectDirty, setSubjectDirty] = useState(false);
  const [bodyDirty, setBodyDirty] = useState(false);
  const [subject, setSubject] = useState("[지란지교소프트] 오피스키퍼 정기점검 확인서 송부");
  const [body, setBody] = useState(buildMailBody("담당자"));
  const [autoSolved, setAutoSolved] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const configuredFields = useMemo(() => {
    if (!settings) {
      return [];
    }

    return Object.entries(settings.fields).map(([name, id]) => ({
      name,
      id,
      value: settings.defaultValues[name] ?? "",
    }));
  }, [settings]);

  const isReady =
    Boolean(session) &&
    Boolean(settings?.defaultGroupId) &&
    Boolean(settings?.fixedAssigneeEmail) &&
    Boolean(selectedOrg) &&
    requesterEmail.trim().length > 0 &&
    subject.trim().length > 0 &&
    body.trim().length > 0;

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError(null);

    if (!supabase) {
      setAuthError("Supabase 클라이언트 설정이 필요합니다.");
      return;
    }

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setAuthError(signInError.message);
      return;
    }

    setSession(data.session);
    if (data.session?.access_token) {
      await loadInitialData(data.session.access_token);
    }
  }

  async function signOut() {
    await supabase?.auth.signOut();
    setSession(null);
  }

  async function apiFetchWithToken<T>(accessToken: string, path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${accessToken}`);
    headers.set("x-request-id", crypto.randomUUID());

    if (init.body && !(init.body instanceof FormData)) {
      headers.set("content-type", "application/json");
    }

    const response = await fetch(path, {
      ...init,
      headers,
    });
    const data = (await response.json()) as ApiSuccess<T> | ApiFailure;

    if (!data.ok) {
      throw new Error(data.message || "요청을 처리할 수 없습니다.");
    }

    return data as ApiSuccess<T>;
  }

  async function apiFetch<T>(path: string, init: RequestInit = {}) {
    if (!session?.access_token) {
      throw new Error("로그인이 필요합니다.");
    }

    return apiFetchWithToken<T>(session.access_token, path, init);
  }

  async function loadSettings(accessToken = session?.access_token) {
    if (!accessToken) {
      return;
    }

    const response = await apiFetchWithToken<{ settings: ZendeskSettings }>(accessToken, "/api/settings/zendesk");
    setSettings(response.settings);
    setAutoSolved(response.settings.autoSolveDefault);
  }

  async function loadHistory(accessToken = session?.access_token) {
    if (!accessToken) {
      return;
    }

    const response = await apiFetchWithToken<{ sends: TicketSendRow[] }>(
      accessToken,
      "/api/history/ticket-sends?limit=10",
    );
    setHistory(response.sends);
  }

  async function loadHealth(accessToken = session?.access_token) {
    if (!accessToken) {
      return;
    }

    const response = await apiFetchWithToken<{ zendeskSendMode: "real" | "dry-run"; env: string }>(
      accessToken,
      "/api/health",
    );
    setSendMode(response.zendeskSendMode);
    setAppEnv(response.env);
  }

  async function loadInitialData(accessToken: string) {
    await Promise.all([loadSettings(accessToken), loadHistory(accessToken), loadHealth(accessToken)]);
  }

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) {
        return;
      }

      setSession(data.session);
      if (data.session?.access_token) {
        void loadInitialData(data.session.access_token);
      }
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.access_token) {
        void loadInitialData(nextSession.access_token);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
    // loadInitialData intentionally reads the latest session token supplied by Supabase callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  async function searchOrganizations(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setError(null);

    if (query.trim().length < 2) {
      setError("조직 검색어는 2자 이상 입력하세요.");
      return;
    }

    await runBusy("조직 검색 중", async () => {
      const response = await apiFetch<{ organizations: Organization[] }>(
        `/api/zendesk/organizations?query=${encodeURIComponent(query.trim())}`,
      );
      setOrganizations(response.organizations);
      setOrgMatchStatus(response.organizations.length > 0 ? "회사명 검색 결과" : "검색 결과 없음");
    });
  }

  async function selectOrganization(org: Organization) {
    setSelectedOrg(org);
    setRequesterEmail("");
    setRequesterName("");
    setUsers([]);

    await runBusy("요청자 조회 중", async () => {
      const response = await apiFetch<{ users: ZendeskUser[] }>(
        `/api/zendesk/users?organizationId=${encodeURIComponent(String(org.id))}`,
      );
      setUsers(response.users);
      const firstUser = response.users.find((user) => user.email) ?? null;
      applyRequester(firstUser, org);
    });
  }

  async function applyCheckResult(result: CheckResult) {
    setLatestCheckResult(result);
    const companyName = result.companyName.trim();
    const serial = result.serial.trim();
    const nextSubject = buildMailSubject(companyName);
    const nextBody = buildMailBody(requesterName || "담당자");

    if (!subjectDirty) {
      setSubject(nextSubject);
    }
    if (!bodyDirty) {
      setBody(nextBody);
    }
    if (companyName) {
      setQuery(companyName);
    }

    if (!companyName && !serial) {
      setOrgMatchStatus("자동 매칭 대상 없음");
      return;
    }

    await runBusy("조직 자동 매칭 중", async () => {
      const response = await apiFetch<{
        organizations: Organization[];
        matchedOrganization: Organization | null;
        matchMode: "serial" | "company";
        serial: string | null;
      }>(
        `/api/zendesk/organizations?query=${encodeURIComponent(companyName || serial)}&serial=${encodeURIComponent(serial)}&autoMatch=true`,
      );
      setOrganizations(response.organizations);
      if (response.matchedOrganization) {
        setOrgMatchStatus(
          response.matchMode === "serial"
            ? `Serial 자동 매칭 성공: ${serial}`
            : `회사명 후보에서 Serial 매칭 성공: ${serial}`,
        );
        await selectOrganization(response.matchedOrganization);
        return;
      }
      setOrgMatchStatus(
        response.organizations.length > 0
          ? "Serial 자동 매칭 실패 - 조직을 수동 선택하세요."
          : "검색 결과 없음 - 회사명으로 수동 검색하세요.",
      );
    });
  }

  function applyRequester(user: ZendeskUser | null, org = selectedOrg) {
    const nextEmail = user?.email ?? "";
    const nextName = user?.name ?? "";
    setRequesterEmail(nextEmail);
    setRequesterName(nextName);

    const companyName = latestCheckResult?.companyName || org?.name || "";
    if (!subjectDirty) {
      setSubject(buildMailSubject(companyName));
    }
    if (!bodyDirty) {
      setBody(buildMailBody(nextName || "담당자"));
    }
  }

  function addAttachments(event: ChangeEvent<HTMLInputElement>) {
    const nextFiles = [...attachments, ...Array.from(event.target.files ?? [])];
    event.target.value = "";

    const validationError = validateFiles(nextFiles);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setAttachments(nextFiles);
  }

  function removeAttachment(file: File) {
    setAttachments((current) => current.filter((item) => item !== file));
  }

  function openConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!isReady) {
      setError("조직, 요청자, 제목, 본문, Zendesk 그룹/담당자 설정을 확인하세요.");
      return;
    }

    setIsConfirmOpen(true);
  }

  async function sendTicket() {
    setError(null);
    setNotice(null);

    await runBusy("Zendesk 티켓 생성 중", async () => {
      const uploadTokens = attachments.length > 0 ? await uploadAttachments() : [];
      const response = await apiFetch<{
        dryRun: boolean;
        duplicate: boolean;
        ticketId: string | null;
        ticketUrl: string | null;
      }>("/api/zendesk/tickets", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey,
          organizationId: selectedOrg ? String(selectedOrg.id) : null,
          requesterName,
          requesterEmail,
          subject,
          body,
          groupId: settings?.defaultGroupId,
          assigneeEmail: settings?.fixedAssigneeEmail,
          autoSolve: autoSolved,
          fieldValues: settings?.defaultValues ?? {},
          uploadTokens,
        }),
      });

      setNotice(
        response.duplicate
          ? "같은 발송 키로 이미 처리된 요청입니다. 기존 결과를 반환했습니다."
          : response.dryRun
            ? "Preview/dry-run 모드로 검증되었습니다. 실제 Zendesk 티켓은 생성되지 않았습니다."
            : `Zendesk 티켓이 생성되었습니다. ${response.ticketId ? `#${response.ticketId}` : ""}`,
      );
      setIdempotencyKey(crypto.randomUUID());
      setIsConfirmOpen(false);
      await loadHistory();
    });
  }

  async function uploadAttachments() {
    const formData = new FormData();
    attachments.forEach((file) => formData.append("files", file));
    const response = await apiFetch<{ uploadTokens: string[]; uploads: UploadResult[] }>(
      "/api/zendesk/uploads",
      {
        method: "POST",
        body: formData,
      },
    );
    return response.uploadTokens;
  }

  async function runBusy(label: string, action: () => Promise<void>) {
    setBusyLabel(label);
    setError(null);

    try {
      await action();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "요청 처리 중 오류가 발생했습니다.");
    } finally {
      setBusyLabel(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#f5f7fb] text-[#172033]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col px-5 py-5 sm:px-8">
        <header className="flex flex-col gap-4 border-b border-[#d8dee9] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#0f7b6c]">Zendesk 메일 발송</p>
            <h1 className="mt-1 text-2xl font-semibold text-[#172033] sm:text-3xl">
              조직 확인부터 최종 발송까지 한 화면에서 처리
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge label={session ? "로그인됨" : "로그인 필요"} tone={session ? "green" : "orange"} />
            {sendMode ? (
              <StatusBadge
                label={
                  sendMode === "real"
                    ? `실발송 활성${appEnv ? ` (${appEnv})` : ""}`
                    : `DRY-RUN — 실제 발송 안 됨${appEnv ? ` (${appEnv})` : ""}`
                }
                tone={sendMode === "real" ? "green" : "orange"}
              />
            ) : null}
          </div>
        </header>

        {!session ? (
          <section className="mx-auto mt-10 w-full max-w-md rounded-md border border-[#d8dee9] bg-white p-5">
            <h2 className="text-lg font-semibold">운영자 로그인</h2>
            <form className="mt-5 space-y-4" onSubmit={signIn}>
              <Field label="이메일">
                <input
                  className="input"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  autoComplete="email"
                />
              </Field>
              <Field label="비밀번호">
                <input
                  className="input"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  autoComplete="current-password"
                />
              </Field>
              {authError ? <Alert tone="red" message={authError} /> : null}
              <button className="primary-button w-full" type="submit">
                로그인
              </button>
            </form>
          </section>
        ) : (
          <div className="grid flex-1 gap-5 py-5 xl:grid-cols-[330px_minmax(0,1fr)_340px]">
            <aside className="min-w-0 space-y-5">
              <CheckFlowPanel accessToken={session?.access_token ?? null} onResult={(result) => void applyCheckResult(result)} />
              <Panel title="Zendesk 조직 검색">
                <form className="flex gap-2" onSubmit={searchOrganizations}>
                  <input
                    className="input"
                    placeholder="조직명 또는 외부 ID"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <button className="secondary-button shrink-0" type="submit">
                    검색
                  </button>
                </form>
                <p className="mt-2 text-xs font-medium text-[#667085]">{orgMatchStatus}</p>
                <div className="mt-3 max-h-[280px] space-y-2 overflow-y-auto">
                  {organizations.map((org) => (
                    <button
                      className={`w-full rounded-md border p-3 text-left transition ${
                        selectedOrg?.id === org.id
                          ? "border-[#0f7b6c] bg-[#ecfdf3]"
                          : "border-[#e4e9f2] bg-white hover:border-[#9fb3c8]"
                      }`}
                      key={String(org.id)}
                      onClick={() => void selectOrganization(org)}
                      type="button"
                    >
                      <span className="block text-sm font-semibold">{org.name ?? "(이름 없음)"}</span>
                      <span className="mt-1 block text-xs text-[#667085]">
                        ID {String(org.id)}
                        {getOrgSerial(org) ? ` / Serial ${getOrgSerial(org)}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              </Panel>

            </aside>

            <form className="min-w-0 rounded-md border border-[#d8dee9] bg-white" onSubmit={openConfirm}>
              <div className="grid gap-4 border-b border-[#e4e9f2] p-5 lg:grid-cols-[1fr_260px]">
                <div>
                  <p className="text-sm font-semibold text-[#667085]">선택 조직</p>
                  <h2 className="mt-1 text-2xl font-semibold">{selectedOrg?.name ?? "조직을 선택하세요"}</h2>
                  <p className="mt-2 text-sm text-[#667085]">
                    {selectedOrg ? `Zendesk 조직 ID ${String(selectedOrg.id)}` : "검색 후 조직을 선택하면 요청자를 조회합니다."}
                  </p>
                </div>
                <Field label="요청자">
                  <select
                    className="input"
                    value={requesterEmail}
                    onChange={(event) => {
                      const nextUser = users.find((user) => user.email === event.target.value) ?? null;
                      applyRequester(nextUser);
                    }}
                  >
                    <option value="">요청자 선택</option>
                    {users.map((user) => (
                      <option key={String(user.id)} value={user.email ?? ""}>
                        {formatUserOption(user)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_260px]">
                <section className="min-w-0 space-y-4">
                  <Field label="제목">
                    <input
                      className="input"
                      value={subject}
                      onChange={(event) => {
                        setSubjectDirty(true);
                        setSubject(event.target.value);
                      }}
                    />
                  </Field>
                  <Field label="본문">
                    <textarea
                      className="input min-h-[260px] resize-y leading-6"
                      value={body}
                      onChange={(event) => {
                        setBodyDirty(true);
                        setBody(event.target.value);
                      }}
                    />
                  </Field>
                  <section className="rounded-md border border-[#d8dee9]">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e4e9f2] px-4 py-3">
                      <h3 className="text-sm font-semibold">첨부 파일</h3>
                      <label className="secondary-button cursor-pointer">
                        파일 선택
                        <input className="sr-only" multiple onChange={addAttachments} type="file" />
                      </label>
                    </div>
                    <div className="divide-y divide-[#edf1f7]">
                      {attachments.length === 0 ? (
                        <p className="px-4 py-4 text-sm text-[#667085]">첨부 파일 없음</p>
                      ) : (
                        attachments.map((file) => (
                          <div className="flex items-center justify-between gap-3 px-4 py-3" key={`${file.name}-${file.lastModified}`}>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{file.name}</p>
                              <p className="mt-1 text-xs text-[#667085]">{formatBytes(file.size)}</p>
                            </div>
                            <button className="danger-button" onClick={() => removeAttachment(file)} type="button">
                              제거
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                </section>

                <aside className="space-y-4">
                  <Panel title="발송 설정">
                    <InfoRow label="그룹" value={formatGroup(settings)} />
                    <InfoRow label="담당자" value={settings?.fixedAssigneeEmail ?? "설정 필요"} />
                    <InfoRow label="중복 방지 키" value={idempotencyKey.slice(0, 8)} />
                    {configuredFields.map((field) => (
                      <InfoRow key={field.name} label={field.name} value={`${field.id} / ${field.value || "기본값 없음"}`} />
                    ))}
                  </Panel>
                  <label className="flex items-start gap-3 rounded-md border border-[#d8dee9] p-4 text-sm">
                    <input
                      className="mt-1 h-4 w-4 accent-[#0f7b6c]"
                      checked={autoSolved}
                      onChange={(event) => setAutoSolved(event.target.checked)}
                      type="checkbox"
                    />
                    <span>
                      <span className="block font-semibold text-[#344054]">발송 후 solved 처리</span>
                      <span className="mt-1 block leading-5 text-[#667085]">기본값은 꺼져 있으며 최종 확인 후에만 적용됩니다.</span>
                    </span>
                  </label>
                  <button className="primary-button w-full" disabled={!isReady || Boolean(busyLabel)} type="submit">
                    발송 전 확인
                  </button>
                </aside>
              </div>
            </form>

            <aside className="min-w-0 space-y-5">
              <Panel title="상태">
                <InfoRow label="작업 상태" value={busyLabel ?? "대기"} />
                <InfoRow
                  label="발송 모드"
                  value={
                    sendMode === "real"
                      ? `실발송 (${appEnv ?? "production"})`
                      : sendMode === "dry-run"
                        ? `DRY-RUN${appEnv ? ` / ${appEnv}` : ""} — Zendesk 호출 없음`
                        : "확인 중"
                  }
                />
                <InfoRow label="권한" value="operator 이상 발송 가능" />
                <button className="secondary-button w-full" onClick={() => void signOut()} type="button">
                  로그아웃
                </button>
              </Panel>
              {notice ? <Alert tone="green" message={notice} /> : null}
              {error ? <Alert tone="red" message={error} /> : null}
              <Panel title="최근 발송">
                <div className="divide-y divide-[#edf1f7]">
                  {history.map((row) => (
                    <div className="py-3" key={row.id}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-semibold">{row.subject}</p>
                        <span className="rounded-md bg-[#f1f5f9] px-2 py-1 text-xs font-medium">{row.status}</span>
                      </div>
                      <p className="mt-1 text-xs text-[#667085]">
                        {new Date(row.created_at).toLocaleString()} / 첨부 {row.attachment_count}개
                      </p>
                    </div>
                  ))}
                </div>
              </Panel>
            </aside>
          </div>
        )}
      </div>

      {isConfirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#101828]/45 p-4">
          <section className="w-full max-w-2xl rounded-md bg-white shadow-xl">
            <div className="border-b border-[#e4e9f2] p-5">
              <p className="text-sm font-semibold text-[#0f7b6c]">최종 확인</p>
              <h2 className="mt-1 text-xl font-semibold">Zendesk 티켓 생성 전 내용을 확인하세요</h2>
            </div>
            <div className="grid gap-3 p-5 text-sm sm:grid-cols-2">
              <ConfirmItem label="조직" value={selectedOrg?.name ?? "-"} />
              <ConfirmItem label="요청자" value={requesterEmail} />
              <ConfirmItem label="그룹" value={formatGroup(settings)} />
              <ConfirmItem label="담당자" value={settings?.fixedAssigneeEmail ?? "-"} />
              <ConfirmItem label="제목" value={subject} wide />
              <ConfirmItem label="첨부" value={`${attachments.length}개`} />
              <ConfirmItem label="solved 처리" value={autoSolved ? "예" : "아니오"} />
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-[#e4e9f2] p-5 sm:flex-row sm:justify-end">
              <button className="secondary-button" onClick={() => setIsConfirmOpen(false)} type="button">
                닫기
              </button>
              <button className="primary-button" disabled={Boolean(busyLabel)} onClick={() => void sendTicket()} type="button">
                최종 발송
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function validateFiles(files: File[]) {
  if (files.length > maxFiles) {
    return `첨부 파일은 최대 ${maxFiles}개까지 가능합니다.`;
  }

  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > maxTotalBytes) {
    return "첨부 파일 총 용량은 25MB를 넘을 수 없습니다.";
  }

  for (const file of files) {
    const extension = getExtension(file.name);
    if (!allowedExtensions.has(extension)) {
      return "허용되지 않은 첨부 파일 형식입니다.";
    }
    if (file.size > maxFileBytes) {
      return "첨부 파일 1개 용량은 10MB를 넘을 수 없습니다.";
    }
  }

  return null;
}

function getExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatGroup(settings: ZendeskSettings | null) {
  if (!settings?.defaultGroupId) {
    return "설정 필요";
  }
  return `${settings.defaultGroupName ?? "Zendesk 그룹"} (${settings.defaultGroupId})`;
}

function buildMailSubject(companyName: string) {
  const company = companyName.trim();
  return company
    ? `[지란지교소프트] ${company} - 오피스키퍼 정기점검 확인서 송부`
    : "[지란지교소프트] 오피스키퍼 정기점검 확인서 송부";
}

function buildMailBody(requesterName: string) {
  const name = requesterName.trim() || "담당자";
  return [
    `안녕하세요. ${name} 담당님`,
    "지란지교소프트 기술지원센터입니다.",
    "",
    "금일 진행된 오피스키퍼 정기점검 확인서 전달드립니다.",
    "확인 후 서명하여 회신 부탁드립니다.",
    "",
    "",
    "감사합니다.",
    "",
  ].join("\n");
}

function getOrgSerial(org: Organization) {
  if (org.matched_serial) {
    return String(org.matched_serial);
  }
  const fields = org.organization_fields;
  if (!fields) {
    return "";
  }
  for (const [key, value] of Object.entries(fields)) {
    if (value && key.toLowerCase().includes("serial")) {
      return String(value);
    }
  }
  return "";
}

function formatUserOption(user: ZendeskUser) {
  const base = user.email
    ? `${user.name ?? user.email} (${user.email})`
    : user.name ?? String(user.id);
  return user.match_reason ? `${base} - ${user.match_reason}` : base;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-semibold text-[#344054]">
      {label}
      <div className="mt-2">{children}</div>
    </label>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-[#d8dee9] bg-white p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-3 rounded-md border border-[#e4e9f2] bg-[#f8fafc] p-3 last:mb-0">
      <p className="text-xs font-semibold text-[#667085]">{label}</p>
      <p className="mt-1 break-words text-sm font-medium">{value}</p>
    </div>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: "green" | "orange" }) {
  const className =
    tone === "green"
      ? "border-[#c6f6d5] bg-[#ecfdf3] text-[#087443]"
      : "border-[#ffd8a8] bg-[#fff7ed] text-[#b54708]";

  return <span className={`rounded-md border px-3 py-2 font-medium ${className}`}>{label}</span>;
}

function Alert({ tone, message }: { tone: "green" | "red"; message: string }) {
  const className =
    tone === "green"
      ? "border-[#c6f6d5] bg-[#ecfdf3] text-[#087443]"
      : "border-[#fecdca] bg-[#fef3f2] text-[#b42318]";

  return <div className={`rounded-md border p-3 text-sm font-medium ${className}`}>{message}</div>;
}

function ConfirmItem({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`rounded-md border border-[#e4e9f2] bg-[#f8fafc] p-3 ${wide ? "sm:col-span-2" : ""}`}>
      <p className="text-xs font-semibold text-[#667085]">{label}</p>
      <p className="mt-1 break-words font-medium text-[#172033]">{value}</p>
    </div>
  );
}
