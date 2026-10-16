"use client";

import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { observePersistedSession } from "@/lib/supabase/session-observer";
import { clearCrmSession } from "@/lib/browser/crm-storage";
import { normalizeActiveEngineerName } from "@/lib/engineer-roster";
import { isCheckFieldUnknown } from "@/lib/check-result-quality";
import { collectedServiceText, getBatchCheckReviewReasons, resolveDefaultDocumentFlagOverride } from "@/lib/check-result-presentation";
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
import { UserSettingsPanel } from "@/components/user-settings-panel";
import { MailDocumentPreview } from "@/components/mail-document-preview";
import { WorkspaceShell, WorkspacePanel } from "@/components/workspace-shell";
import { DetailDrawer } from "@/components/detail-drawer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { inferDocumentServerModel, normalizeServerModelText } from "@/lib/server-model";
import { RefreshCw, Search, ChevronRight, FileText, Send, SlidersHorizontal, X, Check } from "lucide-react";
import { HistoryPanel, type HistoryOverview } from "@/components/history-panel";
import { DocumentLibraryPanel } from "@/components/document-library-panel";
import { createPreviewApi, previewSession, previewCheckResult } from "@/lib/preview/api";

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

type ZendeskSendMode = "real" | "dry-run";
type UserRole = "viewer" | "operator" | "admin";
type MainTab = "check" | "batch" | "mail" | "history" | "documents" | "settings" | "admin";

type UserPreferences = {
  defaultEngineerName: string;
  defaultServerModel: string;
  defaultIptablesStatus: "auto" | "Y" | "N";
  defaultAgentStatus: "auto" | "Y" | "N";
  defaultSendMode: ZendeskSendMode;
  defaultAutoSolved: boolean;
  mailBodyTemplate: string;
};

const maxFiles = 5;
const maxFileBytes = 10 * 1024 * 1024;
const maxTotalBytes = 25 * 1024 * 1024;
const maxBatchZendeskSendCount = 10;
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
  defaultAgentStatus: "auto",
  defaultSendMode: "dry-run",
  defaultAutoSolved: false,
  mailBodyTemplate: "",
};

const emptyDocumentLibrarySummary: DocumentLibrarySummary = {
  total: 0,
  pdfReady: 0,
  attached: 0,
};

const selectClassName =
  "flex h-8 w-full items-center rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-popover dark:text-popover-foreground [&_option]:bg-background [&_option]:text-foreground dark:[&_option]:bg-popover dark:[&_option]:text-popover-foreground";

type EngineerSignatureOption = {
  id: string;
  name: string;
  updatedAt: string;
  hasSignature?: boolean;
};

type CustomerMailMapping = {
  id: string;
  companyName: string;
  serial: string;
  zendeskOrgId: string;
  requesterName: string;
  requesterEmail: string;
  ccEmails: string;
  defaultEngineerName: string;
  memo: string;
};

type BatchItem = {
  id: string;
  serial: string;
  selected: boolean;
  status: "queued" | "checking" | "checked" | "documented" | "sending" | "sent" | "failed";
  normal: boolean;
  result: CheckResult | null;
  document: GeneratedDocument | null;
  mapping: CustomerMailMapping | null;
  error: string | null;
  sendTicketId: string | null;
  sendTicketUrl: string | null;
  sendAttachmentFileName: string | null;
  sendAttachmentSize: number | null;
  sendMode: ZendeskSendMode | null;
  sendIdempotencyKey: string | null;
};

type BatchProgress = {
  phase: "checking" | "documenting" | "sending";
  current: number;
  total: number;
  message: string;
};

const emptyMappingForm: Omit<CustomerMailMapping, "id"> = {
  companyName: "",
  serial: "",
  zendeskOrgId: "",
  requesterName: "",
  requesterEmail: "",
  ccEmails: "",
  defaultEngineerName: "",
  memo: "",
};

export function MailConsole({ preview = false }: { preview?: boolean }) {
  const [previewApi] = useState(() => createPreviewApi());
  const loadedTabs = useRef(new Set<string>());
  const initializedUser = useRef<string | null>(null);
  const scopeVersion = useRef(0);
  const pdfRetryLocks = useRef(new Set<string>());
  const targetVersion = useRef(0);
  const recipientVersion = useRef(0);
  const allowedTokens = useRef(new Set<string>());
  const signingOut = useRef(false);
  const historyRequest = useRef<AbortController | null>(null);
  const documentRequest = useRef<AbortController | null>(null);
  const attachmentAttempts = useRef(new Set<string>());
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [historyCursors, setHistoryCursors] = useState<Array<string | null>>([null]);
  const [historyPage, setHistoryPage] = useState(0);
  const appliedHistory = useRef({ range: "90d", type: "all", status: "all", query: "", from: "", to: "" });
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [documentsLoaded, setDocumentsLoaded] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [matchedSerial, setMatchedSerial] = useState<string | null>(null);
  const [clientState] = useState<{ supabase: SupabaseClient | null; error: string | null }>(() => {
    if (preview) return { supabase: null, error: null };
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
  const [session, setSession] = useState<Session | null>(preview ? previewSession : null);
  const [restoringSession, setRestoringSession] = useState(!preview && Boolean(clientState.supabase));
  const [authPending, setAuthPending] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(clientState.error);
  const [settings, setSettings] = useState<ZendeskSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [mailHistoryError, setMailHistoryError] = useState<string | null>(null);
  const [sendMode, setSendMode] = useState<ZendeskSendMode | null>(null);
  const [selectedSendMode, setSelectedSendMode] = useState<ZendeskSendMode>("dry-run");
  const [batchSendMode, setBatchSendMode] = useState<ZendeskSendMode>("dry-run");
  const [currentRole, setCurrentRole] = useState<UserRole | null>(null);
  const [history, setHistory] = useState<TicketSendRow[]>([]);
  const [historyOverview, setHistoryOverview] = useState<HistoryOverview | null>(null);
  const [historyRange, setHistoryRange] = useState("90d");
  const [historyType, setHistoryType] = useState("all");
  const [historyStatus, setHistoryStatus] = useState("all");
  const [historyQuery, setHistoryQuery] = useState("");
  const [documentLibrary, setDocumentLibrary] = useState<DocumentLibraryItem[]>([]);
  const [documentQuery, setDocumentQuery] = useState("");
  const [documentAttachedFilter, setDocumentAttachedFilter] = useState("all");
  const [documentStatusFilter, setDocumentStatusFilter] = useState("all");
  const [documentExpiryFilter, setDocumentExpiryFilter] = useState("all");
  const [documentCreatedRange, setDocumentCreatedRange] = useState("all");
  const [documentPage, setDocumentPage] = useState(0);
  const [documentCursors, setDocumentCursors] = useState<Array<string | null>>([null]);
  const [documentNextCursor, setDocumentNextCursor] = useState<string | null>(null);
  const [documentAsOf, setDocumentAsOf] = useState<string>();
  const appliedDocuments = useRef({ query: "", attached: "all", status: "all", expiry: "all", range: "all" });
  const [documentLibrarySummary, setDocumentLibrarySummary] = useState<DocumentLibrarySummary>(emptyDocumentLibrarySummary);
  const [userPreferences, setUserPreferences] = useState<UserPreferences>(() => preview ? defaultUserPreferences : readUserPreferences(null));
  const [activeTab, setActiveTab] = useState<MainTab>("check");
  const [recipientOpen, setRecipientOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [users, setUsers] = useState<ZendeskUser[]>([]);
  const [requesterEmail, setRequesterEmail] = useState("");
  const [requesterName, setRequesterName] = useState("");
  const [latestCheckResult, setLatestCheckResult] = useState<CheckResult | null>(preview ? previewCheckResult() : null);
  const [generatedDocument, setGeneratedDocument] = useState<GeneratedDocument | null>(null);
  const [engineerSignatures, setEngineerSignatures] = useState<EngineerSignatureOption[]>([]);
  const [engineerName, setEngineerName] = useState("");
  const [engineerSignatureName, setEngineerSignatureName] = useState("");
  const [documentOpinion, setDocumentOpinion] = useState("");
  const [batchDocumentOpinion, setBatchDocumentOpinion] = useState("");
  const [documentIptablesOk, setDocumentIptablesOk] = useState<boolean | null>(null);
  const [documentAgentOk, setDocumentAgentOk] = useState<boolean | null>(null);
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
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isBatchConfirmOpen, setIsBatchConfirmOpen] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [notice, setNotice] = useState<ReactNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batchSerialInput, setBatchSerialInput] = useState("");
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchMappings, setBatchMappings] = useState<CustomerMailMapping[]>([]);
  const [mappingForm, setMappingForm] = useState<Omit<CustomerMailMapping, "id">>(emptyMappingForm);
  const [batchOrgCandidates, setBatchOrgCandidates] = useState<Organization[]>([]);
  const [batchUserCandidates, setBatchUserCandidates] = useState<ZendeskUser[]>([]);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);

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
    Boolean(idempotencyKey) &&
    Boolean(settings?.defaultGroupId) &&
    Boolean(settings?.fixedAssigneeEmail) &&
    Boolean(selectedOrg) &&
    (!(latestCheckResult?.serial || generatedDocument?.serial) || matchedSerial === normalizeSerialForCompare(latestCheckResult?.serial || generatedDocument?.serial)) &&
    (!latestCheckResult || !generatedDocument || normalizeSerialForCompare(latestCheckResult.serial) === normalizeSerialForCompare(generatedDocument.serial)) &&
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
  const selectedBatchItems = batchItems.filter((item) => item.selected);
  const batchReadyForDocuments = selectedBatchItems.filter((item) => item.result && !item.document?.pdf);
  const activeBatchSendMode = resolveSafeSendMode(batchSendMode, canRealSend);
  const batchReadyForSend = selectedBatchItems.filter(
    (item) =>
      item.result &&
      item.mapping &&
      item.document?.pdf &&
      (item.status !== "sent" || (activeBatchSendMode === "real" && item.sendMode === "dry-run")),
  );
  const batchFailedCount = batchItems.filter((item) => item.status === "failed").length;
  const requiresPasswordSetup =
    Boolean(session) &&
    (session?.user?.user_metadata as Record<string, unknown> | undefined)?.password_set === false;
  const rawServerModel = normalizeServerModelText(latestCheckResult?.system.serverModel || latestCheckResult?.hardwareType);
  const inferredServerModel = inferDocumentServerModel(rawServerModel);
  const serverModelOptions = buildServerModelOptions(rawServerModel, inferredServerModel);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(signingOut.current){setAuthError("로그아웃 정리 중입니다. 잠시 후 다시 로그인하세요.");return;}
    setAuthError(null);

    if (!supabase) {
      setAuthError("로그인 인증 클라이언트 설정이 필요합니다.");
      return;
    }

    setAuthPending(true);
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(), password,
      });
      if (signInError) { setAuthError(formatAppLoginError(signInError.message)); return; }
      setSession(data.session);
      setPassword("");
    } catch {
      setAuthError("로그인 서버에 연결하지 못했습니다. 연결을 확인한 후 다시 시도하세요.");
    } finally { setAuthPending(false); }
  }

  function resetWorkspace() {
    scopeVersion.current += 1;
    targetVersion.current += 1; recipientVersion.current += 1; allowedTokens.current.clear();
    historyRequest.current?.abort(); documentRequest.current?.abort();
    loadedTabs.current.clear(); attachmentAttempts.current.clear();
    setLatestCheckResult(null); setGeneratedDocument(null); setGeneratedAttachmentTokens([]);
    setSelectedOrg(null); setOrganizations([]); setUsers([]); setMatchedSerial(null);
    setRequesterEmail(""); setRequesterName(""); setAttachments([]);
    setBatchItems([]); setBatchMappings([]); setBatchSerialInput(""); setBatchProgress(null);
    setHistory([]); setHistoryOverview(null); setDocumentLibrary([]); setDocumentsLoaded(false);
    setHistoryCursors([null]); setHistoryPage(0); setHistoryQuery(""); setDocumentQuery("");
    setDocumentCursors([null]); setDocumentPage(0); setDocumentNextCursor(null); setDocumentAsOf(undefined);
    setDocumentAttachedFilter("all"); setDocumentStatusFilter("all"); setDocumentExpiryFilter("all"); setDocumentCreatedRange("all");
    setDocumentLibrarySummary(emptyDocumentLibrarySummary);
    appliedDocuments.current = { query: "", attached: "all", status: "all", expiry: "all", range: "all" };
    setIsConfirmOpen(false); setIsBatchConfirmOpen(false); setAttachmentError(null);
    setSubject(buildMailSubject("")); setBody(buildMailBody("담당자"));
    setSubjectDirty(false); setBodyDirty(false); setError(null); setNotice(null);
    setSettings(null); setSettingsError(null); setSettingsLoading(false); setMailHistoryError(null); setCurrentRole(null); setSendMode(null); setPassword(""); setBusyLabel(null);
    setIdempotencyKey(crypto.randomUUID());
  }
  async function signOut() {
    signingOut.current = true;
    const cleanup = session?.access_token ? apiFetch("/api/solution/logout", { method: "POST", signal: AbortSignal.timeout(5000) }).catch(() => undefined) : Promise.resolve();
    if (!preview) clearCrmSession(session?.user.id ?? "");
    setAuthPending(true);
    setBusyLabel("로그아웃 중");
    try {
      const result = await supabase?.auth.signOut({ scope: "local" });
      if (result?.error) throw result.error;
      initializedUser.current = null;
      resetWorkspace(); setSession(null); setUserPreferences(preview ? defaultUserPreferences : readUserPreferences(null));
    } catch {
      setError("로그아웃을 완료하지 못해 앱 로그인은 유지되어 있습니다. 연결을 확인한 뒤 로그아웃을 다시 시도하세요.");
    } finally { await cleanup; signingOut.current = false; setAuthPending(false); setBusyLabel(null); }
  }

  useEffect(() => {
    if (!session?.access_token || activeTab !== "batch") return;
    let active = true;
    void loadBatchMappings(session.access_token, session.user.email ?? null).then((mappings) => {
      if (active) {
        setBatchMappings(mappings);
      }
    });

    return () => {
      active = false;
    };
    // loadBatchMappings intentionally uses the current auth token from this session effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token, session?.user.email, activeTab]);

  async function apiFetchWithToken<T>(accessToken: string, path: string, init: RequestInit = {}) {
    if (!allowedTokens.current.has(accessToken)) throw new DOMException("계정이 변경되었습니다.", "AbortError");
    const requestScope = scopeVersion.current;
    if (preview) {
      const result = await previewApi(path, init) as ApiSuccess<T>;
      if(requestScope!==scopeVersion.current)throw new DOMException("계정이 변경되었습니다.","AbortError");
      return result;
    }
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

    if(requestScope!==scopeVersion.current)throw new DOMException("계정이 변경되었습니다.","AbortError");
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
    if (preview) return (await apiFetchWithToken<{preferences: UserPreferences}>(accessToken, "/api/user/preferences")).preferences;
    const fallback = readUserPreferences(userEmail);
    try {
      const response = await apiFetchWithToken<{ preferences: UserPreferences }>(accessToken, "/api/user/preferences");
      const preferences = {
        ...response.preferences,
        defaultEngineerName: normalizeActiveEngineerName(response.preferences.defaultEngineerName),
        mailBodyTemplate: response.preferences.mailBodyTemplate || fallback.mailBodyTemplate,
        defaultAgentStatus:
          response.preferences.defaultAgentStatus === "auto" && fallback.defaultAgentStatus !== "auto"
            ? fallback.defaultAgentStatus
            : response.preferences.defaultAgentStatus,
      };
      const shouldMigrateLocalPreferences =
        (!response.preferences.mailBodyTemplate && Boolean(fallback.mailBodyTemplate)) ||
        (response.preferences.defaultAgentStatus === "auto" && fallback.defaultAgentStatus !== "auto");
      if (shouldMigrateLocalPreferences) {
        const migrated = await apiFetchWithToken<{ preferences: UserPreferences }>(accessToken, "/api/user/preferences", {
          method: "PUT",
          body: JSON.stringify({ preferences }),
        });
        writeUserPreferences(userEmail, migrated.preferences);
        return migrated.preferences;
      }
      writeUserPreferences(userEmail, preferences);
      return preferences;
    } catch (nextError) {
      console.warn("user_preferences_load_failed", nextError);
      return fallback;
    }
  }

  async function loadBatchMappings(accessToken: string, userEmail: string | null) {
    if (preview) return (await apiFetchWithToken<{mappings: CustomerMailMapping[]}>(accessToken, "/api/user/customer-mappings")).mappings;
    const fallback = mergeCustomerMappings(readBatchMappings(userEmail), readBatchMappings(null));
    try {
      const response = await apiFetchWithToken<{ mappings: CustomerMailMapping[] }>(
        accessToken,
        "/api/user/customer-mappings",
      );
      if (response.mappings.length === 0 && fallback.length > 0) {
        const migrated = await apiFetchWithToken<{ mappings: CustomerMailMapping[] }>(
          accessToken,
          "/api/user/customer-mappings",
          {
            method: "PUT",
            body: JSON.stringify({ mappings: fallback }),
          },
        );
        writeBatchMappings(userEmail, migrated.mappings);
        return migrated.mappings;
      }
      const mappings = mergeCustomerMappings(response.mappings, fallback);
      if (mappings.length > response.mappings.length) {
        void apiFetchWithToken<{ mappings: CustomerMailMapping[] }>(
          accessToken,
          "/api/user/customer-mappings",
          {
            method: "PUT",
            body: JSON.stringify({ mappings }),
          },
        )
          .then((saved) => {
            writeBatchMappings(userEmail, saved.mappings);
          })
          .catch((saveError) => {
            console.warn("customer_mappings_recovery_save_failed", saveError);
          });
      }
      writeBatchMappings(userEmail, mappings);
      return mappings;
    } catch (nextError) {
      console.warn("customer_mappings_load_failed", nextError);
      return fallback;
    }
  }

  async function loadSettings(
    accessToken = session?.access_token,
  ) {
    if (!accessToken) return;
    const response = await apiFetchWithToken<{ settings: ZendeskSettings }>(accessToken, "/api/settings/zendesk");
    setSettings(response.settings);
  }

  async function refreshMailSettings() {
    const scope = scopeVersion.current;
    setSettingsLoading(true);
    setSettingsError(null);
    try { await loadSettings(); }
    catch (cause) {
      if (scope === scopeVersion.current) setSettingsError(cause instanceof Error ? cause.message : "발송 설정을 조회하지 못했습니다.");
    } finally { if (scope === scopeVersion.current) setSettingsLoading(false); }
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

  async function loadHistoryOverview(accessToken = session?.access_token, cursor: string | null = null, page = 0,
    filters = {range:historyRange,type:historyType,status:historyStatus,query:historyQuery,from:historyFrom,to:historyTo}) {
    if (!accessToken) return;
    historyRequest.current?.abort();
    const controller = new AbortController(); historyRequest.current = controller;
    const scope = scopeVersion.current;
    setHistoryLoading(true); setHistoryError(null);
    const params = new URLSearchParams({range:filters.range,type:filters.type,status:filters.status,limit:"20",includeSummary:"false"});
    if(filters.query.trim())params.set("q",filters.query.trim());
    if(filters.range==="custom"){params.set("from",filters.from);params.set("to",filters.to);}
    if(cursor)params.set("cursor",cursor);
    try {
      const response=await apiFetchWithToken<HistoryOverview>(accessToken,"/api/history/overview?"+params,{signal:controller.signal});
      if(controller.signal.aborted||scope!==scopeVersion.current)return;
      setHistoryOverview(response);appliedHistory.current=filters;setHistoryPage(page);
      if(page===0)setHistoryCursors([null]);
      loadedTabs.current.add("history");
    } catch(cause) {
      if(!controller.signal.aborted&&scope===scopeVersion.current)setHistoryError(cause instanceof Error?cause.message:"이력을 불러오지 못했습니다.");
    } finally {
      if(!controller.signal.aborted&&scope===scopeVersion.current)setHistoryLoading(false);
    }
  }
  function nextHistoryPage(){
    const cursor=historyOverview?.nextCursor;if(!cursor||historyLoading)return;
    setHistoryCursors(current=>[...current.slice(0,historyPage+1),cursor]);
    void loadHistoryOverview(session?.access_token,cursor,historyPage+1,appliedHistory.current);
  }
  function previousHistoryPage(){if(historyPage>0&&!historyLoading)void loadHistoryOverview(session?.access_token,historyCursors[historyPage-1],historyPage-1,appliedHistory.current);}
  function resetHistoryFilters(){
    const filters={range:"90d",type:"all",status:"all",query:"",from:"",to:""};
    setHistoryRange("90d");setHistoryType("all");setHistoryStatus("all");setHistoryQuery("");setHistoryFrom("");setHistoryTo("");
    void loadHistoryOverview(session?.access_token,null,0,filters);
  }
  async function loadDocumentLibrary(accessToken=session?.access_token,cursor:string|null=null,page=0,filters={query:documentQuery,attached:documentAttachedFilter,status:documentStatusFilter,expiry:documentExpiryFilter,range:documentCreatedRange}){
    if(!accessToken)return;
    documentRequest.current?.abort();const controller=new AbortController();documentRequest.current=controller;
    const scope=scopeVersion.current;setDocumentsLoading(true);setDocumentsError(null);
    const params=new URLSearchParams({limit:"50",range:filters.range,expiry:filters.expiry,attached:filters.attached,status:filters.status});
    if(filters.query.trim())params.set("q",filters.query.trim());
    if(cursor)params.set("cursor",cursor);
    try{
      const response=await apiFetchWithToken<{documents:DocumentLibraryItem[];summary:DocumentLibrarySummary;nextCursor:string|null;startCursor:string;asOf:string}>(accessToken,"/api/documents?"+params,{signal:controller.signal});
      if(controller.signal.aborted||scope!==scopeVersion.current)return;
      setDocumentLibrary(response.documents);setDocumentLibrarySummary(response.summary);setDocumentsLoaded(true);loadedTabs.current.add("documents");
      appliedDocuments.current=filters;setDocumentPage(page);setDocumentNextCursor(response.nextCursor);setDocumentAsOf(response.asOf);
      setDocumentCursors(current=>page===0?[response.startCursor]:[...current.slice(0,page),cursor]);
    }catch(cause){if(!controller.signal.aborted&&scope===scopeVersion.current)setDocumentsError(cause instanceof Error?cause.message:"문서를 불러오지 못했습니다.");}
    finally{if(!controller.signal.aborted&&scope===scopeVersion.current)setDocumentsLoading(false);}
  }
  function nextDocumentPage(){if(documentNextCursor&&!documentsLoading)void loadDocumentLibrary(session?.access_token,documentNextCursor,documentPage+1,appliedDocuments.current);}
  function previousDocumentPage(){if(documentPage>0&&!documentsLoading)void loadDocumentLibrary(session?.access_token,documentCursors[documentPage-1],documentPage-1,appliedDocuments.current);}
  function resetDocumentFilters(){
    const filters={query:"",attached:"all",status:"all",expiry:"all",range:"all"};
    setDocumentQuery("");setDocumentAttachedFilter("all");setDocumentStatusFilter("all");setDocumentExpiryFilter("all");setDocumentCreatedRange("all");
    void loadDocumentLibrary(session?.access_token,null,0,filters);
  }
  function refreshRecords(){
    loadedTabs.current.delete("history");loadedTabs.current.delete("documents");loadedTabs.current.delete("mail");
    if(activeTab==="history")void loadHistoryOverview();
    if(activeTab==="documents")void loadDocumentLibrary();
    if(activeTab==="mail")void loadHistory().catch(()=>setNotice("작업은 완료됐습니다. 최근 이력은 탭을 다시 열어 확인하세요."));
  }

  async function loadHealth(
    accessToken = session?.access_token,
    preferences = userPreferences,
    hydrate = false,
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
    const safePreferredSendMode = preferredSendMode === "real" && response.zendeskSendMode !== "real" ? "dry-run" : preferredSendMode;
    if(hydrate){setSelectedSendMode(safePreferredSendMode);setBatchSendMode(safePreferredSendMode);setAutoSolved(preferences.defaultAutoSolved);}
    else if(response.zendeskSendMode!=="real"){setSelectedSendMode("dry-run");setBatchSendMode("dry-run");}
    setCurrentRole(response.role);
    return response.role;
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
      setEngineerSignatureName(response.signatures.find((option) => option.name === next)?.hasSignature === false ? "" : next);
    }
  }

  async function loadInitialData(
    accessToken: string,
    nextSession: Session | null = session,
    preferences = userPreferences,
  ) {
    const role=await loadHealth(accessToken,preferences,true);
    if(role!=="viewer")await loadEngineerSignatures(accessToken,nextSession,preferences);
  }

  function applySavedEngineerSignature(
    nextSession: Session | null,
    options: EngineerSignatureOption[],
  ): string | null {
    if (preview) return null;
    const userEmail = nextSession?.user?.email;
    if (!userEmail) {
      return null;
    }
    const saved = normalizeActiveEngineerName(readBrowserValue(signatureStorageKey(userEmail)) ?? "");
    if (saved && options.some((option) => option.name === saved)) {
      return saved;
    }
    return null;
  }

  useEffect(()=>{
    let active=true;
    async function initialize(nextSession:Session|null){
      if(!active)return;
      if(signingOut.current && nextSession)return;
      const id=nextSession?.user.id??null;setSession(nextSession);setRestoringSession(false);setAuthError(null);
      if(initializedUser.current===id){if(nextSession)allowedTokens.current.add(nextSession.access_token);return;}
      resetWorkspace();initializedUser.current=id;
      if(!nextSession)return;
      allowedTokens.current.add(nextSession.access_token);
      const scope=scopeVersion.current;
      try{
        const preferences=await loadUserPreferences(nextSession.access_token,nextSession.user.email??null);
        if(!active||scope!==scopeVersion.current)return;
        setUserPreferences(preferences);await loadInitialData(nextSession.access_token,nextSession,preferences);
        if(preview&&active)setLatestCheckResult(previewCheckResult());
      }catch(cause){if(active&&scope===scopeVersion.current){initializedUser.current=null;setError(cause instanceof Error?cause.message:"기본 정보 조회 실패");}}
    }
    if(preview){void initialize(previewSession);return()=>{active=false;initializedUser.current=null;scopeVersion.current+=1;};}
    if(!supabase)return;
    const stop = observePersistedSession(supabase.auth, (nextSession) => { void initialize(nextSession); }, () => {
      if (active) { setRestoringSession(false); setAuthError("저장된 로그인 정보를 확인하지 못했습니다. 연결을 확인한 뒤 다시 로그인하세요."); }
    });
    return()=>{active=false;initializedUser.current=null;scopeVersion.current+=1;stop();};
    // Account identity owns draft initialization; token refresh does not reset work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[supabase,preview]);
  useEffect(()=>{
    if(!session?.access_token||!currentRole||loadedTabs.current.has(activeTab))return;
    if(activeTab==="history")void loadHistoryOverview();
    if(activeTab==="documents")void loadDocumentLibrary();
    if(activeTab === "mail" || activeTab === "batch") {
      if (!loadedTabs.current.has("zendesk-settings")) {
        loadedTabs.current.add("zendesk-settings");
        void refreshMailSettings();
      }
    }
    if(activeTab==="mail"){
      loadedTabs.current.add("mail");
      const scope = scopeVersion.current;
      void loadHistory().catch(() => { if(scope === scopeVersion.current)setMailHistoryError("최근 발송 이력을 조회하지 못했습니다. 고객·수신자 검색은 계속 사용할 수 있습니다."); });
    }
    // Search applies filters explicitly; invisible tabs do not load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[activeTab,session?.user.id,currentRole]);
  useEffect(()=>{
    if(activeTab!=="mail"||!generatedDocument?.pdf||generatedPdfToken||busyLabel)return;
    const key=generatedDocument.id+":"+selectedSendMode;
    if(attachmentAttempts.current.has(key))return;
    attachmentAttempts.current.add(key);
    void runBusy("PDF 첨부 준비 중",async()=>{
      try{await attachGeneratedToZendesk(generatedDocument,["pdf"],selectedSendMode);setAttachmentError(null);}
      catch(cause){setAttachmentError(cause instanceof Error?cause.message:"첨부 준비 실패");}
    });
    // One automatic attempt per document/mode. Recovery is an explicit action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[activeTab,generatedDocument?.id,generatedDocument?.pdf,generatedPdfToken,selectedSendMode,busyLabel]);

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

  async function selectOrganization(org: Organization, context = {serial: latestCheckResult?.serial || generatedDocument?.serial || "", companyName: latestCheckResult?.companyName || generatedDocument?.companyName || org.name || ""}) {
    const target = targetVersion.current; const request = ++recipientVersion.current;
    const serial = normalizeSerialForCompare(context.serial) || null;
    setMatchedSerial(null);setIsConfirmOpen(false);setRequesterEmail("");setRequesterName("");
    setSelectedOrg(org);
    setUsers([]);

    await runBusy("요청자 조회 중", async () => {
      const response = await apiFetch<{ users: ZendeskUser[] }>(
        `/api/zendesk/users?organizationId=${encodeURIComponent(String(org.id))}`,
      );
      if(target!==targetVersion.current || request!==recipientVersion.current) return;
      setUsers(response.users);
      const firstUser = response.users.find((user) => user.email) ?? null;
      applyRequester(firstUser, org, context.companyName);
      setMatchedSerial(serial);
    });
  }

  async function applyCheckResult(result: CheckResult) {
    const target = ++targetVersion.current; recipientVersion.current += 1;
    {
      setSelectedOrg(null);setUsers([]);setOrganizations([]);setRequesterEmail("");setRequesterName("");setMatchedSerial(null);
      setIsConfirmOpen(false);setSubjectDirty(false);setBodyDirty(false);
      setSubject(buildMailSubject(result.companyName));setBody(buildMailBody("담당자"));
      setIdempotencyKey(crypto.randomUUID());attachmentAttempts.current.clear();setAttachmentError(null);
      setGeneratedDocument(null);
      setGeneratedAttachmentTokens([]);
      setAttachments([]);
      setNotice(null);
      setError(null);
    }

    setLatestCheckResult(result);setMatchedSerial(null);
    loadedTabs.current.delete("history");
    setDocumentIptablesOk(
      userPreferences.defaultIptablesStatus === "auto" || isCheckFieldUnknown(result, "flags.iptables")
        ? null
        : userPreferences.defaultIptablesStatus === "Y",
    );
    setDocumentAgentOk(
      userPreferences.defaultAgentStatus === "auto" || isCheckFieldUnknown(result, "flags.agent")
        ? null
        : userPreferences.defaultAgentStatus === "Y",
    );
    setDocumentServerModel(
      userPreferences.defaultServerModel === "auto"
        ? inferDocumentServerModel(result.system.serverModel || result.hardwareType)
        : userPreferences.defaultServerModel,
    );
    const companyName = result.companyName.trim();
    const serial = result.serial.trim();
    const nextSubject = buildMailSubject(companyName);
    const nextBody = renderMailBodyTemplate(userPreferences.mailBodyTemplate, "담당자");
    setSubject(nextSubject); setBody(nextBody);
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
      if(target!==targetVersion.current)return;
      setOrganizations(response.organizations);
      if (response.matchedOrganization) {
        setOrgMatchStatus(
          response.matchMode === "serial"
            ? `Serial 자동 매칭 성공: ${serial}`
            : `회사명 후보에서 Serial 매칭 성공: ${serial}`,
        );
        await selectOrganization(response.matchedOrganization, {serial: result.serial, companyName: result.companyName});
        if(target!==targetVersion.current)return;
        setMatchedSerial(normalizeSerialForCompare(result.serial));
        return;
      }
      setOrgMatchStatus(
        response.organizations.length > 0
          ? "Serial 자동 매칭 실패 - 조직을 수동 선택하세요."
          : "검색 결과 없음 - 회사명으로 수동 검색하세요.",
      );
    });
  }

  function applyRequester(user: ZendeskUser | null, org = selectedOrg, companyOverride?: string) {
    const nextEmail = user?.email ?? "";
    const nextName = user?.name ?? "";
    setRequesterEmail(nextEmail);
    setRequesterName(nextName);

    const companyName = companyOverride ?? latestCheckResult?.companyName ?? generatedDocument?.companyName ?? org?.name ?? "";
    if (!subjectDirty) {
      setSubject(buildMailSubject(companyName));
    }
    if (!bodyDirty) {
      setBody(renderMailBodyTemplate(userPreferences.mailBodyTemplate, nextName || "담당자"));
    } else {
      setBody((current) => replaceMailBodyRequester(current, requesterName, nextName));
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
    if(!isReady || busyLabel)return;
    const target = targetVersion.current; const recipient = recipientVersion.current;
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
      if(target!==targetVersion.current || recipient!==recipientVersion.current)throw new DOMException("고객 또는 수신자가 변경되었습니다.","AbortError");

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

      if(target!==targetVersion.current || recipient!==recipientVersion.current)return;
      setNotice(buildTicketSendNotice(response));
      setIdempotencyKey(crypto.randomUUID());
      setGeneratedAttachmentTokens([]);
      setIsConfirmOpen(false);
      refreshRecords();
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

  async function retryPdfDocument(id: string): Promise<GeneratedDocument> {
    const scope = scopeVersion.current;
    if (pdfRetryLocks.current.has(id)) throw new Error("이 문서의 PDF를 변환 중입니다. 잠시 기다려 주세요.");
    pdfRetryLocks.current.add(id);
    try {
    const response = await apiFetch<{ document: GeneratedDocument; reusedExistingPdf: boolean }>(`/api/documents/${encodeURIComponent(id)}/retry-pdf`, { method: "POST" });
    if (scope !== scopeVersion.current) throw new DOMException("계정이 변경되었습니다.", "AbortError");
    const doc = response.document;
    const pdfError = typeof doc.pdfStatus !== "string" && !doc.pdfStatus.ok ? doc.pdfStatus.message : "PDF가 생성되지 않았습니다. DOCX는 보존됩니다.";
    setGeneratedDocument(current => current?.id === id ? doc : current);
    setBatchItems(current => current.map(item => item.document?.id === id ? { ...item, document: doc, status: doc.pdf ? "documented" : "failed", error: doc.pdf ? null : pdfError } : item));
    setDocumentLibrary(current => current.map(item => item.id === id ? { ...item, ...doc, pdfStatus: doc.pdf ? "success" : "failed", pdfErrorSummary: doc.pdf ? null : pdfError } : item));
    loadedTabs.current.delete("documents"); loadedTabs.current.delete("history");
    if (activeTab === "documents") void loadDocumentLibrary(session?.access_token, null, 0, appliedDocuments.current);
    if (!doc.pdf) throw new Error(pdfError);
    setNotice(response.reusedExistingPdf ? "이미 생성된 PDF를 확인했습니다." : "PDF 재시도 완료 · DOCX 원본과 보관 기한을 유지했습니다.");
    return doc;
    } finally { pdfRetryLocks.current.delete(id); }
  }

  async function generateDocuments(includePdf = true) {
    const target = targetVersion.current;
    if (!latestCheckResult) {
      setError("먼저 점검 데이터를 불러오세요.");
      return;
    }

    await runBusy(includePdf ? "확인서 DOCX/PDF 생성 중" : "DOCX 확인서 생성 중", async () => {
      const response = await apiFetch<{
        document: GeneratedDocument;
        pdfConverterEnabled: boolean;
      }>("/api/documents/check-report", {
        method: "POST",
        body: JSON.stringify({
          checkResult: latestCheckResult,
          manual: {
            flagOverrides: {
              ...(documentIptablesOk === null ? {} : { iptables: documentIptablesOk }),
              ...(documentAgentOk === null ? {} : { agent: documentAgentOk }),
            },
            companyName: latestCheckResult.companyName,
            serial: latestCheckResult.serial,
            productName: latestCheckResult.softwareName || "오피스키퍼",
            serverModel: documentServerModel || inferredServerModel,
            engineerName: engineerName.trim() || "점검자",
            engineerSignatureName,
            opinion: documentOpinion,
          },
          output: { docx: true, pdf: includePdf },
        }),
      });
      const doc = response.document;
      if(target!==targetVersion.current)return;
      setGeneratedAttachmentTokens([]);
      attachmentAttempts.current.clear();
      setAttachmentError(null);
      setIdempotencyKey(crypto.randomUUID());
      setGeneratedDocument(doc);
      refreshRecords();

      if (doc.pdf) {
        await attachGeneratedToZendesk(doc, ["pdf"]);
        if(target!==targetVersion.current)return;
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
    if(preview){setNotice("가상 데이터 화면에서는 실제 파일을 다운로드하지 않습니다.");return;}
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

  async function resolvePdfPreview(downloadUrl: string): Promise<string|null> {
    if(preview)return null;
    if(!session?.access_token)throw new Error("로그인이 필요합니다.");
    const scope=scopeVersion.current;
    const url=new URL(downloadUrl,window.location.origin);
    if(url.origin!==window.location.origin)throw new Error("허용되지 않은 미리보기 주소입니다.");
    url.searchParams.set("mode","preview");
    const response=await fetch(url,{headers:{authorization:`Bearer ${session.access_token}`}});
    if(!response.ok)throw new Error("PDF를 열 수 없습니다. 문서 사용 기한과 권한을 확인하세요.");
    const blob=await response.blob();
    if(scope!==scopeVersion.current)throw new DOMException("계정이 변경되었습니다.","AbortError");
    return URL.createObjectURL(new Blob([blob],{type:"application/pdf"}));
  }

  async function previewGeneratedPdf(downloadUrl: string) {
    if(preview){setNotice("가상 문서입니다. 실제 PDF는 로그인 환경의 유효 문서에서 확인하세요.");return;}
    if (!session?.access_token) {
      setError("로그인이 필요합니다.");
      return;
    }

    const previewWindow = window.open("about:blank", "_blank");
    if (!previewWindow) {
      setError("브라우저 팝업 차단을 해제한 뒤 다시 시도하세요.");
      return;
    }
    previewWindow.opener = null;

    try {
      const previewUrl = new URL(downloadUrl, window.location.origin);
      previewUrl.searchParams.set("mode", "preview");
      const response = await fetch(previewUrl.toString(), {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.message || `미리보기 실패 (HTTP ${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      previewWindow.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (nextError) {
      previewWindow.close();
      setError(nextError instanceof Error ? nextError.message : "PDF 미리보기 실패");
    }
  }

  async function attachGeneratedToZendesk(
    doc: GeneratedDocument,
    types: Array<"docx" | "pdf">,
    mode: ZendeskSendMode = selectedSendMode,
  ) {
    const target = targetVersion.current;
    const response = await apiFetch<{
      uploads: Array<{ token: string; fileName: string; type: "docx" | "pdf"; size: number; dryRun: boolean }>;
    }>("/api/zendesk/uploads/generated", {
      method: "POST",
      body: JSON.stringify({ documentId: doc.id, types, dryRun: mode === "dry-run" }),
    });
    if(target!==targetVersion.current)throw new DOMException("점검 대상이 변경되었습니다.","AbortError");
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
    if(!doc.pdf||!Number.isFinite(Date.parse(doc.expiresAt))||Date.parse(doc.expiresAt)<=Date.now()){
      setError("유효기간 내 PDF 문서만 메일 첨부로 사용할 수 있습니다.");
      return;
    }
    await runBusy("문서함 PDF 첨부 중", async () => {
      const target = ++targetVersion.current; recipientVersion.current += 1;
      setAttachments([]);setGeneratedDocument(null);setSubjectDirty(false);setBodyDirty(false);
      attachmentAttempts.current.clear();setAttachmentError(null);
      setSelectedOrg(null);setUsers([]);setRequesterEmail("");setRequesterName("");setMatchedSerial(null);setLatestCheckResult(null);
      setIsConfirmOpen(false);setQuery(doc.companyName);setSubject(buildMailSubject(doc.companyName));setBody(buildMailBody("담당자"));
      setGeneratedAttachmentTokens([]);setIdempotencyKey(crypto.randomUUID());
      await attachGeneratedToZendesk(doc, ["pdf"]);
      if(target!==targetVersion.current)return;
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
    next = { ...next, defaultEngineerName: normalizeActiveEngineerName(next.defaultEngineerName) };
    setUserPreferences(next);
    if(!preview)writeUserPreferences(session?.user?.email ?? null, next);
    if (next.defaultEngineerName) {
      setEngineerName(next.defaultEngineerName);
      setEngineerSignatureName(engineerSignatures.find((option) => option.name === next.defaultEngineerName)?.hasSignature === false ? "" : next.defaultEngineerName);
      if (!preview && session?.user?.email) {
        writeBrowserValue(signatureStorageKey(session.user.email), next.defaultEngineerName);
      }
    }
    setAutoSolved(next.defaultAutoSolved);
    if (!bodyDirty) {
      setBody(renderMailBodyTemplate(next.mailBodyTemplate, requesterName || "담당자"));
    }
    if (next.defaultSendMode === "real" && sendMode !== "real") {
      void updateSelectedSendMode("dry-run");
      setBatchSendMode("dry-run");
    } else {
      void updateSelectedSendMode(next.defaultSendMode);
      setBatchSendMode(next.defaultSendMode);
    }
    if (next.defaultServerModel !== "auto") {
      setDocumentServerModel(next.defaultServerModel);
    }
    setDocumentIptablesOk(
      next.defaultIptablesStatus === "auto" || (latestCheckResult && isCheckFieldUnknown(latestCheckResult, "flags.iptables"))
        ? null
        : next.defaultIptablesStatus === "Y",
    );
    setDocumentAgentOk(
      next.defaultAgentStatus === "auto" || (latestCheckResult && isCheckFieldUnknown(latestCheckResult, "flags.agent"))
        ? null
        : next.defaultAgentStatus === "Y",
    );
  }

  async function savePreferences(next: UserPreferences) {
    await runBusy("개인 설정 저장 중", async () => {
      const response = await apiFetch<{ preferences: UserPreferences }>("/api/user/preferences", {
        method: "PUT",
        body: JSON.stringify({ preferences: next }),
      });
      applyPreferences(response.preferences);
      if(!preview)writeUserPreferences(session?.user?.email ?? null, response.preferences);
      setNotice("개인 설정을 저장했습니다.");
    });
  }

  function saveBatchMappings(nextMappings: CustomerMailMapping[]) {
    setBatchMappings(nextMappings);
    if(!preview)writeBatchMappings(session?.user.email ?? null, nextMappings);
    if (session?.access_token) {
      void persistBatchMappings(nextMappings);
    }
    setBatchItems((current) =>
      current.map((item) => {
        const matchedMapping = item.result
          ? findBatchMapping(nextMappings, item.result.serial || item.serial, item.result.companyName)
          : null;
        return {
          ...item,
          mapping: matchedMapping ?? item.mapping,
        };
      }),
    );
  }

  async function persistBatchMappings(nextMappings: CustomerMailMapping[]) {
    try {
      const response = await apiFetch<{ mappings: CustomerMailMapping[] }>("/api/user/customer-mappings", {
        method: "PUT",
        body: JSON.stringify({ mappings: nextMappings }),
      });
      setBatchMappings(response.mappings);
      if(!preview)writeBatchMappings(session?.user.email ?? null, response.mappings);
    } catch (nextError) {
      console.warn("customer_mappings_save_failed", nextError);
    }
  }

  function addBatchMapping() {
    const next = normalizeMappingForm(mappingForm);
    if (!next.serial && !next.companyName) {
      setError("매핑에는 고객사명 또는 시리얼이 필요합니다.");
      return;
    }
    if (!next.zendeskOrgId || !next.requesterEmail) {
      setError("Zendesk 조직 ID와 요청자 이메일이 필요합니다.");
      return;
    }
    const mapping: CustomerMailMapping = {
      id: crypto.randomUUID(),
      ...next,
    };
    const nextSerial = normalizeSerialForCompare(mapping.serial);
    const nextCompany = mapping.companyName.toLowerCase();
    const filteredMappings = batchMappings.filter((current) => {
      const sameSerial = nextSerial && normalizeSerialForCompare(current.serial) === nextSerial;
      const sameCompany = nextCompany && current.companyName.toLowerCase() === nextCompany;
      return !sameSerial && !sameCompany;
    });
    saveBatchMappings([mapping, ...filteredMappings]);
    setMappingForm(emptyMappingForm);
    setBatchOrgCandidates([]);
    setBatchUserCandidates([]);
    setNotice("고객사/담당자 매핑을 저장했습니다.");
  }

  function removeBatchMapping(id: string) {
    saveBatchMappings(batchMappings.filter((mapping) => mapping.id !== id));
  }

  function updateMappingForm(field: keyof Omit<CustomerMailMapping, "id">, value: string) {
    setMappingForm((current) => ({ ...current, [field]: value }));
  }

  async function searchBatchMappingOrganizations() {
    const companyName = mappingForm.companyName.trim();
    if (companyName.length < 2) {
      setError("고객사명은 2자 이상 입력하세요.");
      return;
    }

    await runBusy("일괄 매핑 조직 검색 중", async () => {
      const response = await apiFetch<{ organizations: Organization[] }>(
        `/api/zendesk/organizations?query=${encodeURIComponent(companyName)}`,
      );
      setBatchOrgCandidates(response.organizations);
      setBatchUserCandidates([]);
      setNotice(
        response.organizations.length > 0
          ? "검색된 Zendesk 조직을 선택하세요."
          : "검색된 Zendesk 조직이 없습니다. 고객사명을 다시 확인하세요.",
      );
    });
  }

  async function selectBatchMappingOrganization(org: Organization) {
    const orgName = org.name?.trim() || mappingForm.companyName.trim();
    setMappingForm((current) => ({
      ...current,
      companyName: orgName,
      zendeskOrgId: String(org.id),
    }));

    await runBusy("일괄 매핑 요청자 조회 중", async () => {
      const response = await apiFetch<{ users: ZendeskUser[] }>(
        `/api/zendesk/users?organizationId=${encodeURIComponent(String(org.id))}`,
      );
      setBatchUserCandidates(response.users);
      const firstUser = response.users.find((user) => user.email) ?? null;
      if (firstUser) {
        setMappingForm((current) => ({
          ...current,
          requesterName: firstUser.name ?? "",
          requesterEmail: firstUser.email ?? "",
        }));
      }
    });
  }

  function selectBatchMappingRequester(user: ZendeskUser) {
    setMappingForm((current) => ({
      ...current,
      requesterName: user.name ?? "",
      requesterEmail: user.email ?? "",
    }));
  }

  function fillBatchMappingFromCurrent() {
    if (!latestCheckResult && !selectedOrg) {
      setError("현재 불러온 점검 데이터나 선택한 Zendesk 조직이 없습니다.");
      return;
    }

    setMappingForm({
      companyName: latestCheckResult?.companyName ?? selectedOrg?.name ?? "",
      serial: "",
      zendeskOrgId: selectedOrg ? String(selectedOrg.id) : "",
      requesterName,
      requesterEmail,
      ccEmails: "",
      defaultEngineerName: engineerName || userPreferences.defaultEngineerName,
      memo: "",
    });
    setNotice("현재 점검/메일 화면 값을 매핑 입력란에 채웠습니다.");
  }

  function updateBatchItem(id: string, updater: (item: BatchItem) => BatchItem) {
    setBatchItems((current) => current.map((item) => (item.id === id ? updater(item) : item)));
  }

  async function runBatchCheck() {
    const scope = scopeVersion.current;
    const serials = parseBatchSerials(batchSerialInput);
    if (serials.length === 0) {
      setError("일괄 점검할 시리얼을 입력하세요.");
      return;
    }

    const existingSerials = new Set(
      batchItems.map((item) => normalizeSerialForCompare(item.result?.serial || item.serial)),
    );
    const newSerials = serials.filter((serial) => !existingSerials.has(normalizeSerialForCompare(serial)));
    const skippedCount = serials.length - newSerials.length;
    if (newSerials.length === 0) {
      setBatchSerialInput("");
      setError(null);
      setNotice(`입력한 시리얼 ${serials.length}건이 모두 일괄 처리 목록에 있어 조회하지 않았습니다.`);
      return;
    }

    const initialItems: BatchItem[] = newSerials.map((serial) => ({
      id: crypto.randomUUID(),
      serial,
      selected: false,
      status: "queued",
      normal: false,
      result: null,
      document: null,
      mapping: findBatchMapping(batchMappings, serial, ""),
      error: null,
      sendTicketId: null,
      sendTicketUrl: null,
      sendAttachmentFileName: null,
      sendAttachmentSize: null,
      sendMode: null,
      sendIdempotencyKey: null,
    }));

    setBatchItems((current) => [...current, ...initialItems]);
    setBatchSerialInput("");
    setError(null);
    await runBusy("일괄 점검 조회 중", async () => {
      setBatchProgress({ phase: "checking", current: 0, total: initialItems.length, message: "신규 항목 조회 준비 중" });
      for (const [index, item] of initialItems.entries()) {
        if(scope!==scopeVersion.current)throw new DOMException("계정이 변경되었습니다.","AbortError");
        setBatchProgress({
          phase: "checking",
          current: index + 1,
          total: initialItems.length,
          message: `${item.serial} 조회 중`,
        });
        updateBatchItem(item.id, (current) => ({ ...current, status: "checking", error: null }));
        try {
          const response = await apiFetch<{ result: CheckResult }>("/api/solution/checkup", {
            method: "POST",
            body: JSON.stringify({ serial: item.serial }),
          });
          const result = response.result;
          const mapping = findBatchMapping(batchMappings, result.serial || item.serial, result.companyName);
          const normal = isBatchNormalResult(result);
          const autoSelected = isBatchAutoSelectableResult(result);
          updateBatchItem(item.id, (current) => ({
            ...current,
            serial: result.serial || current.serial,
            status: "checked",
            normal,
            result,
            mapping,
            selected: autoSelected,
          }));
        } catch (nextError) {
          if(nextError instanceof DOMException && nextError.name === "AbortError")throw nextError;
          updateBatchItem(item.id, (current) => ({
            ...current,
            status: "failed",
            error: nextError instanceof Error ? nextError.message : "점검 조회 실패",
          }));
        }
      }
      setBatchProgress(null);
      setNotice(
        `신규 ${initialItems.length}건 조회를 완료했습니다.${skippedCount > 0 ? ` 기존 ${skippedCount}건은 유지했습니다.` : ""}`,
      );
    });
  }

  function toggleBatchItem(id: string, selected: boolean) {
    updateBatchItem(id, (item) => ({ ...item, selected }));
  }

  function applyBatchItemMapping(id: string, mappingId: string) {
    const mapping = batchMappings.find((item) => item.id === mappingId) ?? null;
    updateBatchItem(id, (item) => ({
      ...item,
      mapping,
      selected: Boolean(item.result && mapping) ? item.selected : item.selected,
    }));
  }

  function selectNormalBatchItems() {
    setBatchItems((current) =>
      current.map((item) => ({
        ...item,
        selected: item.result ? isBatchAutoSelectableResult(item.result) : false,
      })),
    );
  }

  function selectMappedBatchItems() {
    setBatchItems((current) => current.map((item) => ({ ...item, selected: Boolean(item.result && item.mapping) })));
  }

  function selectFailedBatchItems() {
    setBatchItems((current) => current.map((item) => ({ ...item, selected: item.status === "failed" })));
  }

  function removeBatchItems(ids: string[]) {
    const idSet = new Set(ids);
    const targets = batchItems.filter((item) => idSet.has(item.id));
    if (targets.length === 0) {
      return;
    }

    const protectedCount = targets.filter((item) => item.document || item.sendTicketId).length;
    const message =
      protectedCount > 0
        ? `선택한 ${targets.length}건 중 ${protectedCount}건은 PDF 생성 또는 Zendesk 발송이 완료되었습니다.\n현재 일괄 처리 목록에서만 제거하며 문서함과 발송 이력은 유지됩니다. 삭제하시겠습니까?`
        : `선택한 ${targets.length}건을 현재 일괄 처리 목록에서 삭제하시겠습니까?`;
    if (!window.confirm(message)) {
      return;
    }

    setBatchItems((current) => current.filter((item) => !idSet.has(item.id)));
    setNotice(`일괄 처리 목록에서 ${targets.length}건을 삭제했습니다.`);
  }

  async function generateBatchDocuments() {
    const scope = scopeVersion.current;
    const targets = batchReadyForDocuments;
    if (targets.length === 0) {
      setError("PDF를 생성할 선택 항목이 없습니다. 정상 상태와 매핑 여부를 확인하세요.");
      return;
    }

    await runBusy("일괄 PDF 생성 중", async () => {
      setBatchProgress({ phase: "documenting", current: 0, total: targets.length, message: "PDF 생성 준비 중" });
      for (const [index, item] of targets.entries()) {
        if(scope!==scopeVersion.current)throw new DOMException("계정이 변경되었습니다.","AbortError");
        if (!item.result) continue;
        setBatchProgress({
          phase: "documenting",
          current: index + 1,
          total: targets.length,
          message: `${item.result.companyName || item.serial} PDF 생성 중`,
        });
        try {
          if (item.document) {
            await retryPdfDocument(item.document.id);
            continue;
          }
          const serverModel = inferDocumentServerModel(item.result.system.serverModel || item.result.hardwareType);
          const batchEngineerName = normalizeActiveEngineerName(item.mapping?.defaultEngineerName ?? "") || engineerName || normalizeActiveEngineerName(userPreferences.defaultEngineerName) || "점검자";
          const response = await apiFetch<{ document: GeneratedDocument; pdfConverterEnabled: boolean }>(
            "/api/documents/check-report",
            {
              method: "POST",
              body: JSON.stringify({
                checkResult: item.result,
                manual: {
                  flagOverrides: {
                    ...resolveDefaultDocumentFlagOverride(item.result, "iptables", userPreferences.defaultIptablesStatus),
                    ...resolveDefaultDocumentFlagOverride(item.result, "agent", userPreferences.defaultAgentStatus),
                  },
                  companyName: item.result.companyName,
                  serial: item.result.serial,
                  productName: item.result.softwareName || "오피스키퍼",
                  serverModel,
                  engineerName: batchEngineerName,
                  engineerSignatureName: engineerSignatures.find((option) => option.name === batchEngineerName)?.hasSignature === false ? "" : batchEngineerName,
                  opinion: batchDocumentOpinion,
                },
                output: { docx: true, pdf: true },
              }),
            },
          );
          updateBatchItem(item.id, (current) => ({
            ...current,
            status: response.document.pdf ? "documented" : "failed",
            document: response.document,
            error: response.document.pdf ? null : "PDF가 생성되지 않았습니다.",
          }));
        } catch (nextError) {
          if(nextError instanceof DOMException && nextError.name === "AbortError")throw nextError;
          updateBatchItem(item.id, (current) => ({
            ...current,
            status: "failed",
            error: nextError instanceof Error ? nextError.message : "문서 생성 실패",
          }));
        }
      }
      setBatchProgress(null);
      refreshRecords();
    });
  }

  function handleBatchSendModeSelect(value: string) {
    const requested = value === "default" ? userPreferences.defaultSendMode : (value as ZendeskSendMode);
    setBatchSendMode(resolveSafeSendMode(requested, canRealSend));
  }

  function openBatchSendConfirm() {
    const safeMode = resolveSafeSendMode(batchSendMode, canRealSend);
    const targets = batchReadyForSend;
    if (targets.length === 0) {
      setError("발송할 선택 항목이 없습니다. PDF 생성과 매핑 여부를 확인하세요.");
      return;
    }
    if (targets.length > maxBatchZendeskSendCount) {
      setError(
        `일괄 Zendesk 발송은 한 번에 최대 ${maxBatchZendeskSendCount}건까지 가능합니다. ` +
          `현재 ${targets.length}건이 선택되어 있습니다. ${maxBatchZendeskSendCount}건 이하로 선택해 진행하세요.`,
      );
      return;
    }
    if (batchSendMode === "real" && !canRealSend) {
      setBatchSendMode("dry-run");
      setError("현재 환경에서는 실제 전송이 차단되어 있습니다. 운영 환경 설정을 확인하세요.");
      return;
    }
    if (safeMode !== batchSendMode) {
      setBatchSendMode(safeMode);
    }
    setError(null);
    setIsBatchConfirmOpen(true);
  }

  async function sendBatchZendesk() {
    const scope = scopeVersion.current;
    const safeMode = resolveSafeSendMode(batchSendMode, canRealSend);
    const isDryRun = safeMode === "dry-run";
    const targets = batchReadyForSend;
    setIsBatchConfirmOpen(false);
    await runBusy(`일괄 Zendesk ${isDryRun ? "테스트 전송" : "실제 전송"} 중`, async () => {
      if (batchSendMode === "real" && !canRealSend) {
        setBatchSendMode("dry-run");
        setError("현재 환경에서는 실제 전송이 차단되어 있습니다. 운영 환경 설정을 확인하세요.");
        return;
      }
      if (safeMode !== batchSendMode) {
        setBatchSendMode(safeMode);
      }
      setBatchProgress({
        phase: "sending",
        current: 0,
        total: targets.length,
        message: `Zendesk ${isDryRun ? "테스트 전송" : "실제 전송"} 준비 중`,
      });
      let successCount = 0;
      let learnedMappings = batchMappings;
      for (const [index, item] of targets.entries()) {
        if(scope!==scopeVersion.current)throw new DOMException("계정이 변경되었습니다.","AbortError");
        if (!item.result || !item.mapping || !item.document?.pdf) continue;
        const idempotencyKey =
          (item.sendMode === safeMode ? item.sendIdempotencyKey : null) ??
          buildBatchIdempotencyKey({
            userId: session?.user.id ?? "unknown",
            item,
            mode: safeMode,
          });
        setBatchProgress({
          phase: "sending",
          current: index + 1,
          total: targets.length,
          message: `${item.result.companyName || item.serial} ${isDryRun ? "테스트 전송" : "실제 전송"} 중`,
        });
        updateBatchItem(item.id, (current) => ({
          ...current,
          status: "sending",
          error: null,
          sendMode: safeMode,
          sendIdempotencyKey: idempotencyKey,
        }));
        try {
          const uploadResponse = await apiFetch<{
            uploads: Array<{ token: string; fileName: string; type: "docx" | "pdf"; size: number; dryRun: boolean }>;
          }>("/api/zendesk/uploads/generated", {
            method: "POST",
            body: JSON.stringify({ documentId: item.document.id, types: ["pdf"], dryRun: isDryRun }),
          });
          const uploadedPdf = uploadResponse.uploads.find((upload) => upload.type === "pdf") ?? null;
          const response = await apiFetch<{
            dryRun: boolean;
            duplicate: boolean;
            ticketId: string | null;
            ticketUrl: string | null;
          }>("/api/zendesk/tickets", {
            method: "POST",
            body: JSON.stringify({
              idempotencyKey,
              organizationId: item.mapping.zendeskOrgId,
              requesterName: item.mapping.requesterName,
              requesterEmail: item.mapping.requesterEmail,
              subject: buildMailSubject(item.result.companyName),
              body: renderMailBodyTemplate(userPreferences.mailBodyTemplate, item.mapping.requesterName || item.mapping.requesterEmail),
              engineerName: normalizeActiveEngineerName(item.mapping.defaultEngineerName) || engineerName,
              groupId: settings?.defaultGroupId,
              assigneeEmail: settings?.fixedAssigneeEmail,
              autoSolve: true,
              dryRun: isDryRun,
              fieldValues: settings?.defaultValues ?? {},
              uploadTokens: uploadResponse.uploads.map((upload) => upload.token),
            }),
          });
          updateBatchItem(item.id, (current) => ({
            ...current,
            status: "sent",
            error: null,
            sendTicketId: response.ticketId,
            sendTicketUrl: response.ticketUrl,
            sendAttachmentFileName: uploadedPdf?.fileName ?? item.document?.pdf?.fileName ?? null,
            sendAttachmentSize: uploadedPdf?.size ?? item.document?.pdf?.size ?? null,
            sendMode: response.dryRun ? "dry-run" : "real",
            sendIdempotencyKey: idempotencyKey,
          }));
          successCount += 1;
          learnedMappings = upsertSerialBatchMapping(learnedMappings, item.result, item.mapping);
          saveBatchMappings(learnedMappings);
        } catch (nextError) {
          if(nextError instanceof DOMException && nextError.name === "AbortError")throw nextError;
          updateBatchItem(item.id, (current) => ({
            ...current,
            status: "failed",
            error: nextError instanceof Error ? nextError.message : `Zendesk ${isDryRun ? "테스트 전송" : "실제 전송"} 실패`,
          }));
        }
      }
      setBatchProgress(null);
      refreshRecords();
      setNotice(`일괄 Zendesk ${isDryRun ? "테스트 전송" : "실제 전송"} ${successCount}건을 완료했습니다.`);
    });
  }

  async function runBusy(label: string, action: () => Promise<void>) {
    const scope = scopeVersion.current;
    setBusyLabel(label);
    setError(null);

    try {
      await action();
    } catch (nextError) {
      if(scope===scopeVersion.current && !(nextError instanceof DOMException && nextError.name==="AbortError")) setError(nextError instanceof Error ? nextError.message : "요청 처리 중 오류가 발생했습니다.");
    } finally {
      if(scope===scopeVersion.current)setBusyLabel(null);
    }
  }

  return (
    <main className="ops-console min-h-screen bg-background text-foreground">
      {restoringSession ? <div className="login-workspace"><p className="login-brand">Check Server</p><div role="status" aria-live="polite" className="mx-auto mt-16 flex w-full max-w-sm items-center justify-center gap-3 rounded-lg border bg-card px-6 py-10 text-sm text-muted-foreground"><RefreshCw className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />저장된 로그인 확인 중…</div></div> : !session ? <div className="login-workspace"><p className="login-brand">Check Server</p>          <Card className="mx-auto mt-16 w-full max-w-sm">
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
                <p className="text-xs leading-relaxed text-muted-foreground">로그인은 이 브라우저의 현재 사이트 주소에서 유지됩니다. 공용 기기에서는 사용 후 로그아웃하세요.</p>
                <Button type="submit" className="w-full" disabled={authPending}>
                  {authPending ? "처리 중…" : "로그인"}
                </Button>
              </form>
            </CardContent>
          </Card></div> : (
        <WorkspaceShell tab={activeTab} onTabChange={value=>{setActiveTab(value);setNotice(null);setRecipientOpen(false);}} email={session.user.email||"사용자"} role={currentRole} preview={preview} realSend={canRealSend} busy={busyLabel} onSignOut={()=>void signOut()} counts={{batch:batchItems.length}}>
          {error&&<div role="alert" className="workspace-error">{error}</div>}
          {(activeTab === "mail" || activeTab === "batch") && settingsError ? <div role="alert" className="my-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"><p>Zendesk 발송 설정: {settingsError}</p><p className="mt-1 text-xs text-muted-foreground">발송 설정과 별도로 고객·수신자를 검색할 수 있습니다.</p><Button type="button" variant="outline" className="mt-2" disabled={settingsLoading} onClick={() => void refreshMailSettings()}>발송 설정 다시 조회</Button></div> : null}
          {activeTab === "mail" && mailHistoryError ? <p role="status" className="my-3 text-xs text-muted-foreground">{mailHistoryError}</p> : null}
            {notice ? <div role="status" className="my-3 rounded-lg border bg-primary/5 p-3 text-sm">{notice}</div> : null}
            {attachmentError && activeTab === "mail" ? <div role="alert" className="my-3 rounded-lg border border-destructive/30 p-3 text-sm"><p>{attachmentError}</p><Button variant="outline" className="mt-2" onClick={() => {if(generatedDocument) void runBusy("첨부 재시도",async()=>{await attachGeneratedToZendesk(generatedDocument,["pdf"]);setAttachmentError(null);});}}><RefreshCw />첨부 준비 다시 시도</Button></div> : null}
            <WorkspacePanel activeValue={activeTab} value="check" keepMounted>
              <div className="check-workspace">
                <CheckFlowPanel key={session.user.id} userId={session.user.id} showResult={false} currentResult={latestCheckResult} preview={preview} apiClient={preview ? previewApi : undefined} accessToken={session.access_token} onResult={result=>void applyCheckResult(result)} />
                <div className="check-columns">
                  <section className="check-results">
                    {latestCheckResult ? <ResultSummary result={latestCheckResult} documentFlags={{...(documentIptablesOk === null ? {} : {iptables:documentIptablesOk}),...(documentAgentOk === null ? {} : {agent:documentAgentOk})}} /> : <div className="workspace-empty"><Search aria-hidden/><h2>점검할 시리얼을 조회하세요</h2><p>수집 결과와 확인이 필요한 항목을 이곳에서 검토할 수 있습니다.</p></div>}
                  </section>
                  <aside className="report-config">{latestCheckResult ? <>
                  <Panel title="확인서 설정">
                    <p className="mb-4 text-xs text-muted-foreground">문서에 적용할 값을 검토하세요. 수집 원본은 유지됩니다.</p>
                    <p className="mb-3 border-b pb-3 text-xs text-muted-foreground">{latestCheckResult?.companyName} · <span className="font-mono">{latestCheckResult?.serial}</span></p>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
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
                              setEngineerSignatureName(engineerSignatures.find((option) => option.name === nextName)?.hasSignature === false ? "" : nextName);
                              if (!preview && session?.user?.email) {
                                writeBrowserValue(signatureStorageKey(session.user.email), nextName);
                              }
                            }}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="점검자 선택" />
                            </SelectTrigger>
                            <SelectContent>
                              {engineerSignatures.map((option) => (
                                <SelectItem key={option.id} value={option.name}>
                                  {option.name}{option.hasSignature === false ? " (서명 대기)" : ""}
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
                          value={documentIptablesOk === null ? "auto" : documentIptablesOk ? "Y" : "N"}
                          onValueChange={(value) => setDocumentIptablesOk(value === "auto" ? null : value === "Y")}
                          disabled={!latestCheckResult}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Iptables 상태 선택" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">수집값 사용 · {collectedServiceText(latestCheckResult, "iptables", latestCheckResult?.flags.iptables)}</SelectItem>
                            <SelectItem value="Y">Y - 정상</SelectItem>
                            <SelectItem value="N">N - 이상</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="mt-1 text-xs text-muted-foreground">
                          수집: {collectedServiceText(latestCheckResult, "iptables", latestCheckResult?.flags.iptables)} → 문서: {documentIptablesOk === null ? collectedServiceText(latestCheckResult, "iptables", latestCheckResult?.flags.iptables) : `${documentIptablesOk ? "정상" : "이상"} (직접 선택)`}
                        </p>
                      </Field>
                      <Field label="점검서 에이전트 연결 상태">
                        <Select
                          value={documentAgentOk === null ? "auto" : documentAgentOk ? "Y" : "N"}
                          onValueChange={(value) => setDocumentAgentOk(value === "auto" ? null : value === "Y")}
                          disabled={!latestCheckResult}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="에이전트 연결 상태 선택" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">수집값 사용 · {collectedServiceText(latestCheckResult, "agent", latestCheckResult?.flags.agent)}</SelectItem>
                            <SelectItem value="Y">Y - 정상</SelectItem>
                            <SelectItem value="N">N - 이상</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="mt-1 text-xs text-muted-foreground">
                          수집: {collectedServiceText(latestCheckResult, "agent", latestCheckResult?.flags.agent)} → 문서: {documentAgentOk === null ? collectedServiceText(latestCheckResult, "agent", latestCheckResult?.flags.agent) : `${documentAgentOk ? "정상" : "이상"} (직접 선택)`}
                        </p>
                      </Field>
                    </div>
                    <div className="mt-4">
                      <InfoRow
                        label="서명"
                        value={engineerSignatures.find((option) => option.name === engineerName)?.hasSignature === false ? `${engineerName} · 서명 등록 대기 (문서에는 이름만 표시)` : engineerSignatureName || "미등록"}
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
                      <Button variant="outline" size="sm" disabled={!latestCheckResult} onClick={()=>{setDocumentIptablesOk(null);setDocumentAgentOk(null);}}>수집값 사용</Button>
                      <Button
                        disabled={!latestCheckResult || Boolean(busyLabel)}
                        onClick={() => void generateDocuments()}
                        type="button"
                      >
                        DOCX/PDF 생성
                      </Button>
                      <Button variant="outline" disabled={!latestCheckResult || Boolean(busyLabel)} onClick={() => void generateDocuments(false)} type="button">DOCX만 생성</Button>
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
                        <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-xs grid-cols-1">
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
                              onPreview={() => void previewGeneratedPdf(generatedDocument.pdf!.downloadUrl)}
                            />
                          ) : (
                            <div className="space-y-2 py-3"><p className="text-xs text-muted-foreground">PDF 미생성 · 저장된 DOCX로 변환할 수 있습니다.</p><Button variant="outline" disabled={Boolean(busyLabel) || Date.parse(generatedDocument.expiresAt) <= Date.now()} onClick={() => void runBusy("PDF만 다시 변환 중", async () => { await retryPdfDocument(generatedDocument.id); })}><RefreshCw className={busyLabel === "PDF만 다시 변환 중" ? "animate-spin" : ""} aria-hidden/>PDF만 다시 시도</Button><p className="text-xs text-muted-foreground">원본·문서 ID·보관 기한 유지</p></div>
                          )}
                        </div>
                      </div>
                    )}
                  </Panel>
                  </> : <Panel title="확인서 설정"><p className="text-sm text-muted-foreground">점검 결과를 불러오면 문서에 반영할 값과 생성 옵션이 표시됩니다.</p></Panel>}</aside>
                </div>
              </div>
            </WorkspacePanel>
            <WorkspacePanel activeValue={activeTab} value="batch" keepMounted>
              <BatchWorkflowPanel
                isActive={activeTab === "batch"}
                serialInput={batchSerialInput}
                onSerialInputChange={setBatchSerialInput}
                items={batchItems}
                mappings={batchMappings}
                mappingForm={mappingForm}
                orgCandidates={batchOrgCandidates}
                userCandidates={batchUserCandidates}
                busy={Boolean(busyLabel)}
                readyForDocumentsCount={batchReadyForDocuments.length}
                readyForSendCount={batchReadyForSend.length}
                failedCount={batchFailedCount}
                progress={batchProgress}
                sendMode={batchSendMode}
                canRealSend={canRealSend}
                defaultSendModeLabel={defaultSendModeLabel}
                onCheck={() => void runBatchCheck()}
                onToggle={toggleBatchItem}
                onApplyMapping={applyBatchItemMapping}
                onSelectNormal={selectNormalBatchItems}
                onSelectMapped={selectMappedBatchItems}
                onSelectFailed={selectFailedBatchItems}
                onDeleteItem={(id) => removeBatchItems([id])}
                onDeleteSelected={() => removeBatchItems(selectedBatchItems.map((item) => item.id))}
                onGenerateDocuments={() => void generateBatchDocuments()}
                documentOpinion={batchDocumentOpinion}
                onDocumentOpinionChange={setBatchDocumentOpinion}
                onSendModeChange={handleBatchSendModeSelect}
                onSend={openBatchSendConfirm}
                onMappingFormChange={updateMappingForm}
                onSaveMapping={addBatchMapping}
                onDeleteMapping={removeBatchMapping}
                onFillFromCurrent={fillBatchMappingFromCurrent}
                onSearchMappingOrganizations={() => void searchBatchMappingOrganizations()}
                onSelectMappingOrganization={(org) => void selectBatchMappingOrganization(org)}
                onSelectMappingRequester={selectBatchMappingRequester}
                onPreviewPdf={(url) => void previewGeneratedPdf(url)}
              />
            </WorkspacePanel>
            <WorkspacePanel activeValue={activeTab} value="mail" keepMounted>
              <div className="mail-context-strip">
                <div><span className="context-label">받는 고객</span><strong>{selectedOrg?.name||"고객을 선택하세요"}</strong><span className="text-xs text-muted-foreground">{latestCheckResult?.serial||generatedDocument?.serial||""}</span></div>
                <div><span className="context-label">받는 사람</span><span>{requesterEmail||"수신자 미선택"}</span></div>
                <Badge variant="outline">{selectedSendMode==="dry-run"?"테스트 전송":"실제 전송"}</Badge>
                <Button variant="outline" onClick={()=>setRecipientOpen(true)}><SlidersHorizontal aria-hidden/>고객·수신자 변경</Button>
              </div>
              <form className="mail-compose" onSubmit={openConfirm}>
              <div className="mail-compose-grid">
                <section className="mail-editor space-y-5">
                  <Field label="제목">
                    <Input
                      aria-label="제목"
                      value={subject}
                      onChange={(event) => {
                        setSubjectDirty(true);
                        setSubject(event.target.value);
                      }}
                    />
                  </Field>
                  <Field label="본문">
                    <Textarea
                      aria-label="본문"
                      className="min-h-[320px] resize-y leading-6"
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

                <aside className="mail-send-summary space-y-4">
                  <Panel title="발송 요약">
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
                    <details className="text-xs text-muted-foreground"><summary className="cursor-pointer py-2">고급 발송 정보</summary><InfoRow label="중복 방지 키" value={idempotencyKey.slice(0, 8)} />
                    {configuredFields.map((field) => (
                      <InfoRow key={field.name} label={field.name} value={`${field.id} / ${field.value || "기본값 없음"}`} />
                    ))}</details>
                  </Panel>
                  {generatedDocument?.pdf&&<MailDocumentPreview key={generatedDocument.id} fileName={generatedDocument.pdf.fileName} downloadUrl={generatedDocument.pdf.downloadUrl} resolvePreview={resolvePdfPreview}/>}
                  <label className="flex items-start gap-3 rounded-md border bg-card p-4 text-sm">
                    <input
                      className="mt-1 h-4 w-4 accent-primary"
                      checked={autoSolved}
                      onChange={(event) => setAutoSolved(event.target.checked)}
                      type="checkbox"
                    />
                    <span>
                      <span className="block font-medium">발송 후 해결 상태 처리</span>
                      <span className="mt-1 block leading-5 text-muted-foreground">{autoSolved ? "티켓 생성 후 해결 상태로 처리합니다." : "티켓 생성 후 해결 상태로 자동 변경하지 않습니다."} 최종 확인 후 적용됩니다.</span>
                    </span>
                  </label>
                  <Button className="w-full" size="lg" disabled={!isReady || Boolean(busyLabel)} type="submit">
                    발송 내용 확인
                  </Button>
                </aside>
              </div>
              </form>
              <div className="mail-recent">              <details className="rounded-xl border bg-card p-4">
                <summary className="cursor-pointer text-sm font-medium">최근 발송 {history.length}건</summary>
                <div className="divide-y">
                  {history.length === 0 ? (
                    <p className="py-4 text-sm text-muted-foreground">발송 이력이 없습니다.</p>
                  ) : (
                    history.map((row) => <HistoryRow key={row.id} row={row} />)
                  )}
                </div>
              </details></div>
              <Dialog open={recipientOpen} onOpenChange={setRecipientOpen}><DialogContent className="recipient-drawer translate-x-0 translate-y-0">
                <DialogHeader><DialogTitle>고객·수신자 선택</DialogTitle><DialogDescription>조직을 찾고 메일을 받을 담당자를 확인하세요.</DialogDescription></DialogHeader>
              <Panel title="고객·수신자 선택">
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
              </Panel>                <Field label="요청자">
                  <select
                    aria-label="요청자"
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
                <Button disabled={!requesterEmail||Boolean(busyLabel)} onClick={()=>setRecipientOpen(false)}>선택 완료<Check aria-hidden/></Button>
              </DialogContent></Dialog>
            </WorkspacePanel>
            <WorkspacePanel activeValue={activeTab} value="history">
              <HistoryPanel
                overview={historyOverview}
                range={historyRange}
                type={historyType}
                status={historyStatus}
                query={historyQuery}
                busy={historyLoading}
                loading={historyLoading} error={historyError}
                from={historyFrom} to={historyTo}
                onFromChange={setHistoryFrom} onToChange={setHistoryTo}
                pageNumber={historyPage+1} canPrevious={historyPage>0}
                hasMore={Boolean(historyOverview?.hasMore)}
                onPrevious={previousHistoryPage} onNext={nextHistoryPage} onReset={resetHistoryFilters}
                onRangeChange={setHistoryRange}
                onTypeChange={setHistoryType}
                onStatusChange={setHistoryStatus}
                onQueryChange={setHistoryQuery}
                onSearch={() => void loadHistoryOverview()}
              />
            </WorkspacePanel>
            <WorkspacePanel activeValue={activeTab} value="documents">
              <DocumentLibraryPanel
                key={(documentAsOf??"unloaded")+":"+documentPage}
                documents={documentLibrary}
                summary={documentLibrarySummary}
                query={documentQuery}
                attachedFilter={documentAttachedFilter}
                statusFilter={documentStatusFilter}
                expiryFilter={documentExpiryFilter} createdRange={documentCreatedRange} asOf={documentAsOf}
                onExpiryFilterChange={setDocumentExpiryFilter} onCreatedRangeChange={setDocumentCreatedRange}
                pageNumber={documentPage+1} canPrevious={documentPage>0} hasMore={Boolean(documentNextCursor)}
                onPrevious={previousDocumentPage} onNext={nextDocumentPage}
                busy={documentsLoading}
                loading={documentsLoading} error={documentsError} hasLoaded={documentsLoaded}
                onReset={resetDocumentFilters}
                onQueryChange={setDocumentQuery}
                onAttachedFilterChange={setDocumentAttachedFilter}
                onStatusFilterChange={setDocumentStatusFilter}
                onSearch={() => void loadDocumentLibrary()}
                onResolvePdfPreview={resolvePdfPreview}
                onDownload={(url, fileName) => void downloadGeneratedDocument(url, fileName)}
                onPreviewPdf={(url) => void previewGeneratedPdf(url)}
                onUseForMail={(doc) => void attachDocumentFromLibrary(doc)}
                onRetryPdf={async (doc) => {
                  const updated = await retryPdfDocument(doc.id);
                  return { ...doc, ...updated, pdfErrorSummary: null };
                }}
              />
            </WorkspacePanel>
            <WorkspacePanel activeValue={activeTab} value="settings" keepMounted>
              <UserSettingsPanel
                key={session.user.id}
                defaultTemplate={buildMailBody("{{requesterName}}")}
                renderPreview={template=>renderMailBodyTemplate(template,"샘플 담당자")}
                hasCurrentDraft={Boolean(latestCheckResult||bodyDirty)}
                preferences={userPreferences}
                signatures={engineerSignatures}
                canRealSend={canRealSend}
                saving={Boolean(busyLabel)}
                onSave={savePreferences}
              />
            </WorkspacePanel>
            {currentRole === "admin" && session?.access_token ? (
              <WorkspacePanel activeValue={activeTab} value="admin">
                <AdminConsole accessToken={session.access_token} apiClient={preview ? previewApi : undefined} />
              </WorkspacePanel>
            ) : null}
        </WorkspaceShell>
      )}

      <Dialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
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
            <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">본문</p><p className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap rounded-lg border p-3 leading-6">{body}</p></div>
            <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">첨부 파일</p><ul className="mt-2 space-y-1">{[...attachments.map(file=>file.name),...activeGeneratedAttachmentTokens.map(file=>file.fileName)].map((name,index)=><li key={index} className="flex gap-2 text-sm"><FileText className="size-4" aria-hidden/>{name}</li>)}</ul></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsConfirmOpen(false)} type="button">
              닫기
            </Button>
            <Button disabled={Boolean(busyLabel)} onClick={() => void sendTicket()} type="button">
              {selectedSendMode === "dry-run" ? "테스트 실행" : "실제 전송"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isBatchConfirmOpen} onOpenChange={setIsBatchConfirmOpen}>
        <DialogContent className="h-[min(90vh,820px)] grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="px-5 pt-5">
            <p className="text-sm font-medium text-primary">일괄 발송 최종 확인</p>
            <DialogTitle className="text-xl">
              {batchSendMode === "dry-run" ? "테스트 전송" : "실제 전송"} {batchReadyForSend.length}건을 확인하세요
            </DialogTitle>
            <DialogDescription>
              실제 전송 시 PDF 첨부 후 티켓을 해결 처리하고, Zendesk 점검 자동화 필드를 체크합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="mx-5 grid grid-cols-2 gap-2 rounded-md border bg-muted/30 p-3 text-xs sm:grid-cols-4">
            <ConfirmItem label="발송 모드" value={batchSendMode === "dry-run" ? "테스트 전송" : "실제 전송"} />
            <ConfirmItem label="발송 건수" value={`${batchReadyForSend.length}건`} />
            <ConfirmItem label="PDF 첨부" value="항목별 1개" />
            <ConfirmItem label="발송 후 처리" value="자동 해결 · 점검 자동화 체크" />
          </div>
          <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain px-5 pb-2">
            {batchReadyForSend.map((item, index) => {
              const requester = item.mapping?.requesterName || item.mapping?.requesterEmail || "담당자";
              const mailBody = renderMailBodyTemplate(userPreferences.mailBodyTemplate, requester);
              return (
                <details className="rounded-md border bg-card" key={item.id}>
                  <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                    {index + 1}. {item.result?.companyName || item.serial} · {item.mapping?.requesterName || "이름 없음"} (
                    {item.mapping?.requesterEmail || "이메일 없음"})
                  </summary>
                  <div className="space-y-3 border-t px-4 py-3 text-xs">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <ConfirmItem label="시리얼" value={item.result?.serial || item.serial} />
                      <ConfirmItem label="점검자" value={normalizeActiveEngineerName(item.mapping?.defaultEngineerName ?? "") || engineerName || "-"} />
                      <ConfirmItem label="제목" value={buildMailSubject(item.result?.companyName || "")} wide />
                      <ConfirmItem label="PDF 첨부" value={item.document?.pdf?.fileName || "PDF 없음"} wide />
                    </div>
                    <div>
                      <p className="mb-1 font-medium text-muted-foreground">메일 본문</p>
                      <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/20 p-3 font-sans leading-5 text-foreground">
                        {mailBody}
                      </pre>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
          <DialogFooter className="mx-0 mb-0 rounded-none px-5">
            <Button variant="outline" onClick={() => setIsBatchConfirmOpen(false)} type="button">
              닫기
            </Button>
            <Button disabled={Boolean(busyLabel) || batchReadyForSend.length === 0} onClick={() => void sendBatchZendesk()} type="button">
              확인 후 {batchSendMode === "dry-run" ? "테스트 전송" : "실제 전송"}
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

function readBrowserValue(key: string) {
  try { return typeof window === "undefined" ? null : window.localStorage.getItem(key); }
  catch { return null; }
}

function writeBrowserValue(key: string, value: string) {
  try { if (typeof window !== "undefined") window.localStorage.setItem(key, value); }
  catch { /* Server-backed preferences remain usable when browser storage is restricted. */ }
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
  const raw = readBrowserValue(userPreferencesStorageKey(email));
  if (!raw) {
    return defaultUserPreferences;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    return {
      defaultEngineerName: normalizeActiveEngineerName(typeof parsed.defaultEngineerName === "string" ? parsed.defaultEngineerName : ""),
      defaultServerModel: typeof parsed.defaultServerModel === "string" ? parsed.defaultServerModel : "auto",
      defaultIptablesStatus: ["auto", "Y", "N"].includes(String(parsed.defaultIptablesStatus))
        ? (parsed.defaultIptablesStatus as UserPreferences["defaultIptablesStatus"])
        : "auto",
      defaultAgentStatus: ["auto", "Y", "N"].includes(String(parsed.defaultAgentStatus))
        ? (parsed.defaultAgentStatus as UserPreferences["defaultAgentStatus"])
        : "auto",
      defaultSendMode: parsed.defaultSendMode === "real" ? "real" : "dry-run",
      defaultAutoSolved: parsed.defaultAutoSolved === true,
      mailBodyTemplate: typeof parsed.mailBodyTemplate === "string" ? parsed.mailBodyTemplate : "",
    };
  } catch {
    return defaultUserPreferences;
  }
}

function writeUserPreferences(email: string | null, preferences: UserPreferences) {
  if (typeof window === "undefined") {
    return;
  }
  writeBrowserValue(userPreferencesStorageKey(email), JSON.stringify(preferences));
}

function userPreferencesStorageKey(email: string | null) {
  return `check-server:user-preferences:${(email ?? "anonymous").toLowerCase()}`;
}

function parseBatchSerials(value: string) {
  const seen = new Set<string>();
  const serials: string[] = [];
  for (const part of value.split(/[\s,;]+/)) {
    const raw = part.trim();
    if (!raw) {
      continue;
    }
    const digits = raw.replace(/^LO/i, "").replace(/\D/g, "");
    const serial = digits ? `LO${digits}` : raw.toUpperCase();
    const key = normalizeSerialForCompare(serial);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    serials.push(serial);
  }
  return serials;
}

function serialInputToRows(value: string) {
  if (!value.trim()) {
    return [""];
  }
  const rows = value.split(/\r?\n/).map((row) => row.trim().replace(/^LO/i, "").replace(/\D/g, ""));
  return rows.length > 0 ? rows : [""];
}

function rowsToSerialInput(rows: string[]) {
  return rows.map((row) => row.replace(/\D/g, "")).join("\n");
}

function normalizeMappingForm(form: Omit<CustomerMailMapping, "id">): Omit<CustomerMailMapping, "id"> {
  return {
    companyName: form.companyName.trim(),
    serial: form.serial.trim(),
    zendeskOrgId: form.zendeskOrgId.trim(),
    requesterName: form.requesterName.trim(),
    requesterEmail: form.requesterEmail.trim(),
    ccEmails: form.ccEmails.trim(),
    defaultEngineerName: normalizeActiveEngineerName(form.defaultEngineerName),
    memo: form.memo.trim(),
  };
}

function batchMappingsStorageKey(email: string | null) {
  return `check-server:batch-mail-mappings:${(email ?? "anonymous").toLowerCase()}`;
}

function readBatchMappings(email: string | null): CustomerMailMapping[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = readBrowserValue(batchMappingsStorageKey(email));
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CustomerMailMapping>[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: typeof item.id === "string" && item.id ? item.id : crypto.randomUUID(),
        companyName: typeof item.companyName === "string" ? item.companyName : "",
        serial: typeof item.serial === "string" ? item.serial : "",
        zendeskOrgId: typeof item.zendeskOrgId === "string" ? item.zendeskOrgId : "",
        requesterName: typeof item.requesterName === "string" ? item.requesterName : "",
        requesterEmail: typeof item.requesterEmail === "string" ? item.requesterEmail : "",
        ccEmails: typeof item.ccEmails === "string" ? item.ccEmails : "",
        defaultEngineerName: normalizeActiveEngineerName(typeof item.defaultEngineerName === "string" ? item.defaultEngineerName : ""),
        memo: typeof item.memo === "string" ? item.memo : "",
      }))
      .filter((item) => item.zendeskOrgId && item.requesterEmail);
  } catch {
    return [];
  }
}

function mergeCustomerMappings(
  primary: CustomerMailMapping[],
  secondary: CustomerMailMapping[],
): CustomerMailMapping[] {
  const merged: CustomerMailMapping[] = [];
  const seen = new Set<string>();

  for (const mapping of [...primary, ...secondary]) {
    const key = customerMappingStorageIdentity(mapping);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push({ ...mapping, defaultEngineerName: normalizeActiveEngineerName(mapping.defaultEngineerName) });
  }

  return merged;
}

function customerMappingStorageIdentity(mapping: CustomerMailMapping) {
  const serial = normalizeSerialForCompare(mapping.serial);
  if (serial) {
    return `serial:${serial}`;
  }

  const company = mapping.companyName.trim().toLowerCase();
  if (company) {
    return `company:${company}`;
  }

  return "";
}

function writeBatchMappings(email: string | null, mappings: CustomerMailMapping[]) {
  if (typeof window === "undefined") {
    return;
  }
  writeBrowserValue(batchMappingsStorageKey(email), JSON.stringify(mappings));
}

function findBatchMapping(mappings: CustomerMailMapping[], serial: string, companyName: string) {
  const normalizedSerial = normalizeSerialForCompare(serial);
  const normalizedCompany = companyName.trim().toLowerCase();
  return (
    mappings.find((mapping) => mapping.serial && normalizeSerialForCompare(mapping.serial) === normalizedSerial) ??
    mappings.find((mapping) => mapping.companyName && mapping.companyName.trim().toLowerCase() === normalizedCompany) ??
    null
  );
}

function manualMappingIdentity(mapping: CustomerMailMapping) {
  return [
    mapping.companyName.trim().toLowerCase(),
    mapping.zendeskOrgId.trim(),
    mapping.requesterName.trim().toLowerCase(),
    mapping.requesterEmail.trim().toLowerCase(),
  ].join("|");
}

function uniqueManualMappingOptions(mappings: CustomerMailMapping[]) {
  const seen = new Set<string>();
  return mappings.filter((mapping) => {
    const key = manualMappingIdentity(mapping);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function formatManualMappingLabel(mapping: CustomerMailMapping) {
  const company = mapping.companyName || mapping.serial || "이름 없음";
  const requester = mapping.requesterEmail || mapping.requesterName;
  return requester ? `${company} · ${requester}` : company;
}

function selectedManualMappingOptionId(options: CustomerMailMapping[], selected?: CustomerMailMapping | null) {
  if (!selected) {
    return "__none";
  }
  return options.find((option) => manualMappingIdentity(option) === manualMappingIdentity(selected))?.id ?? "__none";
}

function filterCustomerMappings(mappings: CustomerMailMapping[], query: string) {
  const trimmed = query.trim();
  if (!trimmed) {
    return mappings;
  }

  const normalizedText = normalizeSearchText(trimmed);
  const normalizedSerial = normalizeSerialForCompare(trimmed);

  return mappings.filter((mapping) => {
    const serial = normalizeSerialForCompare(mapping.serial);
    if (normalizedSerial && serial.includes(normalizedSerial)) {
      return true;
    }

    return [
      mapping.companyName,
      mapping.serial,
      mapping.requesterName,
      mapping.requesterEmail,
    ].some((value) => normalizeSearchText(value).includes(normalizedText));
  });
}

function upsertSerialBatchMapping(
  mappings: CustomerMailMapping[],
  result: CheckResult,
  mapping: CustomerMailMapping,
) {
  const serial = result.serial.trim();
  const companyName = result.companyName.trim() || mapping.companyName;
  if (!serial) {
    return mappings;
  }

  const normalizedSerial = normalizeSerialForCompare(serial);
  const learnedMapping: CustomerMailMapping = {
    ...mapping,
    id: mapping.id || crypto.randomUUID(),
    companyName,
    serial,
  };

  const filtered = mappings.filter((current) => normalizeSerialForCompare(current.serial) !== normalizedSerial);
  return [learnedMapping, ...filtered];
}

function buildBatchIdempotencyKey({
  userId,
  item,
  mode,
}: {
  userId: string;
  item: BatchItem;
  mode: ZendeskSendMode;
}) {
  const parts = [
    userId,
    mode,
    item.document?.id ?? "",
    normalizeSerialForCompare(item.result?.serial || item.serial),
    item.mapping?.zendeskOrgId ?? "",
    item.mapping?.requesterEmail.toLowerCase() ?? "",
  ];
  const digest = hashString(parts.join("|"));
  const serial = normalizeSerialForCompare(item.result?.serial || item.serial) || "serial";
  const documentPart = (item.document?.id ?? "document").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
  return `batch:${mode}:${serial}:${documentPart}:${digest}`;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isBatchNormalResult(result: CheckResult) {
  return getBatchReviewReasons(result).length === 0;
}

function isBatchAutoSelectableResult(result: CheckResult) {
  return getBatchReviewReasons(result, { ignoreAgent: true, ignoreDiskUsage: true }).length === 0;
}

function getBatchReviewReasons(result: CheckResult, options: { ignoreAgent?: boolean; ignoreDiskUsage?: boolean } = {}) {
  return getBatchCheckReviewReasons(result, options);
}

function formatBatchStatus(status: BatchItem["status"]) {
  if (status === "queued") {
    return "대기";
  }
  if (status === "checking") {
    return "조회 중";
  }
  if (status === "checked") {
    return "조회 완료";
  }
  if (status === "documented") {
    return "PDF 생성";
  }
  if (status === "sending") {
    return "발송 중";
  }
  if (status === "sent") {
    return "발송 완료";
  }
  return "실패";
}

function resolveSafeSendMode(mode: ZendeskSendMode, canRealSend: boolean): ZendeskSendMode {
  return mode === "real" && !canRealSend ? "dry-run" : mode;
}

function formatSendModeLabel(mode: ZendeskSendMode) {
  return mode === "real" ? "실제 전송" : "테스트 전송";
}

function normalizeSerialForCompare(value: unknown) {
  return String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function normalizeSearchText(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
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
    "금일 정기점검 자동화를 통해 진행된 오피스키퍼 정기점검 확인서 전달드립니다.",
    "확인 후 서명하여 회신 부탁드립니다.",
    "",
    "",
    "감사합니다.",
    "",
  ].join("\n");
}

function renderMailBodyTemplate(template: string, requesterName: string) {
  const trimmedTemplate = template.trim();
  if (!trimmedTemplate) {
    return buildMailBody(requesterName);
  }
  const name = requesterName.trim() || "담당자";
  return trimmedTemplate
    .replaceAll("{{requesterName}}", name)
    .replaceAll("{requesterName}", name)
    .replaceAll("{{담당자명}}", name)
    .replaceAll("{담당자명}", name);
}

function replaceMailBodyRequester(body: string, previousRequesterName: string, nextRequesterName: string) {
  const previousName = previousRequesterName.trim();
  const nextName = nextRequesterName.trim() || "담당자";
  const placeholders = ["{{requesterName}}", "{requesterName}", "{{담당자명}}", "{담당자명}"];
  let updated = body;

  for (const placeholder of placeholders) {
    updated = updated.replaceAll(placeholder, nextName);
  }

  if (previousName && updated.includes(previousName)) {
    return updated.replace(previousName, nextName);
  }

  const genericGreetings = ["안녕하세요. 담당자 담당님", "담당자 담당님"];
  for (const greeting of genericGreetings) {
    if (updated.includes(greeting)) {
      return updated.replace(greeting, greeting.replace("담당자", nextName));
    }
  }

  return updated;
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
  onPreview,
}: {
  label: string;
  fileName: string;
  size: number;
  onDownload: () => void;
  onPreview?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{fileName}</p>
        <p className="mt-1 text-xs text-muted-foreground">{label} · {formatBytes(size)}</p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        {onPreview ? (
          <Button variant="secondary" size="sm" onClick={onPreview} type="button">
            미리보기
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={onDownload} type="button">
          다운로드
        </Button>
      </div>
    </div>
  );
}


function BatchWorkflowPanel({
  isActive,
  serialInput,
  onSerialInputChange,
  items,
  mappings,
  mappingForm,
  orgCandidates,
  userCandidates,
  busy,
  readyForDocumentsCount,
  readyForSendCount,
  failedCount,
  progress,
  sendMode,
  canRealSend,
  defaultSendModeLabel,
  onCheck,
  onToggle,
  onApplyMapping,
  onSelectNormal,
  onSelectMapped,
  onSelectFailed,
  onDeleteItem,
  onDeleteSelected,
  onGenerateDocuments,
  documentOpinion,
  onDocumentOpinionChange,
  onSendModeChange,
  onSend,
  onMappingFormChange,
  onSaveMapping,
  onDeleteMapping,
  onFillFromCurrent,
  onSearchMappingOrganizations,
  onSelectMappingOrganization,
  onSelectMappingRequester,
  onPreviewPdf,
}: {
  isActive: boolean;
  serialInput: string;
  onSerialInputChange: (value: string) => void;
  items: BatchItem[];
  mappings: CustomerMailMapping[];
  mappingForm: Omit<CustomerMailMapping, "id">;
  orgCandidates: Organization[];
  userCandidates: ZendeskUser[];
  busy: boolean;
  readyForDocumentsCount: number;
  readyForSendCount: number;
  failedCount: number;
  progress: BatchProgress | null;
  sendMode: ZendeskSendMode;
  canRealSend: boolean;
  defaultSendModeLabel: string;
  onCheck: () => void;
  onToggle: (id: string, selected: boolean) => void;
  onApplyMapping: (id: string, mappingId: string) => void;
  onSelectNormal: () => void;
  onSelectMapped: () => void;
  onSelectFailed: () => void;
  onDeleteItem: (id: string) => void;
  onDeleteSelected: () => void;
  onGenerateDocuments: () => void;
  documentOpinion: string;
  onDocumentOpinionChange: (value: string) => void;
  onSendModeChange: (value: string) => void;
  onSend: () => void;
  onMappingFormChange: (field: keyof Omit<CustomerMailMapping, "id">, value: string) => void;
  onSaveMapping: () => void;
  onDeleteMapping: (id: string) => void;
  onFillFromCurrent: () => void;
  onSearchMappingOrganizations: () => void;
  onSelectMappingOrganization: (org: Organization) => void;
  onSelectMappingRequester: (user: ZendeskUser) => void;
  onPreviewPdf: (url: string) => void;
}) {
  const selectedCount = items.filter((item) => item.selected).length;
  const checkedCount = items.filter((item) => item.result).length;
  const normalCount = items.filter((item) => item.normal).length;
  const manualMappingOptions = uniqueManualMappingOptions(mappings);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [mappingSearchQuery, setMappingSearchQuery] = useState("");
  const detailItem = items.find((item) => item.id === detailItemId) ?? null;
  const serialRows = serialInputToRows(serialInput);
  const serialInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const pendingSerialFocusIndex = useRef<number | null>(null);

  useEffect(() => {
    const index = pendingSerialFocusIndex.current;
    if (index === null || index >= serialRows.length) {
      return;
    }
    pendingSerialFocusIndex.current = null;
    serialInputRefs.current[index]?.focus();
  }, [serialRows.length]);

  const filteredMappings = useMemo(
    () => filterCustomerMappings(mappings, mappingSearchQuery),
    [mappings, mappingSearchQuery],
  );
  const hasMappingSearch = mappingSearchQuery.trim().length > 0;
  const updateSerialRow = (index: number, value: string) => {
    const nextRows = [...serialRows];
    nextRows[index] = value.replace(/\D/g, "");
    onSerialInputChange(rowsToSerialInput(nextRows));
  };
  const removeSerialRow = (index: number) => {
    const nextRows = serialRows.filter((_, rowIndex) => rowIndex !== index);
    onSerialInputChange(rowsToSerialInput(nextRows.length > 0 ? nextRows : [""]));
  };
  const addSerialRow = () => {
    pendingSerialFocusIndex.current = serialRows.length;
    onSerialInputChange(rowsToSerialInput([...serialRows, ""]));
  };

  const [mappingOpen,setMappingOpen]=useState(false);
  const [rowQuery,setRowQuery]=useState("");
  const [rowFilter,setRowFilter]=useState("all");
  const [selectedOnly,setSelectedOnly]=useState(false);
  const rowTrigger=useRef<HTMLElement|null>(null);
  const visibleItems=items.filter(item=>{
    const matches=[item.serial,item.result?.companyName,item.mapping?.requesterEmail,item.mapping?.requesterName].join(" ").toLowerCase().includes(rowQuery.trim().toLowerCase());
    const stateMatches=rowFilter==="all" || (rowFilter==="review"&&item.result&&!item.normal) || (rowFilter==="unmapped"&&!item.mapping) || (rowFilter==="pdf"&&item.result&&!item.document?.pdf) || (rowFilter==="failed"&&item.status==="failed") || (rowFilter==="sent"&&item.status==="sent");
    return matches&&stateMatches&&(!selectedOnly||item.selected);
  });
  const hiddenSelected=selectedCount-visibleItems.filter(item=>item.selected).length;
  const detailOpen=mappingOpen||Boolean(detailItem);
  return (
    <section className="batch-workspace">
      <ol className="batch-steps" aria-label="일괄 작업 단계">
        {[["조회",`${checkedCount}/${items.length}`],["검토·매핑",`${items.filter(item=>item.mapping).length}건`],["문서",`${items.filter(item=>item.document?.pdf).length}건`],["발송",`${items.filter(item=>item.status==="sent").length}건`]].map(([label,count],index)=><li key={label}><span>{index+1}</span><strong>{label}</strong><small>{count}</small>{index<3&&<ChevronRight aria-hidden/>}</li>)}
      </ol>
      <details className="batch-composer" open={items.length===0?true:undefined}>
        <summary>시리얼 추가<span>여러 고객을 조회 목록에 추가합니다</span></summary>
        <form onSubmit={event=>{event.preventDefault();if(!busy)onCheck();}}>
          <div className="batch-serial-grid">{serialRows.map((row,index)=><div className="flex gap-2" key={index}>
            <label className="batch-serial-input"><span>LO</span><input aria-label={`시리얼 숫자 ${index+1}`} inputMode="numeric" placeholder="23011001" value={row} ref={element=>{serialInputRefs.current[index]=element;}} onChange={event=>updateSerialRow(index,event.target.value)} disabled={busy}/></label>
            <Button variant="ghost" type="button" size="icon" aria-label={`시리얼 입력 ${index+1} 삭제`} disabled={busy||serialRows.length===1} onClick={()=>removeSerialRow(index)}><X aria-hidden/></Button>
          </div>)}</div>
          <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy} onClick={addSerialRow}>+ 시리얼 추가</Button><Button type="submit" disabled={busy}><Search aria-hidden/>신규 항목 조회</Button></div>
        </form>
      </details>
      {progress&&<div role="status" className="batch-progress"><span>{progress.message}</span><span>{progress.current} / {progress.total}</span><progress max={progress.total||1} value={progress.current}/></div>}
      <div className={`batch-layout ${detailOpen?"has-detail":""}`}>
        <div className="min-w-0">
          <div className="batch-filterbar"><div className="relative min-w-[200px] flex-1"><Search aria-hidden className="absolute left-3 top-3 size-4 text-muted-foreground"/><Input aria-label="일괄 처리 목록 검색" className="pl-9" placeholder="고객사, 시리얼, 담당자 검색" value={rowQuery} onChange={event=>setRowQuery(event.target.value)}/></div>
            <select aria-label="일괄 처리 상태" className={selectClassName} value={rowFilter} onChange={event=>setRowFilter(event.target.value)}><option value="all">모든 상태</option><option value="review">검토 필요</option><option value="unmapped">매핑 없음</option><option value="pdf">PDF 미준비</option><option value="failed">실패</option><option value="sent">발송 완료</option></select>
            <Button variant="outline" onClick={event=>{rowTrigger.current=event.currentTarget;setMappingOpen(true);setDetailItemId(null);}}><SlidersHorizontal aria-hidden/>담당자 매핑</Button>
          </div>
          <div className="batch-list-meta"><span>표시 <strong>{visibleItems.length}</strong> / 전체 {items.length}건 · 정상 판정 {normalCount}건</span><label><input type="checkbox" checked={selectedOnly} onChange={event=>setSelectedOnly(event.target.checked)}/>선택됨만</label><Button variant="ghost" size="sm" disabled={busy} onClick={()=>visibleItems.filter(item=>item.result).forEach(item=>onToggle(item.id,true))}>현재 결과 선택</Button></div>
          <div className="batch-mobile-list">{visibleItems.map(item=><article key={item.id} className="batch-mobile-card" data-selected={item.selected||undefined}>
            <header><label className="flex min-w-0 items-start gap-3"><input type="checkbox" aria-label={`${item.serial} 선택`} checked={item.selected} disabled={busy||!item.result} onChange={event=>onToggle(item.id,event.target.checked)}/><span><strong>{item.result?.companyName||"조회 대기"}</strong><span className="block font-mono text-xs text-muted-foreground">{item.serial}</span></span></label><Button variant="ghost" size="icon" aria-label={`${item.serial} 상세 보기`} onClick={event=>{rowTrigger.current=event.currentTarget;setDetailItemId(item.id);setMappingOpen(false);}}><ChevronRight aria-hidden/></Button></header>
            <div className="batch-mobile-states"><span>점검<strong>{item.result?(item.normal?"정상":"검토 필요"):formatBatchStatus(item.status)}</strong></span><span>문서<strong>{item.document?.pdf?"PDF 준비":item.document?"DOCX만":"미생성"}</strong></span><span>발송<strong>{item.status==="sent"?"완료":item.status==="failed"?"확인 필요":"대기"}</strong></span></div>
            <p className="text-xs text-muted-foreground break-all">담당자 · {item.mapping?.requesterEmail||"매핑이 필요합니다"}</p>
          </article>)}{!visibleItems.length&&<div className="workspace-empty"><p>{items.length?"조건에 맞는 항목이 없습니다.":"시리얼을 추가해 점검을 시작하세요."}</p></div>}</div>
          <div className="batch-table-wrap"><table className="batch-table"><thead><tr><Th>선택</Th><Th>고객사 · 시리얼</Th><Th>점검</Th><Th>담당자 매핑</Th><Th>문서</Th><Th>발송</Th><Th>상세</Th></tr></thead><tbody>
            {visibleItems.map(item=><tr key={item.id} data-selected={item.selected||undefined} data-detail={detailItemId===item.id||undefined}>
              <Td><input type="checkbox" aria-label={`${item.serial} 선택`} checked={item.selected} disabled={busy||!item.result} onChange={event=>onToggle(item.id,event.target.checked)}/></Td>
              <Td><strong className="block font-medium">{item.result?.companyName||"조회 대기"}</strong><span className="font-mono text-xs text-muted-foreground">{item.serial}</span></Td>
              <Td><Badge variant={item.status==="failed"&&!item.result?"destructive":"outline"}>{item.result?(item.normal?"정상":"검토 필요"):formatBatchStatus(item.status)}</Badge></Td>
              <Td>{item.mapping?<><span className="block text-xs font-medium">{item.mapping.requesterName||"담당자"}</span><span className="block max-w-[175px] truncate text-xs text-muted-foreground" title={item.mapping.requesterEmail}>{item.mapping.requesterEmail}</span></>:<Badge variant="outline" className="text-amber-700 dark:text-amber-300">매핑 필요</Badge>}</Td>
              <Td><Badge variant={item.document&&!item.document.pdf?"destructive":"outline"}>{item.document?.pdf?"PDF 준비":item.document?"DOCX만 생성":"미생성"}</Badge></Td>
              <Td><span className={item.status==="sent"?"text-primary":"text-muted-foreground"}>{item.status==="sent"?(item.sendMode==="real"?"발송 완료":"테스트 완료"):item.status==="sending"?"발송 중":item.status==="failed"&&item.document?.pdf?"확인 필요":"대기"}</span></Td>
              <Td><Button variant="ghost" size="sm" aria-label={`${item.serial} 상세 보기`} onClick={event=>{rowTrigger.current=event.currentTarget;setDetailItemId(item.id);setMappingOpen(false);}}><ChevronRight aria-hidden/><span className="sr-only">상세</span></Button></Td>
            </tr>)}
            {!visibleItems.length&&<tr><Td colSpan={7}><div className="py-12 text-center text-muted-foreground">{items.length?"조건에 맞는 항목이 없습니다. 필터를 변경해 보세요.":"시리얼을 추가해 점검을 시작하세요."}</div></Td></tr>}
          </tbody></table></div>
          <details className="batch-selection-options"><summary>선택 도구<span>전체 목록 기준</span></summary><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busy||!items.length} onClick={onSelectNormal}>자동 선택 조건 충족</Button><Button variant="outline" size="sm" disabled={busy||!items.length} onClick={onSelectMapped}>매핑 완료 선택</Button><Button variant="outline" size="sm" disabled={busy||!failedCount} onClick={onSelectFailed}>실패 항목 선택 {failedCount}</Button></div></details>
          <details className="batch-selection-options"><summary>공통 점검 의견<span>선택 항목의 확인서에 반영</span></summary><Textarea aria-label="일괄 점검 의견" value={documentOpinion} onChange={event=>onDocumentOpinionChange(event.target.value)} placeholder="모든 선택 항목에 동일하게 적용할 의견"/></details>
        </div>
        <DetailDrawer open={isActive && detailOpen} onOpenChange={open=>{if(!open){setMappingOpen(false);setDetailItemId(null);}}} title={mappingOpen?"담당자 매핑":"일괄 작업 상세"} returnFocus={()=>rowTrigger.current}>
          {mappingOpen?<div className="space-y-5 batch-mapping-panel">
        <Panel title="고객사 담당자 매핑">
          <div className="space-y-3">
            <Button disabled={busy} onClick={onFillFromCurrent} type="button" variant="secondary" className="w-full">
              현재 점검/메일 값 가져오기
            </Button>
            <Field label="고객사명">
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!busy) {
                    onSearchMappingOrganizations();
                  }
                }}
              >
                <Input value={mappingForm.companyName} onChange={(event) => onMappingFormChange("companyName", event.target.value)} />
                <Button disabled={busy} type="submit" variant="outline">
                  검색
                </Button>
              </form>
            </Field>
            <Field label="Zendesk 조직">
              <Input readOnly value={mappingForm.zendeskOrgId ? `${mappingForm.companyName} (${mappingForm.zendeskOrgId})` : "조직을 검색해 선택하세요"} />
            </Field>
            {orgCandidates.length > 0 ? (
              <div className="max-h-[180px] space-y-2 overflow-y-auto rounded-md border bg-muted/20 p-2">
                {orgCandidates.map((org) => (
                  <button
                    className={`w-full rounded-md border p-2 text-left text-sm transition hover:border-primary ${
                      mappingForm.zendeskOrgId === String(org.id) ? "border-primary bg-primary/10" : "border-border bg-card"
                    }`}
                    key={String(org.id)}
                    onClick={() => onSelectMappingOrganization(org)}
                    type="button"
                  >
                    <span className="block font-medium">{org.name ?? "(이름 없음)"}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">ID {String(org.id)}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <Field label="요청자 이름">
              <Input value={mappingForm.requesterName} onChange={(event) => onMappingFormChange("requesterName", event.target.value)} />
            </Field>
            <Field label="요청자 이메일">
              <Input value={mappingForm.requesterEmail} onChange={(event) => onMappingFormChange("requesterEmail", event.target.value)} />
            </Field>
            {userCandidates.length > 0 ? (
              <div className="max-h-[180px] space-y-2 overflow-y-auto rounded-md border bg-muted/20 p-2">
                {userCandidates.map((user) => (
                  <button
                    className={`w-full rounded-md border p-2 text-left text-sm transition hover:border-primary ${
                      mappingForm.requesterEmail === (user.email ?? "") ? "border-primary bg-primary/10" : "border-border bg-card"
                    }`}
                    key={String(user.id)}
                    onClick={() => onSelectMappingRequester(user)}
                    type="button"
                  >
                    <span className="block font-medium">{user.name ?? user.email ?? "(이름 없음)"}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{user.email ?? "이메일 없음"}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <Button disabled={busy} onClick={onSaveMapping} type="button" className="w-full">
              매핑 저장
            </Button>
          </div>
        </Panel>

        <Panel title="저장된 매핑">
          {mappings.length === 0 ? (
            <p className="text-sm text-muted-foreground">저장된 고객사 담당자 매핑이 없습니다.</p>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    aria-label="저장된 매핑 검색"
                    placeholder="고객사명, 시리얼, 담당자명, 이메일 검색"
                    value={mappingSearchQuery}
                    onChange={(event) => setMappingSearchQuery(event.target.value)}
                  />
                  {hasMappingSearch ? (
                    <Button onClick={() => setMappingSearchQuery("")} type="button" variant="outline">
                      초기화
                    </Button>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {hasMappingSearch ? `검색 결과 ${filteredMappings.length} / ${mappings.length}건` : `전체 ${mappings.length}건`}
                </p>
              </div>

              {filteredMappings.length === 0 ? (
                <div className="rounded-md border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">검색 결과가 없습니다.</p>
                  <p className="mt-1">고객사명, 시리얼, 담당자명 또는 이메일을 다시 확인하세요.</p>
                </div>
              ) : (
                <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                  {filteredMappings.map((mapping) => (
                    <div key={mapping.id} className="rounded-md border bg-card p-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{mapping.companyName || mapping.serial}</p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {mapping.serial || "시리얼 없음"} · {mapping.requesterName || mapping.requesterEmail}
                          </p>
                          {mapping.requesterName && mapping.requesterEmail ? (
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">{mapping.requesterEmail}</p>
                          ) : null}
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => onDeleteMapping(mapping.id)} type="button">
                          삭제
                        </Button>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">조직 ID {mapping.zendeskOrgId}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Panel>
          </div>:detailItem&&<div className="space-y-5">
            <div><h3 className="text-lg font-semibold">{detailItem.result?.companyName||detailItem.serial}</h3><p className="font-mono text-xs text-muted-foreground">{detailItem.serial}</p></div>
            {detailItem.error&&<div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{detailItem.error}</div>}
            <div className="space-y-3"><InfoRow label="작업 상태" value={formatBatchStatus(detailItem.status)}/><Field label="담당자 매핑"><select aria-label={`${detailItem.serial} 매핑 수동 선택`} className={selectClassName} disabled={busy} value={selectedManualMappingOptionId(manualMappingOptions,detailItem.mapping)} onChange={event=>onApplyMapping(detailItem.id,event.target.value==="__none"?"":event.target.value)}><option value="__none">수동 연결 선택</option>{manualMappingOptions.map(mapping=><option value={mapping.id} key={mapping.id}>{formatManualMappingLabel(mapping)}</option>)}</select></Field>
            {detailItem.document?.pdf?<Button variant="outline" onClick={()=>onPreviewPdf(detailItem.document!.pdf!.downloadUrl)}><FileText aria-hidden/>PDF 미리보기</Button>:detailItem.document&&<p className="text-xs text-muted-foreground">DOCX는 생성되었습니다. 목록에서 선택 후 확인서를 재생성할 수 있습니다.</p>}
            {detailItem.sendTicketUrl&&<a className="text-primary underline" href={detailItem.sendTicketUrl} target="_blank" rel="noreferrer">Zendesk 티켓 #{detailItem.sendTicketId}</a>}</div>
            {detailItem.result&&<details><summary className="cursor-pointer py-3 font-medium">수집 결과 보기</summary><ResultSummary result={detailItem.result}/></details>}
            <Button variant="outline" disabled={busy} onClick={()=>onDeleteItem(detailItem.id)}>작업 목록에서 제거</Button><p className="text-xs text-muted-foreground">저장된 문서와 발송 이력은 유지됩니다.</p>
          </div>}
        </DetailDrawer>
      </div>
      {selectedCount>0&&<div className="batch-actionbar"><div><strong>선택 {selectedCount}건</strong><span>문서 생성 가능 {readyForDocumentsCount} · 발송 가능 {readyForSendCount}</span>{hiddenSelected>0&&<span className="text-amber-700 dark:text-amber-300">현재 필터에서 숨겨진 선택 {hiddenSelected}건 포함</span>}</div><div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" disabled={busy||!selectedCount} onClick={()=>items.filter(item=>item.selected).forEach(item=>onToggle(item.id,false))}>선택 해제</Button><Button variant="ghost" size="sm" disabled={busy||!selectedCount} onClick={onDeleteSelected}>목록에서 제거</Button>
        <Button variant="outline" disabled={busy||!readyForDocumentsCount} onClick={onGenerateDocuments}><FileText aria-hidden/>문서 생성 / PDF 재시도 {readyForDocumentsCount||""}</Button>
        <select aria-label="일괄 Zendesk 발송 모드" className={selectClassName} disabled={busy} value={sendMode} onChange={event=>onSendModeChange(event.target.value)}><option value="default">기본값 ({defaultSendModeLabel})</option><option value="dry-run">테스트 전송</option><option value="real" disabled={!canRealSend}>실제 전송</option></select>
        <Button disabled={busy||!readyForSendCount} onClick={onSend}><Send aria-hidden/>{sendMode==="real"?"발송 내용 확인":"테스트 내용 확인"} {readyForSendCount||""}</Button>
      </div></div>}
    </section>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th className="px-3 py-2 font-medium">{children}</th>;
}

function Td({ children, colSpan, className = "" }: { children: ReactNode; colSpan?: number; className?: string }) {
  return <td colSpan={colSpan} className={`px-3 py-2 align-middle ${className}`}>{children}</td>;
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
