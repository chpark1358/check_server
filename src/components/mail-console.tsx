"use client";

import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { AdminConsole } from "@/components/admin-console";
import { PasswordSetupDialog } from "@/components/password-setup-dialog";
import { CheckFlowPanel, ResultSummary } from "@/components/check-flow/check-flow-panel";
import type { CheckResult } from "@/components/check-flow/check-flow-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert as UIAlert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { inferDocumentServerModel, normalizeServerModelText } from "@/lib/server-model";
import { LogOut } from "lucide-react";

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

type DocumentFileMeta = {
  fileName: string;
  size: number;
  downloadUrl: string;
};

type GeneratedDocument = {
  id: string;
  companyName: string;
  serial: string;
  createdAt: string;
  expiresAt: string;
  docx: DocumentFileMeta;
  pdf: (DocumentFileMeta & { status: "success" }) | null;
  pdfStatus: PdfStatus | string;
};

type PdfStatus =
  | { ok: true }
  | { ok: false; code: string; message: string };

type DocumentLibraryItem = GeneratedDocument & {
  actorEmail: string | null;
  engineerName: string | null;
  pdfErrorSummary: string | null;
  attachedToMail: boolean;
};

type DocumentLibrarySummary = {
  total: number;
  pdfReady: number;
  attached: number;
};

type HistoryItem = {
  id: string;
  type: "check" | "document" | "mail";
  action: string;
  status: string;
  actorEmail: string | null;
  companyName: string;
  serial: string | null;
  title: string;
  summary: string;
  targetId: string | null;
  ticketUrl?: string | null;
  documentId?: string | null;
  createdAt: string;
};

type HistoryOverview = {
  summary: {
    checks: number;
    documents: number;
    mails: number;
    failures: number;
  };
  items: HistoryItem[];
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

type StatusTone = "green" | "orange" | "red";
type ZendeskSendMode = "real" | "dry-run";
type UserRole = "viewer" | "operator" | "admin";
type MainTab = "check" | "mail" | "history" | "documents" | "settings" | "admin";

type UserPreferences = {
  defaultEngineerName: string;
  defaultServerModel: string;
  defaultIptablesStatus: "auto" | "Y" | "N";
  defaultSendMode: ZendeskSendMode;
  defaultAutoSolved: boolean;
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

const defaultUserPreferences: UserPreferences = {
  defaultEngineerName: "",
  defaultServerModel: "auto",
  defaultIptablesStatus: "auto",
  defaultSendMode: "dry-run",
  defaultAutoSolved: false,
};

const emptyDocumentLibrarySummary: DocumentLibrarySummary = {
  total: 0,
  pdfReady: 0,
  attached: 0,
};

const selectClassName =
  "flex h-8 w-full items-center rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30";

type EngineerSignatureOption = {
  id: string;
  name: string;
  updatedAt: string;
};

export function MailConsole() {
  const [clientState] = useState<{ supabase: SupabaseClient | null; error: string | null }>(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return {
        supabase: null,
        error: "로그인 인증 환경변수 설정이 필요합니다.",
      };
    }

    try {
      return { supabase: createBrowserSupabaseClient(), error: null };
    } catch (nextError) {
      return {
        supabase: null,
        error: nextError instanceof Error ? nextError.message : "로그인 인증 설정을 확인할 수 없습니다.",
      };
    }
  });
  const supabase = clientState.supabase;
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(clientState.error);
  const [settings, setSettings] = useState<ZendeskSettings | null>(null);
  const [sendMode, setSendMode] = useState<ZendeskSendMode | null>(null);
  const [selectedSendMode, setSelectedSendMode] = useState<ZendeskSendMode>("dry-run");
  const [appEnv, setAppEnv] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<UserRole | null>(null);
  const [history, setHistory] = useState<TicketSendRow[]>([]);
  const [historyOverview, setHistoryOverview] = useState<HistoryOverview | null>(null);
  const [historyRange, setHistoryRange] = useState("7d");
  const [historyType, setHistoryType] = useState("all");
  const [historyStatus, setHistoryStatus] = useState("all");
  const [historyQuery, setHistoryQuery] = useState("");
  const [documentLibrary, setDocumentLibrary] = useState<DocumentLibraryItem[]>([]);
  const [documentQuery, setDocumentQuery] = useState("");
  const [documentAttachedFilter, setDocumentAttachedFilter] = useState("all");
  const [documentStatusFilter, setDocumentStatusFilter] = useState("all");
  const [documentLibrarySummary, setDocumentLibrarySummary] = useState<DocumentLibrarySummary>(emptyDocumentLibrarySummary);
  const [userPreferences, setUserPreferences] = useState<UserPreferences>(() => readUserPreferences(null));
  const [activeTab, setActiveTab] = useState<MainTab>("check");
  const [query, setQuery] = useState("");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [users, setUsers] = useState<ZendeskUser[]>([]);
  const [requesterEmail, setRequesterEmail] = useState("");
  const [requesterName, setRequesterName] = useState("");
  const [latestCheckResult, setLatestCheckResult] = useState<CheckResult | null>(null);
  const [generatedDocument, setGeneratedDocument] = useState<GeneratedDocument | null>(null);
  const [engineerSignatures, setEngineerSignatures] = useState<EngineerSignatureOption[]>([]);
  const [engineerName, setEngineerName] = useState("");
  const [engineerSignatureName, setEngineerSignatureName] = useState("");
  const [documentOpinion, setDocumentOpinion] = useState("");
  const [documentIptablesOk, setDocumentIptablesOk] = useState<boolean | null>(null);
  const [documentServerModel, setDocumentServerModel] = useState("");
  const [orgMatchStatus, setOrgMatchStatus] = useState("자동 매칭 대기");
  const [subjectDirty, setSubjectDirty] = useState(false);
  const [bodyDirty, setBodyDirty] = useState(false);
  const [subject, setSubject] = useState("[지란지교소프트] 오피스키퍼 정기점검 확인서 송부");
  const [body, setBody] = useState(buildMailBody("담당자"));
  const [autoSolved, setAutoSolved] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [generatedAttachmentTokens, setGeneratedAttachmentTokens] = useState<
    Array<{ token: string; fileName: string; type: "docx" | "pdf"; size: number; dryRun: boolean }>
  >([]);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [notice, setNotice] = useState<ReactNode | null>(null);
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

  const selectedSendModeDryRun = selectedSendMode === "dry-run";
  const activeGeneratedAttachmentTokens = generatedAttachmentTokens.filter((item) => item.dryRun === selectedSendModeDryRun);
  const generatedPdfToken = activeGeneratedAttachmentTokens.find((item) => item.type === "pdf") ?? null;
  const generatedDocxToken = activeGeneratedAttachmentTokens.find((item) => item.type === "docx") ?? null;
  const pendingGeneratedPdfCount = generatedDocument?.pdf && !generatedPdfToken ? 1 : 0;
  const attachmentCount = attachments.length + activeGeneratedAttachmentTokens.length + pendingGeneratedPdfCount;
  const canRealSend = sendMode === "real";
  const defaultSendModeLabel = formatSendModeLabel(resolveSafeSendMode(userPreferences.defaultSendMode, canRealSend));
  const requiresPasswordSetup =
    Boolean(session) &&
    (session?.user?.user_metadata as Record<string, unknown> | undefined)?.password_set === false;
  const rawServerModel = normalizeServerModelText(latestCheckResult?.system.serverModel || latestCheckResult?.hardwareType);
  const inferredServerModel = inferDocumentServerModel(rawServerModel);
  const serverModelOptions = buildServerModelOptions(rawServerModel, inferredServerModel);
  const readinessItems = [
    {
      label: "로그인 계정",
      value: session?.user.email ?? "로그인 필요",
      tone: session ? "green" : "orange",
    },
    {
      label: "젠데스크",
      value: settings?.defaultGroupId
        ? `${selectedSendMode === "dry-run" ? "테스트 전송" : "실제 전송"} · ${formatGroup(settings)}`
        : "설정 확인 필요",
      tone: settings?.defaultGroupId && settings.fixedAssigneeEmail ? "green" : "orange",
    },
    {
      label: "점검 데이터",
      value: latestCheckResult ? `${latestCheckResult.serial || "serial 없음"} · 결과 보존` : "대기",
      tone: latestCheckResult ? "green" : "orange",
    },
    {
      label: "PDF 첨부",
      value: generatedPdfToken
        ? "자동 첨부됨"
        : generatedDocument?.pdf
          ? "생성됨 · 첨부 대기"
          : generatedDocument
            ? "DOCX만 가능"
            : "문서 대기",
      tone: generatedPdfToken ? "green" : generatedDocument ? "orange" : "orange",
    },
    {
      label: "발송 준비",
      value: isReady ? `준비됨 · 첨부 ${attachmentCount}개` : "필수값 필요",
      tone: isReady ? "green" : "orange",
    },
  ] satisfies Array<{ label: string; value: string; tone: StatusTone }>;

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError(null);

    if (!supabase) {
      setAuthError("로그인 인증 클라이언트 설정이 필요합니다.");
      return;
    }

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setAuthError(formatAppLoginError(signInError.message));
      return;
    }

    if (data.session?.access_token) {
      const preferences = await loadUserPreferences(data.session.access_token, data.session.user.email ?? null);
      setSession(data.session);
      setUserPreferences(preferences);
      await loadInitialData(data.session.access_token, data.session, preferences);
    } else {
      setSession(data.session);
      setUserPreferences(readUserPreferences(data.session?.user?.email ?? null));
    }
  }

  async function signOut() {
    await supabase?.auth.signOut();
    setSession(null);
    setCurrentRole(null);
    setUserPreferences(readUserPreferences(null));
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

  async function loadUserPreferences(accessToken: string, userEmail: string | null) {
    const fallback = readUserPreferences(userEmail);
    try {
      const response = await apiFetchWithToken<{ preferences: UserPreferences }>(accessToken, "/api/user/preferences");
      writeUserPreferences(userEmail, response.preferences);
      return response.preferences;
    } catch (nextError) {
      console.warn("user_preferences_load_failed", nextError);
      return fallback;
    }
  }

  async function loadSettings(
    accessToken = session?.access_token,
    preferences = userPreferences,
  ) {
    if (!accessToken) {
      return;
    }

    const response = await apiFetchWithToken<{ settings: ZendeskSettings }>(accessToken, "/api/settings/zendesk");
    setSettings(response.settings);
    setAutoSolved(preferences.defaultAutoSolved);
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

  async function loadHistoryOverview(accessToken = session?.access_token) {
    if (!accessToken) {
      return;
    }
    const params = new URLSearchParams({
      range: historyRange,
      type: historyType,
      status: historyStatus,
      limit: "100",
    });
    if (historyQuery.trim()) {
      params.set("q", historyQuery.trim());
    }
    const response = await apiFetchWithToken<HistoryOverview>(accessToken, `/api/history/overview?${params.toString()}`);
    setHistoryOverview({
      summary: response.summary,
      items: response.items,
    });
  }

  async function loadDocumentLibrary(accessToken = session?.access_token) {
    if (!accessToken) {
      return;
    }
    const params = new URLSearchParams({ limit: "100" });
    if (documentQuery.trim()) {
      params.set("q", documentQuery.trim());
    }
    if (documentAttachedFilter !== "all") {
      params.set("attached", documentAttachedFilter);
    }
    if (documentStatusFilter !== "all") {
      params.set("status", documentStatusFilter);
    }
    const response = await apiFetchWithToken<{ documents: DocumentLibraryItem[]; summary: DocumentLibrarySummary }>(
      accessToken,
      `/api/documents?${params.toString()}`,
    );
    setDocumentLibrary(response.documents);
    setDocumentLibrarySummary(response.summary);
  }

  async function loadHealth(
    accessToken = session?.access_token,
    preferences = userPreferences,
  ) {
    if (!accessToken) {
      return;
    }

    const response = await apiFetchWithToken<{ zendeskSendMode: "real" | "dry-run"; env: string; role: UserRole }>(
      accessToken,
      "/api/health",
    );
    setSendMode(response.zendeskSendMode);
    const preferredSendMode = preferences.defaultSendMode;
    setSelectedSendMode(preferredSendMode === "real" && response.zendeskSendMode !== "real" ? "dry-run" : preferredSendMode);
    setGeneratedAttachmentTokens([]);
    setAppEnv(response.env);
    setCurrentRole(response.role);
  }

  async function loadEngineerSignatures(
    accessToken = session?.access_token,
    nextSession: Session | null = session,
    preferences = userPreferences,
  ) {
    if (!accessToken) {
      return;
    }
    const response = await apiFetchWithToken<{ signatures: EngineerSignatureOption[] }>(
      accessToken,
      "/api/engineer-signatures",
    );
    setEngineerSignatures(response.signatures);

    const savedName = applySavedEngineerSignature(nextSession, response.signatures);
    const preferredName = response.signatures.some((option) => option.name === preferences.defaultEngineerName)
      ? preferences.defaultEngineerName
      : "";
    const currentName = response.signatures.some((option) => option.name === engineerName) ? engineerName : "";
    const fallback = response.signatures[0]?.name ?? "";
    const next = preferredName || savedName || currentName || fallback;
    if (next) {
      setEngineerName(next);
      setEngineerSignatureName(next);
    }
  }

  async function loadInitialData(
    accessToken: string,
    nextSession: Session | null = session,
    preferences = userPreferences,
  ) {
    await Promise.all([
      loadSettings(accessToken, preferences),
      loadHistory(accessToken),
      loadHistoryOverview(accessToken),
      loadDocumentLibrary(accessToken),
      loadHealth(accessToken, preferences),
      loadEngineerSignatures(accessToken, nextSession, preferences),
    ]);
  }

  function applySavedEngineerSignature(
    nextSession: Session | null,
    options: EngineerSignatureOption[],
  ): string | null {
    const userEmail = nextSession?.user?.email;
    if (!userEmail) {
      return null;
    }
    const saved = localStorage.getItem(signatureStorageKey(userEmail));
    if (saved && options.some((option) => option.name === saved)) {
      return saved;
    }
    return null;
  }

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) {
        return;
      }

      setSession(data.session);
      if (data.session?.access_token) {
        const preferences = await loadUserPreferences(data.session.access_token, data.session.user.email ?? null);
        if (!active) {
          return;
        }
        setUserPreferences(preferences);
        void loadInitialData(data.session.access_token, data.session, preferences);
      } else {
        setUserPreferences(readUserPreferences(data.session?.user?.email ?? null));
      }
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.access_token) {
        void (async () => {
          const preferences = await loadUserPreferences(nextSession.access_token, nextSession.user.email ?? null);
          setUserPreferences(preferences);
          await loadInitialData(nextSession.access_token, nextSession, preferences);
        })();
      } else {
        setUserPreferences(readUserPreferences(nextSession?.user?.email ?? null));
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

    const searchText = query.trim();
    if (searchText.length < 2) {
      setError("조직 검색어는 2자 이상 입력하세요.");
      return;
    }

    const serial = extractSerialQuery(searchText);
    await runBusy(serial ? "시리얼 기준 조직 검색 중" : "조직 검색 중", async () => {
      const response = serial
        ? await apiFetch<{
            organizations: Organization[];
            matchedOrganization: Organization | null;
            matchMode: "serial" | "company";
            serial: string | null;
          }>(
            `/api/zendesk/organizations?query=${encodeURIComponent(searchText)}&serial=${encodeURIComponent(serial)}&autoMatch=true`,
          )
        : await apiFetch<{ organizations: Organization[] }>(
            `/api/zendesk/organizations?query=${encodeURIComponent(searchText)}`,
          );
      setOrganizations(response.organizations);
      const matchedOrganization =
        "matchedOrganization" in response && isOrganization(response.matchedOrganization)
          ? response.matchedOrganization
          : null;
      if (matchedOrganization) {
        setOrgMatchStatus(`Serial 검색 성공: ${serial}`);
        await selectOrganization(matchedOrganization);
        return;
      }
      setOrgMatchStatus(
        serial
          ? response.organizations.length > 0
            ? "Serial 후보 검색 결과 - 조직을 선택하세요."
            : "Serial 검색 결과 없음"
          : response.organizations.length > 0
            ? "회사명 검색 결과"
            : "검색 결과 없음",
      );
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
    void loadHistoryOverview();
    setDocumentIptablesOk(
      userPreferences.defaultIptablesStatus === "auto"
        ? result.flags.iptables ?? false
        : userPreferences.defaultIptablesStatus === "Y",
    );
    setDocumentServerModel(
      userPreferences.defaultServerModel === "auto"
        ? inferDocumentServerModel(result.system.serverModel || result.hardwareType)
        : userPreferences.defaultServerModel,
    );
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

  function removeGeneratedAttachment(token: string) {
    setGeneratedAttachmentTokens((current) => current.filter((item) => item.token !== token));
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
      const userTokens = attachments.length > 0 ? await uploadAttachments() : [];
      const nextGeneratedTokens =
        generatedDocument?.pdf && !generatedPdfToken
          ? await attachGeneratedToZendesk(generatedDocument, ["pdf"])
          : [];
      const generatedTokens = [...activeGeneratedAttachmentTokens, ...nextGeneratedTokens].map((item) => item.token);
      const uploadTokens = [...userTokens, ...generatedTokens];

      const response = await apiFetch<{
        dryRun: boolean;
        duplicate: boolean;
        ticketId: string | null;
        ticketUrl: string | null;
        autoSolveStatus?: "not_requested" | "solved" | "failed";
        autoSolveError?: string | null;
      }>("/api/zendesk/tickets", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey,
          organizationId: selectedOrg ? String(selectedOrg.id) : null,
          requesterName,
          requesterEmail,
          subject,
          body,
          engineerName,
          groupId: settings?.defaultGroupId,
          assigneeEmail: settings?.fixedAssigneeEmail,
          autoSolve: autoSolved,
          dryRun: selectedSendMode === "dry-run",
          fieldValues: settings?.defaultValues ?? {},
          uploadTokens,
        }),
      });

      setNotice(buildTicketSendNotice(response));
      setIdempotencyKey(crypto.randomUUID());
      setGeneratedAttachmentTokens([]);
      setIsConfirmOpen(false);
      await loadHistory();
      await loadHistoryOverview();
      await loadDocumentLibrary();
    });
  }

  async function uploadAttachments() {
    const formData = new FormData();
    attachments.forEach((file) => formData.append("files", file));
    formData.append("dryRun", selectedSendMode === "dry-run" ? "true" : "false");
    const response = await apiFetch<{ uploadTokens: string[]; uploads: UploadResult[] }>(
      "/api/zendesk/uploads",
      {
        method: "POST",
        body: formData,
      },
    );
    return response.uploadTokens;
  }

  async function generateDocuments() {
    if (!latestCheckResult) {
      setError("먼저 점검 데이터를 불러오세요.");
      return;
    }

    await runBusy("확인서 DOCX/PDF 생성 중", async () => {
      const reportCheckResult = {
        ...latestCheckResult,
        flags: {
          ...latestCheckResult.flags,
          iptables: documentIptablesOk ?? latestCheckResult.flags.iptables,
        },
      };
      const response = await apiFetch<{
        document: GeneratedDocument;
        pdfConverterEnabled: boolean;
      }>("/api/documents/check-report", {
        method: "POST",
        body: JSON.stringify({
          checkResult: reportCheckResult,
          manual: {
            companyName: latestCheckResult.companyName,
            serial: latestCheckResult.serial,
            productName: latestCheckResult.softwareName || "오피스키퍼",
            serverModel: documentServerModel || inferredServerModel,
            engineerName: engineerName.trim() || "점검자",
            engineerSignatureName,
            opinion: documentOpinion,
          },
          output: { docx: true, pdf: true },
        }),
      });
      const doc = response.document;
      setGeneratedDocument(doc);
      await loadHistoryOverview();
      await loadDocumentLibrary();

      if (doc.pdf) {
        await attachGeneratedToZendesk(doc, ["pdf"]);
        setActiveTab("mail");
        setNotice("확인서 DOCX/PDF가 생성되었고 PDF가 메일 첨부에 자동 추가되었습니다.");
        return;
      }

      const pdfStatus = doc.pdfStatus;
      if (typeof pdfStatus !== "string" && !pdfStatus.ok) {
        const reason = response.pdfConverterEnabled
          ? `PDF 변환 실패: ${pdfStatus.message}`
          : `PDF 변환 서비스가 설정되지 않았습니다 (${pdfStatus.code}). DOCX만 다운로드 가능합니다.`;
        setError(reason);
        setNotice("DOCX는 정상 생성되었습니다. PDF 없이 DOCX만 다운로드/첨부 가능합니다.");
        return;
      }

      setNotice("DOCX 확인서가 생성되었습니다.");
    });
  }

  async function downloadGeneratedDocument(downloadUrl: string, fileName: string) {
    if (!session?.access_token) {
      setError("로그인이 필요합니다.");
      return;
    }
    try {
      const response = await fetch(downloadUrl, {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.message || `다운로드 실패 (HTTP ${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "다운로드 실패");
    }
  }

  async function attachGeneratedToZendesk(
    doc: GeneratedDocument,
    types: Array<"docx" | "pdf">,
    mode: ZendeskSendMode = selectedSendMode,
  ) {
    const response = await apiFetch<{
      uploads: Array<{ token: string; fileName: string; type: "docx" | "pdf"; size: number; dryRun: boolean }>;
    }>("/api/zendesk/uploads/generated", {
      method: "POST",
      body: JSON.stringify({ documentId: doc.id, types, dryRun: mode === "dry-run" }),
    });
    const tokens = response.uploads.map((upload) => ({
      token: upload.token,
      fileName: upload.fileName,
      type: upload.type,
      size: upload.size,
      dryRun: upload.dryRun,
    }));
    setGeneratedAttachmentTokens((current) => {
      const filtered = current.filter((item) => !tokens.some((next) => next.fileName === item.fileName));
      return [...filtered, ...tokens];
    });
    return tokens;
  }

  async function attachDocumentFromLibrary(doc: DocumentLibraryItem) {
    if (!doc.pdf) {
      setError("PDF가 생성된 문서만 메일 첨부로 사용할 수 있습니다.");
      return;
    }
    await runBusy("문서함 PDF 첨부 중", async () => {
      await attachGeneratedToZendesk(doc, ["pdf"]);
      setGeneratedDocument(doc);
      setActiveTab("mail");
      setNotice(`${doc.companyName} PDF를 메일 첨부에 추가했습니다.`);
    });
  }

  function handleSendModeSelect(value: string) {
    const requested = value === "default" ? userPreferences.defaultSendMode : (value as ZendeskSendMode);
    const safeMode = resolveSafeSendMode(requested, canRealSend);
    void updateSelectedSendMode(safeMode);
  }

  async function updateSelectedSendMode(nextMode: ZendeskSendMode) {
    const nextDryRun = nextMode === "dry-run";
    const hasMatchingGeneratedPdf = generatedAttachmentTokens.some((item) => item.type === "pdf" && item.dryRun === nextDryRun);
    setSelectedSendMode(nextMode);
    setGeneratedAttachmentTokens((current) => current.filter((item) => item.dryRun === nextDryRun));

    if (generatedDocument?.pdf && !hasMatchingGeneratedPdf) {
      await runBusy("PDF 첨부 갱신 중", async () => {
        await attachGeneratedToZendesk(generatedDocument, ["pdf"], nextMode);
      });
    }
  }

  function applyPreferences(next: UserPreferences) {
    setUserPreferences(next);
    writeUserPreferences(session?.user?.email ?? null, next);
    if (next.defaultEngineerName) {
      setEngineerName(next.defaultEngineerName);
      setEngineerSignatureName(next.defaultEngineerName);
      if (session?.user?.email) {
        localStorage.setItem(signatureStorageKey(session.user.email), next.defaultEngineerName);
      }
    }
    setAutoSolved(next.defaultAutoSolved);
    if (next.defaultSendMode === "real" && sendMode !== "real") {
      void updateSelectedSendMode("dry-run");
    } else {
      void updateSelectedSendMode(next.defaultSendMode);
    }
    if (next.defaultServerModel !== "auto") {
      setDocumentServerModel(next.defaultServerModel);
    }
    if (next.defaultIptablesStatus !== "auto") {
      setDocumentIptablesOk(next.defaultIptablesStatus === "Y");
    }
  }

  function savePreferences(next: UserPreferences) {
    void runBusy("개인 설정 저장 중", async () => {
      const response = await apiFetch<{ preferences: UserPreferences }>("/api/user/preferences", {
        method: "PUT",
        body: JSON.stringify({ preferences: next }),
      });
      applyPreferences(response.preferences);
      writeUserPreferences(session?.user?.email ?? null, response.preferences);
      setNotice("개인 설정을 저장했습니다.");
    });
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
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col px-5 sm:px-8">
        <header className="flex h-14 items-center justify-between border-b border-border/70">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
            <span className="text-sm font-semibold tracking-tight">Check Server</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <StatusBadge label={session ? "로그인됨" : "로그인 필요"} tone={session ? "green" : "orange"} />
            {sendMode ? (
              <StatusBadge
                label={
                  sendMode === "real"
                    ? `실발송 활성${appEnv ? ` · ${appEnv}` : ""}`
                    : `테스트 전송${appEnv ? ` · ${appEnv}` : ""}`
                }
                tone={sendMode === "real" ? "green" : "orange"}
              />
            ) : null}
            <span className="ml-1">
              <ThemeToggle />
            </span>
            {session ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void signOut()}
                aria-label="로그아웃"
              >
                <LogOut />
              </Button>
            ) : null}
          </div>
        </header>

        {!session ? (
          <Card className="mx-auto mt-16 w-full max-w-sm">
            <CardHeader className="text-center">
              <CardTitle className="text-lg">점검 시스템 로그인</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={signIn}>
                <div className="space-y-2">
                  <Label htmlFor="login-email">이메일</Label>
                  <Input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">비밀번호</Label>
                  <Input
                    id="login-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>
                {authError ? (
                  <UIAlert variant="destructive">
                    <AlertDescription>{authError}</AlertDescription>
                  </UIAlert>
                ) : null}
                <Button type="submit" className="w-full">
                  로그인
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as MainTab)}
            className="mt-5"
          >
            <TabsList variant="line" className="h-auto border-b border-border/70 px-0 pb-0">
              <TabsTrigger value="check" className="data-active:font-semibold">
                점검 데이터
                {latestCheckResult ? <Badge variant="secondary">완료</Badge> : null}
              </TabsTrigger>
              <TabsTrigger value="mail" className="data-active:font-semibold">
                젠데스크 메일 발송
                {attachmentCount > 0 ? <Badge variant="secondary">{attachmentCount}</Badge> : null}
              </TabsTrigger>
              <TabsTrigger value="history" className="data-active:font-semibold">
                이력
              </TabsTrigger>
              <TabsTrigger value="documents" className="data-active:font-semibold">
                문서함
                {documentLibrary.length > 0 ? <Badge variant="secondary">{documentLibrary.length}</Badge> : null}
              </TabsTrigger>
              <TabsTrigger value="settings" className="data-active:font-semibold">
                설정
              </TabsTrigger>
              {currentRole === "admin" ? (
                <TabsTrigger value="admin" className="data-active:font-semibold">
                  관리자
                </TabsTrigger>
              ) : null}
            </TabsList>
            <ReadinessRail items={readinessItems} />
            <TabsContent value="check" keepMounted className="data-hidden:hidden">
              <div className="grid flex-1 gap-4 py-6 xl:grid-cols-[340px_minmax(0,1fr)]">
                <aside className="min-w-0 space-y-4">
                  <CheckFlowPanel accessToken={session?.access_token ?? null} onResult={(result) => void applyCheckResult(result)} />
                </aside>
                <section className="min-w-0 space-y-4">
                  {latestCheckResult ? (
                    <Panel title="점검 결과">
                      <ResultSummary result={latestCheckResult} />
                    </Panel>
                  ) : null}
                  <Panel title="확인서 생성">
                    <div className="grid gap-4 lg:grid-cols-2">
                      <InfoRow label="고객사" value={latestCheckResult?.companyName || "-"} />
                      <InfoRow label="시리얼" value={latestCheckResult?.serial || "-"} />
                    </div>
                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <Field label="점검자">
                        {engineerSignatures.length === 0 ? (
                          <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                            등록된 점검자 서명이 없습니다. 운영자가 PNG를 업로드해야 PDF에 서명이 박힙니다.
                          </p>
                        ) : (
                          <Select
                            value={engineerName}
                            onValueChange={(rawValue) => {
                              const nextName = rawValue ?? "";
                              if (!nextName) return;
                              setEngineerName(nextName);
                              setEngineerSignatureName(nextName);
                              if (session?.user?.email) {
                                localStorage.setItem(signatureStorageKey(session.user.email), nextName);
                              }
                            }}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="점검자 선택" />
                            </SelectTrigger>
                            <SelectContent>
                              {engineerSignatures.map((option) => (
                                <SelectItem key={option.id} value={option.name}>
                                  {option.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </Field>
                      <Field label="제품명">
                        <Input readOnly value={latestCheckResult?.softwareName || "오피스키퍼"} />
                      </Field>
                      <Field label="점검서 서버 모델">
                        <Select
                          value={documentServerModel || inferredServerModel}
                          onValueChange={(value) => {
                            if (value) {
                              setDocumentServerModel(value);
                            }
                          }}
                          disabled={!latestCheckResult}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="서버 모델 선택" />
                          </SelectTrigger>
                          <SelectContent>
                            {serverModelOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="mt-1 text-xs text-muted-foreground">
                          수집 모델: {rawServerModel || "-"}
                        </p>
                      </Field>
                      <Field label="점검서 Iptables 상태">
                        <Select
                          value={(documentIptablesOk ?? latestCheckResult?.flags.iptables ?? false) ? "Y" : "N"}
                          onValueChange={(value) => setDocumentIptablesOk(value === "Y")}
                          disabled={!latestCheckResult}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Iptables 상태 선택" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Y">Y - 정상</SelectItem>
                            <SelectItem value="N">N - 이상</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="mt-1 text-xs text-muted-foreground">
                          확인서의 Iptables 체크 결과에만 반영됩니다.
                        </p>
                      </Field>
                    </div>
                    <div className="mt-4">
                      <InfoRow
                        label="서명"
                        value={engineerSignatureName || "미등록"}
                      />
                    </div>
                    <div className="mt-4">
                      <Field label="점검 의견">
                        <Textarea
                          className="min-h-[120px] resize-y leading-6"
                          value={documentOpinion}
                          onChange={(event) => setDocumentOpinion(event.target.value)}
                        />
                      </Field>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        disabled={!latestCheckResult || Boolean(busyLabel)}
                        onClick={() => void generateDocuments()}
                        type="button"
                      >
                        DOCX/PDF 생성
                      </Button>
                    </div>
                  </Panel>
                  <Panel title="생성 문서">
                    {!generatedDocument ? (
                      <p className="text-sm text-muted-foreground">생성된 문서가 없습니다.</p>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-xs text-muted-foreground">
                          만료: {new Date(generatedDocument.expiresAt).toLocaleString()} (생성 후 30일)
                        </p>
                        <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-xs sm:grid-cols-3">
                          <InfoRow label="DOCX" value={generatedDocxToken ? "메일 첨부됨" : "다운로드 가능"} />
                          <InfoRow
                            label="PDF"
                            value={
                              generatedPdfToken
                                ? "메일 자동 첨부됨"
                                : generatedDocument.pdf
                                  ? "생성됨 · 첨부 대기"
                                  : "생성 불가 · DOCX 사용"
                            }
                          />
                          <InfoRow label="첨부 합계" value={`${attachmentCount}개`} />
                        </div>
                        <div className="divide-y">
                          <DocumentRow
                            label="DOCX"
                            fileName={generatedDocument.docx.fileName}
                            size={generatedDocument.docx.size}
                            onDownload={() => void downloadGeneratedDocument(generatedDocument.docx.downloadUrl, generatedDocument.docx.fileName)}
                          />
                          {generatedDocument.pdf ? (
                            <DocumentRow
                              label="PDF"
                              fileName={generatedDocument.pdf.fileName}
                              size={generatedDocument.pdf.size}
                              onDownload={() => void downloadGeneratedDocument(generatedDocument.pdf!.downloadUrl, generatedDocument.pdf!.fileName)}
                            />
                          ) : (
                            <p className="py-3 text-xs text-amber-700">
                              PDF 미생성 — DOCX만 다운로드/첨부 가능
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </Panel>
                  {notice ? <Alert tone="green" message={notice} /> : null}
                  {error ? <Alert tone="red" message={error} /> : null}
                </section>
              </div>
            </TabsContent>
            <TabsContent value="mail" keepMounted className="data-hidden:hidden">
          <div className="grid flex-1 gap-4 py-6 xl:grid-cols-[320px_minmax(0,1fr)_320px]">
            <aside className="min-w-0 space-y-4">
              <Panel title="Zendesk 조직 검색">
                <form className="flex gap-2" onSubmit={searchOrganizations}>
                  <Input
                    placeholder="조직명 또는 외부 ID"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <Button variant="outline" className="shrink-0" type="submit">
                    검색
                  </Button>
                </form>
                <p className="mt-2 text-xs font-medium text-muted-foreground">{orgMatchStatus}</p>
                <div className="mt-3 max-h-[280px] space-y-2 overflow-y-auto pr-1">
                  {organizations.map((org) => (
                    <button
                      className={`w-full rounded-md border p-3 text-left transition focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none ${
                        selectedOrg?.id === org.id
                          ? "border-primary bg-primary/5"
                          : "border-border bg-card hover:border-foreground/30"
                      }`}
                      key={String(org.id)}
                      onClick={() => void selectOrganization(org)}
                      type="button"
                    >
                      <span className="block text-sm font-medium">{org.name ?? "(이름 없음)"}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        ID {String(org.id)}
                        {getOrgSerial(org) ? ` · Serial ${getOrgSerial(org)}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              </Panel>

            </aside>

            <form className="min-w-0 rounded-xl border bg-card ring-1 ring-foreground/10" onSubmit={openConfirm}>
              <div className="grid gap-4 border-b p-5 lg:grid-cols-[1fr_260px]">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">선택 조직</p>
                  <h2 className="mt-1.5 text-lg font-semibold tracking-tight">{selectedOrg?.name ?? "조직을 선택하세요"}</h2>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {selectedOrg ? `Zendesk 조직 ID ${String(selectedOrg.id)}` : "검색 후 조직을 선택하면 요청자를 조회합니다."}
                  </p>
                </div>
                <Field label="요청자">
                  <select
                    className="flex h-8 w-full items-center rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
                    value={requesterEmail || "__none"}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === "__none") {
                        applyRequester(null);
                        return;
                      }
                      const nextUser =
                        users.find((user) => (user.email ?? String(user.id)) === value) ?? null;
                      applyRequester(nextUser);
                    }}
                  >
                    <option value="__none">요청자 선택</option>
                      {users.map((user) => (
                        <option key={String(user.id)} value={user.email ?? String(user.id)}>
                          {formatUserOption(user)}
                        </option>
                      ))}
                  </select>
                </Field>
              </div>

              <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_260px]">
                <section className="min-w-0 space-y-4">
                  <Field label="제목">
                    <Input
                      value={subject}
                      onChange={(event) => {
                        setSubjectDirty(true);
                        setSubject(event.target.value);
                      }}
                    />
                  </Field>
                  <Field label="본문">
                    <Textarea
                      className="min-h-[260px] resize-y leading-6"
                      value={body}
                      onChange={(event) => {
                        setBodyDirty(true);
                        setBody(event.target.value);
                      }}
                    />
                  </Field>
                  <section className="rounded-md border bg-card">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium">첨부 파일</h3>
                        <Badge variant={generatedPdfToken ? "secondary" : "outline"}>
                          PDF {generatedPdfToken ? "자동 첨부" : "대기"}
                        </Badge>
                        <Badge variant="outline">총 {attachmentCount}개</Badge>
                      </div>
                      <Button variant="outline" size="sm" type="button" className="cursor-pointer" onClick={() => document.getElementById("attachment-file-input")?.click()}>
                        파일 선택
                      </Button>
                      <input id="attachment-file-input" className="sr-only" multiple onChange={addAttachments} type="file" />
                    </div>
                    <div className="divide-y">
                      {activeGeneratedAttachmentTokens.map((item) => (
                        <div className="flex items-center justify-between gap-3 px-4 py-3" key={item.token}>
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 truncate text-sm font-medium">
                              <span className="truncate">{item.fileName}</span>
                              <Badge
                                variant="outline"
                                className={
                                  item.dryRun
                                    ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                                    : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                                }
                              >
                                {item.dryRun ? "테스트 첨부" : "자동 첨부"}
                              </Badge>
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">{item.type.toUpperCase()} · {formatBytes(item.size)}</p>
                          </div>
                          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => removeGeneratedAttachment(item.token)} type="button">
                            제거
                          </Button>
                        </div>
                      ))}
                      {attachments.length === 0 && activeGeneratedAttachmentTokens.length === 0 ? (
                        <p className="px-4 py-4 text-sm text-muted-foreground">첨부 파일 없음</p>
                      ) : (
                        attachments.map((file) => (
                          <div className="flex items-center justify-between gap-3 px-4 py-3" key={`${file.name}-${file.lastModified}`}>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{file.name}</p>
                              <p className="mt-1 text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                            </div>
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => removeAttachment(file)} type="button">
                              제거
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                </section>

                <aside className="space-y-4">
                  <Panel title="발송 설정">
                    <Field label="발송 모드">
                      <select
                        className="flex h-8 w-full items-center rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
                        value={selectedSendMode}
                        onChange={(event) => handleSendModeSelect(event.target.value)}
                      >
                        <option value="default">기본 발송 모드 ({defaultSendModeLabel})</option>
                        <option value="dry-run">테스트 전송</option>
                        <option value="real" disabled={!canRealSend}>
                          실제 전송{canRealSend ? "" : " (운영 환경에서만 가능)"}
                        </option>
                      </select>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {selectedSendMode === "dry-run"
                          ? "테스트 전송은 Zendesk 티켓을 실제 생성하지 않습니다."
                          : "실제 전송은 Zendesk 티켓과 첨부를 실제 생성합니다."}
                      </p>
                    </Field>
                    <InfoRow label="그룹" value={formatGroup(settings)} />
                    <InfoRow label="담당자" value={settings?.fixedAssigneeEmail ?? "설정 필요"} />
                    <InfoRow label="중복 방지 키" value={idempotencyKey.slice(0, 8)} />
                    {configuredFields.map((field) => (
                      <InfoRow key={field.name} label={field.name} value={`${field.id} / ${field.value || "기본값 없음"}`} />
                    ))}
                  </Panel>
                  <label className="flex items-start gap-3 rounded-md border bg-card p-4 text-sm">
                    <input
                      className="mt-1 h-4 w-4 accent-primary"
                      checked={autoSolved}
                      onChange={(event) => setAutoSolved(event.target.checked)}
                      type="checkbox"
                    />
                    <span>
                      <span className="block font-medium">발송 후 해결 상태 처리</span>
                      <span className="mt-1 block leading-5 text-muted-foreground">기본값은 꺼져 있으며 최종 확인 후에만 적용됩니다.</span>
                    </span>
                  </label>
                  <Button className="w-full" size="lg" disabled={!isReady || Boolean(busyLabel)} type="submit">
                    발송 전 확인
                  </Button>
                </aside>
              </div>
            </form>

            <aside className="min-w-0 space-y-4">
              {notice ? <Alert tone="green" message={notice} /> : null}
              {error ? <Alert tone="red" message={error} /> : null}
              <Panel title="최근 발송">
                <div className="divide-y">
                  {history.length === 0 ? (
                    <p className="py-4 text-sm text-muted-foreground">발송 이력이 없습니다.</p>
                  ) : (
                    history.map((row) => <HistoryRow key={row.id} row={row} />)
                  )}
                </div>
              </Panel>
            </aside>
          </div>
            </TabsContent>
            <TabsContent value="history" keepMounted className="data-hidden:hidden">
              <HistoryPanel
                overview={historyOverview}
                range={historyRange}
                type={historyType}
                status={historyStatus}
                query={historyQuery}
                busy={Boolean(busyLabel)}
                onRangeChange={setHistoryRange}
                onTypeChange={setHistoryType}
                onStatusChange={setHistoryStatus}
                onQueryChange={setHistoryQuery}
                onSearch={() => void loadHistoryOverview()}
              />
            </TabsContent>
            <TabsContent value="documents" keepMounted className="data-hidden:hidden">
              <DocumentLibraryPanel
                documents={documentLibrary}
                summary={documentLibrarySummary}
                query={documentQuery}
                attachedFilter={documentAttachedFilter}
                statusFilter={documentStatusFilter}
                busy={Boolean(busyLabel)}
                onQueryChange={setDocumentQuery}
                onAttachedFilterChange={setDocumentAttachedFilter}
                onStatusFilterChange={setDocumentStatusFilter}
                onSearch={() => void loadDocumentLibrary()}
                onDownload={(url, fileName) => void downloadGeneratedDocument(url, fileName)}
                onUseForMail={(doc) => void attachDocumentFromLibrary(doc)}
              />
            </TabsContent>
            <TabsContent value="settings" keepMounted className="data-hidden:hidden">
              <UserSettingsPanel
                key={`${session.user.email ?? "user"}-${JSON.stringify(userPreferences)}`}
                preferences={userPreferences}
                signatures={engineerSignatures}
                canRealSend={canRealSend}
                onSave={savePreferences}
              />
            </TabsContent>
            {currentRole === "admin" && session?.access_token ? (
              <TabsContent value="admin" keepMounted className="data-hidden:hidden">
                <AdminConsole accessToken={session.access_token} />
              </TabsContent>
            ) : null}
          </Tabs>
        )}
      </div>

      <Dialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <p className="text-sm font-medium text-primary">최종 확인</p>
            <DialogTitle className="text-xl">Zendesk 티켓 생성 전 내용을 확인하세요</DialogTitle>
            <DialogDescription className="sr-only">발송 직전 점검 항목</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2 text-sm sm:grid-cols-2">
            <ConfirmItem label="조직" value={selectedOrg?.name ?? "-"} />
            <ConfirmItem label="요청자" value={requesterEmail} />
            <ConfirmItem label="그룹" value={formatGroup(settings)} />
            <ConfirmItem label="담당자" value={settings?.fixedAssigneeEmail ?? "-"} />
            <ConfirmItem label="발송 모드" value={selectedSendMode === "dry-run" ? "테스트 전송" : "실제 전송"} />
            <ConfirmItem label="제목" value={subject} wide />
            <ConfirmItem
              label="첨부"
              value={`${attachments.length + activeGeneratedAttachmentTokens.length}개${
                activeGeneratedAttachmentTokens.length > 0
                  ? ` (생성 문서 ${activeGeneratedAttachmentTokens.length})`
                  : ""
              }`}
            />
            <ConfirmItem label="해결 상태 처리" value={autoSolved ? "예" : "아니오"} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsConfirmOpen(false)} type="button">
              닫기
            </Button>
            <Button disabled={Boolean(busyLabel)} onClick={() => void sendTicket()} type="button">
              최종 발송
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {supabase ? (
        <PasswordSetupDialog open={requiresPasswordSetup} supabase={supabase} />
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

function isOrganization(value: unknown): value is Organization {
  return typeof value === "object" && value !== null && "id" in value;
}

function extractSerialQuery(value: string) {
  const text = value.trim();
  const normalized = text.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (/^LO\d{5,}$/.test(normalized) || /^\d{5,}$/.test(normalized)) {
    return normalized.startsWith("LO") ? normalized : `LO${normalized}`;
  }
  const match = text.match(/\bLO[-_\s]*(\d{5,})\b/i) ?? text.match(/\b(\d{5,})\b/);
  if (!match) {
    return null;
  }
  return `LO${match[1]}`;
}

function signatureStorageKey(email: string) {
  return `check-server:last-engineer-signature:${email.toLowerCase()}`;
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

function readUserPreferences(email: string | null): UserPreferences {
  if (typeof window === "undefined") {
    return defaultUserPreferences;
  }
  const raw = localStorage.getItem(userPreferencesStorageKey(email));
  if (!raw) {
    return defaultUserPreferences;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    return {
      defaultEngineerName: typeof parsed.defaultEngineerName === "string" ? parsed.defaultEngineerName : "",
      defaultServerModel: typeof parsed.defaultServerModel === "string" ? parsed.defaultServerModel : "auto",
      defaultIptablesStatus: ["auto", "Y", "N"].includes(String(parsed.defaultIptablesStatus))
        ? (parsed.defaultIptablesStatus as UserPreferences["defaultIptablesStatus"])
        : "auto",
      defaultSendMode: parsed.defaultSendMode === "real" ? "real" : "dry-run",
      defaultAutoSolved: parsed.defaultAutoSolved === true,
    };
  } catch {
    return defaultUserPreferences;
  }
}

function writeUserPreferences(email: string | null, preferences: UserPreferences) {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(userPreferencesStorageKey(email), JSON.stringify(preferences));
}

function userPreferencesStorageKey(email: string | null) {
  return `check-server:user-preferences:${(email ?? "anonymous").toLowerCase()}`;
}

function formatHistoryType(type: HistoryItem["type"]) {
  if (type === "check") {
    return "점검 조회";
  }
  if (type === "document") {
    return "점검서 생성";
  }
  return "메일 발송";
}

function formatHistoryStatus(status: string) {
  if (status === "success") {
    return "성공";
  }
  if (status === "failed") {
    return "실패";
  }
  if (status === "dry_run") {
    return "테스트";
  }
  if (status === "pending") {
    return "대기";
  }
  return status;
}

function resolveSafeSendMode(mode: ZendeskSendMode, canRealSend: boolean): ZendeskSendMode {
  return mode === "real" && !canRealSend ? "dry-run" : mode;
}

function formatSendModeLabel(mode: ZendeskSendMode) {
  return mode === "real" ? "실제 전송" : "테스트 전송";
}

function formatDocumentStatus(status: PdfStatus | string) {
  if (typeof status !== "string") {
    return status.ok ? "완료" : "실패";
  }
  if (status === "success") {
    return "완료";
  }
  if (status === "failed") {
    return "실패";
  }
  if (status === "not_requested" || status === "unavailable") {
    return "없음";
  }
  return status;
}

function formatAppLoginError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials") || normalized.includes("invalid credentials")) {
    return "이메일 또는 비밀번호가 올바르지 않습니다.";
  }
  if (normalized.includes("email not confirmed")) {
    return "이메일 인증이 완료되지 않았습니다. 초대 메일을 확인하세요.";
  }
  if (normalized.includes("too many") || normalized.includes("rate limit")) {
    return "로그인 시도가 많습니다. 잠시 후 다시 시도하세요.";
  }
  return message || "로그인에 실패했습니다. 이메일과 비밀번호를 확인하세요.";
}

function buildServerModelOptions(rawModel: string, inferredModel: string) {
  const options: Array<{ value: string; label: string }> = [];
  const seen = new Set<string>();

  const addOption = (value: string, label: string) => {
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    options.push({ value, label });
  };

  addOption(inferredModel || "-", inferredModel && inferredModel !== "-" ? `자동 판정: ${inferredModel}` : "-");
  if (rawModel && rawModel !== inferredModel) {
    addOption(rawModel, `원본 유지: ${rawModel}`);
  }
  addOption("AWS", "AWS");
  addOption("VM", "VM");
  addOption("물리서버", "물리서버");

  return options;
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
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2 rounded-md border bg-muted/40 px-3 py-2 last:mb-0">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium break-words">{value}</p>
    </div>
  );
}

function DocumentRow({
  label,
  fileName,
  size,
  onDownload,
}: {
  label: string;
  fileName: string;
  size: number;
  onDownload: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{fileName}</p>
        <p className="mt-1 text-xs text-muted-foreground">{label} · {formatBytes(size)}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onDownload} type="button">
        다운로드
      </Button>
    </div>
  );
}

function ReadinessRail({ items }: { items: Array<{ label: string; value: string; tone: StatusTone }> }) {
  return (
    <section className="grid gap-2 border-b border-border py-3 text-xs sm:grid-cols-2 xl:grid-cols-5">
      {items.map((item) => (
        <div
          className="min-w-0 rounded-md border border-slate-300 bg-card px-3 py-2 shadow-sm dark:border-slate-700"
          key={item.label}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-muted-foreground">{item.label}</span>
            <StatusBadge label={item.tone === "green" ? "OK" : "확인"} tone={item.tone} />
          </div>
          <p className="mt-1 truncate font-medium text-foreground">{item.value}</p>
        </div>
      ))}
    </section>
  );
}

function SummaryTile({ label, value, tone = "green" }: { label: string; value: number; tone?: StatusTone }) {
  return (
    <Card size="sm" className={tone === "red" ? "border-destructive/30 bg-destructive/5" : tone === "orange" ? "border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10" : ""}>
      <CardContent>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th className="px-3 py-2 font-medium">{children}</th>;
}

function Td({ children, colSpan, className = "" }: { children: ReactNode; colSpan?: number; className?: string }) {
  return <td colSpan={colSpan} className={`px-3 py-2 align-middle ${className}`}>{children}</td>;
}

function HistoryPanel({
  overview,
  range,
  type,
  status,
  query,
  busy,
  onRangeChange,
  onTypeChange,
  onStatusChange,
  onQueryChange,
  onSearch,
}: {
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
}) {
  const summary = overview?.summary ?? { checks: 0, documents: 0, mails: 0, failures: 0 };
  const items = overview?.items ?? [];

  return (
    <section className="space-y-4 py-6">
      <div className="grid gap-3 md:grid-cols-4">
        <SummaryTile label="점검 조회" value={summary.checks} />
        <SummaryTile label="점검서 생성" value={summary.documents} />
        <SummaryTile label="메일 발송" value={summary.mails} />
        <SummaryTile label="실패" value={summary.failures} tone={summary.failures > 0 ? "red" : "green"} />
      </div>
      <Panel title="내 이력">
        <form
          className="grid gap-2 lg:grid-cols-[150px_150px_150px_minmax(0,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            onSearch();
          }}
        >
          <select className={selectClassName} value={range} onChange={(event) => onRangeChange(event.target.value)}>
            <option value="today">오늘</option>
            <option value="7d">최근 7일</option>
            <option value="30d">최근 30일</option>
          </select>
          <select className={selectClassName} value={type} onChange={(event) => onTypeChange(event.target.value)}>
            <option value="all">모든 유형</option>
            <option value="check">점검 조회</option>
            <option value="document">점검서 생성</option>
            <option value="mail">메일 발송</option>
          </select>
          <select className={selectClassName} value={status} onChange={(event) => onStatusChange(event.target.value)}>
            <option value="all">모든 상태</option>
            <option value="success">성공</option>
            <option value="failed">실패</option>
            <option value="dry_run">테스트</option>
            <option value="pending">대기</option>
          </select>
          <Input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="시리얼, 고객사, 티켓 ID 검색" />
          <Button type="submit" variant="secondary" disabled={busy}>
            검색
          </Button>
        </form>
        <div className="mt-4 overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[920px] text-left text-xs">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>
                <Th>시간</Th>
                <Th>유형</Th>
                <Th>고객사/시리얼</Th>
                <Th>사용자</Th>
                <Th>상태</Th>
                <Th>요약</Th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><Td colSpan={6}>이력이 없습니다.</Td></tr>
              ) : (
                items.map((item) => (
                  <tr key={`${item.type}-${item.id}`} className="border-t">
                    <Td>{new Date(item.createdAt).toLocaleString()}</Td>
                    <Td>{formatHistoryType(item.type)}</Td>
                    <Td>
                      <span className="block font-medium">{item.companyName || item.title || "-"}</span>
                      <span className="text-muted-foreground">{item.serial || item.targetId || "-"}</span>
                    </Td>
                    <Td>{item.actorEmail ?? "-"}</Td>
                    <Td><Badge variant={item.status === "failed" ? "destructive" : "secondary"}>{formatHistoryStatus(item.status)}</Badge></Td>
                    <Td className="max-w-[300px] truncate">{item.summary || "-"}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </section>
  );
}

function DocumentLibraryPanel({
  documents,
  summary,
  query,
  attachedFilter,
  statusFilter,
  busy,
  onQueryChange,
  onAttachedFilterChange,
  onStatusFilterChange,
  onSearch,
  onDownload,
  onUseForMail,
}: {
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
  onUseForMail: (doc: DocumentLibraryItem) => void;
}) {
  const [referenceNow] = useState(() => Date.now());
  const expiring = documents.filter((doc) => Date.parse(doc.expiresAt) - referenceNow <= 7 * 24 * 60 * 60 * 1000).length;

  return (
    <section className="space-y-4 py-6">
      <div className="grid gap-3 md:grid-cols-4">
        <SummaryTile label="전체 문서" value={summary.total} />
        <SummaryTile label="PDF 완료" value={summary.pdfReady} />
        <SummaryTile label="메일 첨부됨" value={summary.attached} />
        <SummaryTile label="만료 예정" value={expiring} tone={expiring > 0 ? "orange" : "green"} />
      </div>
      <Panel title="문서함">
        <form
          className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_160px_170px_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            onSearch();
          }}
        >
          <Input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="고객사, 시리얼, 점검자 검색" />
          <select className={selectClassName} value={attachedFilter} onChange={(event) => onAttachedFilterChange(event.target.value)}>
            <option value="all">첨부 전체</option>
            <option value="true">첨부됨</option>
            <option value="false">미첨부</option>
          </select>
          <select className={selectClassName} value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value)}>
            <option value="all">상태 전체</option>
            <option value="pdf_success">PDF 생성 완료</option>
            <option value="not_requested">DOCX만 생성</option>
            <option value="failed">PDF 실패</option>
          </select>
          <Button type="submit" variant="secondary" disabled={busy}>검색</Button>
        </form>
        <div className="mt-4 overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[980px] text-left text-xs">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>
                <Th>생성일</Th>
                <Th>고객사/시리얼</Th>
                <Th>점검자</Th>
                <Th>생성자</Th>
                <Th>상태</Th>
                <Th>만료일</Th>
                <Th>작업</Th>
              </tr>
            </thead>
            <tbody>
              {documents.length === 0 ? (
                <tr><Td colSpan={7}>문서가 없습니다.</Td></tr>
              ) : (
                documents.map((doc) => (
                  <tr key={doc.id} className="border-t">
                    <Td>{new Date(doc.createdAt).toLocaleString()}</Td>
                    <Td>
                      <span className="block font-medium">{doc.companyName}</span>
                      <span className="text-muted-foreground">{doc.serial}</span>
                    </Td>
                    <Td>{doc.engineerName ?? "-"}</Td>
                    <Td>{doc.actorEmail ?? "-"}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline">DOCX</Badge>
                        <Badge variant={doc.pdf ? "secondary" : doc.pdfStatus === "failed" ? "destructive" : "outline"}>
                          PDF {formatDocumentStatus(doc.pdfStatus)}
                        </Badge>
                        {doc.attachedToMail ? <Badge variant="secondary">메일 첨부</Badge> : null}
                      </div>
                    </Td>
                    <Td>{new Date(doc.expiresAt).toLocaleDateString()}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <Button type="button" variant="outline" size="xs" onClick={() => onDownload(doc.docx.downloadUrl, doc.docx.fileName)}>DOCX</Button>
                        {doc.pdf ? <Button type="button" variant="outline" size="xs" onClick={() => onDownload(doc.pdf!.downloadUrl, doc.pdf!.fileName)}>PDF</Button> : null}
                        <Button type="button" variant="secondary" size="xs" disabled={!doc.pdf} onClick={() => onUseForMail(doc)}>PDF 첨부</Button>
                      </div>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </section>
  );
}

function UserSettingsPanel({
  preferences,
  signatures,
  canRealSend,
  onSave,
}: {
  preferences: UserPreferences;
  signatures: EngineerSignatureOption[];
  canRealSend: boolean;
  onSave: (preferences: UserPreferences) => void;
}) {
  const [draft, setDraft] = useState(preferences);

  return (
    <section className="grid gap-4 py-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Panel title="개인 기본 설정">
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="기본 점검자">
            <select className={selectClassName} value={draft.defaultEngineerName || "__none"} onChange={(event) => setDraft((current) => ({ ...current, defaultEngineerName: event.target.value === "__none" ? "" : event.target.value }))}>
              <option value="__none">자동 선택</option>
              {signatures.map((signature) => <option key={signature.id} value={signature.name}>{signature.name}</option>)}
            </select>
          </Field>
          <Field label="기본 서버 모델">
            <select className={selectClassName} value={draft.defaultServerModel} onChange={(event) => setDraft((current) => ({ ...current, defaultServerModel: event.target.value }))}>
              <option value="auto">자동 판정</option>
              <option value="AWS">AWS</option>
              <option value="VM">VM</option>
              <option value="물리서버">물리서버</option>
            </select>
          </Field>
          <Field label="기본 Iptables 상태">
            <select className={selectClassName} value={draft.defaultIptablesStatus} onChange={(event) => setDraft((current) => ({ ...current, defaultIptablesStatus: event.target.value as UserPreferences["defaultIptablesStatus"] }))}>
              <option value="auto">수집값 사용</option>
              <option value="Y">정상</option>
              <option value="N">이상</option>
            </select>
          </Field>
          <Field label="기본 발송 모드">
            <select className={selectClassName} value={draft.defaultSendMode} onChange={(event) => setDraft((current) => ({ ...current, defaultSendMode: event.target.value as ZendeskSendMode }))}>
              <option value="dry-run">테스트 전송</option>
              <option value="real" disabled={!canRealSend}>실제 전송{canRealSend ? "" : " (운영 환경에서만 가능)"}</option>
            </select>
          </Field>
        </div>
        <label className="mt-4 flex items-start gap-3 rounded-md border bg-muted/30 p-4 text-sm">
          <input className="mt-1 h-4 w-4 accent-primary" checked={draft.defaultAutoSolved} onChange={(event) => setDraft((current) => ({ ...current, defaultAutoSolved: event.target.checked }))} type="checkbox" />
          <span>
            <span className="block font-medium">발송 후 해결 상태 처리 기본값</span>
            <span className="mt-1 block text-muted-foreground">메일 발송 화면의 해결 상태 처리 체크 기본값으로 사용합니다.</span>
          </span>
        </label>
        <div className="mt-4 flex justify-end">
          <Button type="button" onClick={() => onSave(draft)}>설정 저장</Button>
        </div>
      </Panel>
    </section>
  );
}

function HistoryRow({ row }: { row: TicketSendRow }) {
  const status = sendStatusMeta(row.status);
  return (
    <div className="py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{row.subject}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {new Date(row.created_at).toLocaleString()} · 첨부 {row.attachment_count}개
          </p>
        </div>
        <Badge variant={status.variant} className={status.className}>
          {status.label}
        </Badge>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
        {row.requester_email ? <Badge variant="outline">{row.requester_email}</Badge> : null}
        {row.zendesk_ticket_id ? (
          row.zendesk_ticket_url ? (
            <Badge variant="outline" render={<a href={row.zendesk_ticket_url} target="_blank" rel="noreferrer" />}>
              #{row.zendesk_ticket_id}
            </Badge>
          ) : (
            <Badge variant="outline">#{row.zendesk_ticket_id}</Badge>
          )
        ) : null}
        {row.auto_solved ? <Badge variant="outline">자동 해결</Badge> : null}
      </div>
      {row.error_summary ? (
        <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs text-destructive">
          {row.error_summary}
        </p>
      ) : null}
    </div>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground">
      <span
        aria-hidden
        className={`inline-block size-1.5 rounded-full ${statusDotClass(tone)}`}
      />
      <span className="text-foreground">{label}</span>
    </span>
  );
}

function statusDotClass(tone: StatusTone) {
  if (tone === "green") {
    return "bg-emerald-500";
  }
  if (tone === "red") {
    return "bg-destructive";
  }
  return "bg-amber-500";
}

function sendStatusMeta(status: TicketSendRow["status"]) {
  if (status === "success") {
    return { label: "성공", variant: "secondary" as const, className: undefined };
  }
  if (status === "failed") {
    return { label: "실패", variant: "destructive" as const, className: undefined };
  }
  if (status === "dry_run") {
    return {
      label: "테스트",
      variant: "outline" as const,
      className:
        "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
    };
  }
  return { label: "대기", variant: "outline" as const, className: undefined };
}

function Alert({ tone, message }: { tone: "green" | "red"; message: ReactNode }) {
  return (
    <UIAlert
      variant={tone === "red" ? "destructive" : "default"}
      className={
        tone === "green" ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300 [&_*]:!text-emerald-700" : undefined
      }
    >
      <AlertDescription className={tone === "green" ? "text-emerald-700" : undefined}>
        {message}
      </AlertDescription>
    </UIAlert>
  );
}

function buildTicketSendNotice(response: {
  dryRun: boolean;
  duplicate: boolean;
  ticketId: string | null;
  ticketUrl: string | null;
  autoSolveStatus?: "not_requested" | "solved" | "failed";
  autoSolveError?: string | null;
}) {
  if (response.dryRun) {
    return "테스트 전송으로 검증되었습니다. 실제 Zendesk 티켓은 생성되지 않았습니다.";
  }

  const ticketLink = response.ticketId ? (
    response.ticketUrl ? (
      <a href={response.ticketUrl} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
        #{response.ticketId}
      </a>
    ) : (
      <span className="font-semibold">#{response.ticketId}</span>
    )
  ) : null;

  if (response.duplicate) {
    return (
      <>
        같은 발송 키로 이미 처리된 요청입니다. 기존 결과를 반환했습니다.
        {ticketLink ? <> 기존 티켓: {ticketLink}</> : null}
      </>
    );
  }

  if (response.autoSolveStatus === "failed") {
    return (
      <>
        Zendesk 티켓이 생성되었습니다. {ticketLink} 단, 해결 처리는 실패했습니다:{" "}
        {response.autoSolveError ?? "Zendesk 필수 필드 또는 권한을 확인하세요."}
      </>
    );
  }

  return <>Zendesk 티켓이 생성되었습니다. {ticketLink}</>;
}

function ConfirmItem({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`rounded-md border bg-muted/40 px-3 py-2 ${wide ? "sm:col-span-2" : ""}`}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium break-words">{value}</p>
    </div>
  );
}
