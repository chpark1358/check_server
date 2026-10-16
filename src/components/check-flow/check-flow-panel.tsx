"use client";

import { FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, ChevronDown, Clock3, Cpu, HardDrive, KeyRound, Link2, Loader2, MemoryStick, Search, Settings2, type LucideIcon } from "lucide-react";
import type { PreviewApi } from "@/lib/preview/api";
import { clearCrmSession, readCrmPreferences, readCrmSession, writeCrmPreferences, writeCrmSession } from "@/lib/browser/crm-storage";
import { checkFieldIssue, isCheckFieldUnknown, readCheckBoolean, CHECK_FIELD_LABELS, type CheckFieldKey, type CheckResultQuality } from "@/lib/check-result-quality";
import { checkFieldIssueLabel, collectedNumberText, collectedServiceText, getUnknownCheckFields } from "@/lib/check-result-presentation";

export type CheckResult = {
  companyId: string;
  companyName: string;
  serial: string;
  softwareName: string;
  hardwareType: string;
  license: { total: number; used: number; unverified: number };
  versions: { docker: string; agentWin: string; agentMac: string };
  system: {
    osInfo: string;
    serverModel: string;
    cpuUsagePercent: number;
    memTotalGb: number;
    memUsagePercent: number;
    load1: number;
    load5: number;
    load15: number;
    checkTime: string;
    lastReboot: string;
  };
  disks: {
    root: { mount: string; size: string; used: string; usedPercent: number };
    home: { mount: string; size: string; used: string; usedPercent: number };
    storage: { mount: string; size: string; used: string; usedPercent: number };
  };
  flags: Record<string, boolean>;
  backup: { latest: string; sizeGb: number };
  warnings: string[];
  raw: Record<string, unknown>;
  quality?: CheckResultQuality;
};

type Session = {
  expiresAt: string;
  masked: string;
  username: string;
};

type ApiFailure = {
  ok: false;
  code?: string;
  message?: string;
  requestId?: string;
};

type Props = {
  userId: string;
  accessToken: string | null;
  onResult?: (result: CheckResult) => void;
  apiClient?: PreviewApi;
  preview?: boolean;
  showResult?: boolean;
  currentResult?: CheckResult | null;
};

const serviceKeys = [
  "agentStatus",
  "mailServerStatus",
  "webConnectionStatus",
  "httpdStatus",
  "mysqldStatus",
  "ntpSyncStatus",
  "iptablesStatus",
  "firewallStatus",
  "backupStatus",
] as const;

const serviceLabels: Record<string, { label: string; excluded?: boolean }> = {
  agent: { label: "에이전트 연결" },
  mail: { label: "메일 서버", excluded: true },
  web: { label: "웹 접속" },
  httpd: { label: "웹 서비스" },
  mysqld: { label: "DB 서비스" },
  ntp: { label: "시간 동기화" },
  iptables: { label: "방화벽 정책" },
  firewall: { label: "Firewalld" },
  backup: { label: "백업" },
};

class ClientApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const previewSolutionSession: Session = { username: "preview", masked: "가상 CRM 연결", expiresAt: "2099-01-01T00:00:00Z" };

export function CheckFlowPanel({ userId, accessToken, onResult, apiClient, preview = false, showResult = true, currentResult }: Props) {
  const [storedPreferences] = useState(() => preview ? { rememberUsername: false, username: "preview" } : readCrmPreferences(userId));
  const [username, setUsername] = useState(storedPreferences.username);
  const [rememberUsername, setRememberUsername] = useState(storedPreferences.rememberUsername);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [session, setSession] = useState<Session | null>(() => preview ? previewSolutionSession : readCrmSession(userId));
  const [serialDigits, setSerialDigits] = useState(preview ? "00001001" : "");
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => preview ? 0 : Date.now());
  const [connectionExpanded, setConnectionExpanded] = useState(() => !preview && !readCrmSession(userId));
  const [loadedResult, setLoadedResult] = useState<CheckResult | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const displayedResult = currentResult === undefined ? loadedResult : currentResult;

  useEffect(() => {
    if (preview) return;
    const id = setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      if (session && new Date(session.expiresAt).getTime() <= tick) {
        setSession(null);
        setConnectionExpanded(true);
        clearCrmSession(userId);
        setError("솔루션 로그인 시간이 만료되었습니다. 다시 로그인하세요.");
      }
    }, 1000);
    return () => clearInterval(id);
  }, [session, preview, userId]);

  const remainingSeconds = useMemo(() => {
    if (!session) return 0;
    if (preview) return 3600;
    return Math.max(0, Math.floor((new Date(session.expiresAt).getTime() - now) / 1000));
  }, [session, now, preview]);

  const isReadyToFetch = Boolean(session) && remainingSeconds > 0 && /^\d{4,}$/.test(serialDigits);
  const previewSerial = serialDigits ? `LO${serialDigits}` : "LO________";

  async function callApi<T>(path: string, init: RequestInit = {}) {
    if (apiClient) return await apiClient(path, init) as T & { ok: true };
    if (preview) throw new Error("가상 데이터 연결이 준비되지 않았습니다.");
    if (!accessToken) {
      throw new Error("앱 로그인 세션이 없습니다.");
    }
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${accessToken}`);
    headers.set("x-request-id", crypto.randomUUID());
    if (init.body && !(init.body instanceof FormData)) {
      headers.set("content-type", "application/json");
    }
    const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
    const data = (await response.json()) as ApiFailure | (T & { ok: true });
    if (data.ok !== true) {
      const failure = data as ApiFailure;
      throw new ClientApiError(failure.message || "요청 처리 중 오류가 발생했습니다.", failure.code ?? "REQUEST_FAILED", response.status);
    }
    return data;
  }

  async function runBusy(label: string, action: () => Promise<void>) {
    setBusyLabel(label);
    setError(null);
    try {
      await action();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "오류가 발생했습니다.");
    } finally {
      setBusyLabel(null);
    }
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview && (!username.trim() || !password)) {
      setError("아이디와 비밀번호를 입력하세요.");
      return;
    }
    await runBusy("솔루션 로그인 중", async () => {
      const data = await callApi<{
        expiresAt: string;
        masked: string;
        username: string;
      }>("/api/solution/login", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const nextSession = {
        expiresAt: data.expiresAt,
        masked: data.masked,
        username: data.username,
      };
      setSession(nextSession);
      setConnectionExpanded(false);
      if (!preview) writeCrmSession(userId, nextSession);
      const nextUsername = data.username || username.trim();
      setUsername(nextUsername);
      if (!preview && !writeCrmPreferences(userId, rememberUsername, nextUsername)) {
        setStorageNotice("브라우저 저장소를 사용할 수 없어 CRM 아이디 저장 설정을 유지할 수 없습니다.");
      }
      setPassword("");
    });
  }

  async function logout() {
    setSession(null);
    setConnectionExpanded(true);
    setError(null);
    if (!preview) clearCrmSession(userId);
    try {
      await callApi("/api/solution/logout", { method: "POST" });
    } catch {
      // 서버 로그아웃 실패는 비차단 — 클라 상태는 이미 정리됨
    }
  }

  async function fetchCheckup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) {
      setError("솔루션 계정 로그인이 필요합니다.");
      return;
    }
    if (!/^\d{4,}$/.test(serialDigits)) {
      setError("시리얼은 LO 뒤에 붙는 숫자 4자리 이상이어야 합니다.");
      return;
    }
    await runBusy("점검 데이터 불러오는 중", async () => {
      try {
        const data = await callApi<{ result: CheckResult }>("/api/solution/checkup", {
          method: "POST",
          body: JSON.stringify({ serial: previewSerial }),
        });
        setLoadedResult(data.result);
        setLastFetchedAt(new Date().toISOString());
        onResult?.(data.result);
      } catch (nextError) {
        if (
          nextError instanceof ClientApiError &&
          ["SOLUTION_TOKEN_EXPIRED", "SOLUTION_NOT_AUTHENTICATED", "SOLUTION_SESSION_MISMATCH"].includes(nextError.code)
        ) {
          setSession(null);
          setConnectionExpanded(true);
          if (!preview) clearCrmSession(userId);
        }
        throw nextError;
      }
    });
  }

  return (
    <div className="check-input-area space-y-3">
      <section className="overflow-hidden rounded-lg border bg-card" aria-label="CRM 연결">
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className={`inline-flex items-center gap-2 font-medium ${session ? "text-primary" : "text-muted-foreground"}`}>
              <Link2 className="size-4" aria-hidden="true" />
              {session ? preview ? "CRM 가상 연결" : "CRM 연결됨" : "CRM 연결 필요"}
            </span>
            {session ? <span className={`inline-flex items-center gap-1.5 border-l pl-4 tabular-nums ${remainingSeconds <= 60 ? "text-destructive" : "text-muted-foreground"}`}>
              <Clock3 className="size-4" aria-hidden="true" />
              {preview ? "프리뷰 세션" : `세션 ${formatRemaining(remainingSeconds)} 남음`}
            </span> : <span className="text-muted-foreground">점검 조회를 위해 CRM 계정을 연결하세요.</span>}
          </div>
          <div className="flex items-center gap-4">
            {lastFetchedAt ? <span className="hidden text-xs text-muted-foreground xl:inline">최근 조회 {formatCollectionTime(lastFetchedAt)}</span> : null}
            <Button variant="outline" size="sm" className="min-h-11 gap-2" type="button" onClick={() => setConnectionExpanded((value) => !value)} aria-expanded={connectionExpanded} aria-controls="crm-connection-settings">
              <Settings2 className="size-4" aria-hidden="true" /> 연결 설정
              <ChevronDown className={`size-3.5 transition-transform motion-reduce:transition-none ${connectionExpanded ? "rotate-180" : ""}`} aria-hidden="true" />
            </Button>
          </div>
        </div>
        {connectionExpanded ? <div id="crm-connection-settings" className="border-t bg-muted/20 px-4 py-4">
          {!session ? (
            <form className="flex flex-wrap items-end gap-3" onSubmit={login}>
              {preview ? <p className="self-center text-sm text-muted-foreground">가상 CRM입니다. 실제 계정이나 비밀번호는 필요하지 않습니다.</p> : <>
                <div className="min-w-44 flex-1 space-y-1.5">
                  <Label htmlFor="solution-username">CRM 아이디</Label>
                  <Input id="solution-username" className="h-11 bg-card" autoComplete="username" onChange={(event) => setUsername(event.target.value)} type="text" value={username} />
                </div>
                <div className="min-w-44 flex-1 space-y-1.5">
                  <Label htmlFor="solution-password">비밀번호</Label>
                  <Input id="solution-password" className="h-11 bg-card" autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
                </div>
              </>}
              <Button className="min-h-11 px-6" disabled={Boolean(busyLabel)} type="submit">{preview ? "가상 CRM 다시 연결" : "CRM 연결"}</Button>
            </form>
          ) : <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <span><span className="mr-2 text-muted-foreground">계정</span>{session.username}</span>
              <span><span className="mr-2 text-muted-foreground">연결 정보</span>{session.masked}</span>
            </div>
            <Button variant="outline" className="min-h-11" disabled={Boolean(busyLabel)} onClick={() => void logout()} type="button">{preview ? "가상 연결 해제" : "연결 해제"}</Button>
          </div>}
          {!preview ? <div className="mt-3 space-y-1.5">
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm" htmlFor="remember-crm-username">
              <input id="remember-crm-username" type="checkbox" className="size-4 accent-primary" checked={rememberUsername} onChange={(event) => {
                const checked = event.target.checked;
                setRememberUsername(checked);
                const saved = writeCrmPreferences(userId, checked, username);
                setStorageNotice(saved ? null : "브라우저 저장소를 사용할 수 없어 CRM 아이디 저장 설정을 유지할 수 없습니다.");
              }} />
              CRM 아이디 저장
            </label>
            <p className="text-xs text-muted-foreground">이 브라우저의 현재 앱 계정에 아이디만 저장합니다. 비밀번호는 저장하지 않습니다.</p>
            {storageNotice ? <p role="status" className="text-xs text-destructive">{storageNotice}</p> : null}
          </div> : null}
        </div> : null}
      </section>

      <section className="rounded-lg border bg-card px-4 py-3" aria-label="점검 데이터 조회">
        <form className="flex flex-wrap items-center gap-3" onSubmit={fetchCheckup}>
          <Label htmlFor="serial-digits" className="shrink-0 text-sm font-semibold">시리얼 번호</Label>
          <div className="relative min-w-44 flex-1 sm:max-w-sm">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-muted-foreground" aria-hidden="true">LO</span>
            <Input id="serial-digits" className="h-11 pl-9 font-mono" inputMode="numeric" onChange={(event) => setSerialDigits(event.target.value.replace(/\D/g, ""))} placeholder="00001001" value={serialDigits} aria-describedby="serial-query-hint" />
          </div>
          <Button className="min-h-11 gap-2 px-6" disabled={!isReadyToFetch || Boolean(busyLabel)} type="submit">
            {busyLabel === "점검 데이터 불러오는 중" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
            {busyLabel === "점검 데이터 불러오는 중" ? "조회 중" : "점검 조회"}
          </Button>
          <p id="serial-query-hint" className="basis-full text-xs leading-relaxed text-muted-foreground xl:basis-auto">LO 뒤의 숫자 4자리 이상을 입력하세요.<br className="hidden xl:block" /> Enter를 누르면 점검 데이터를 조회합니다.</p>
        </form>
        {displayedResult ? <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2.5 text-xs">
          <span className="text-muted-foreground">현재 결과 <strong className="font-medium text-foreground">{displayedResult.companyName || "고객명 없음"} · {displayedResult.serial}</strong></span>
          {serialDigits && previewSerial !== displayedResult.serial ? <span className="text-[var(--warning)]">입력 중 {previewSerial} · 조회하면 결과가 바뀝니다.</span> : null}
        </div> : null}
        {busyLabel ? <p role="status" className="mt-3 text-xs text-muted-foreground">{busyLabel}… {displayedResult ? "기존 결과는 유지됩니다." : ""}</p> : null}
        {error ? <p role="alert" className="mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p> : null}
      </section>
      {showResult && displayedResult ? <ResultSummary result={displayedResult} /> : null}
    </div>
  );
}

export function ResultSummary({ result, documentFlags }: { result: CheckResult; documentFlags?: Partial<Record<string, boolean>> }) {
  const [serviceFilter, setServiceFilter] = useState<"all" | "attention">("all");
  const rawRows = buildRawRows(result);
  const logData = parseRawLogData(result.raw.logData);
  const reportFlags = Object.entries(result.flags).filter(([key]) => key !== "mail");
  const failedServices = reportFlags.filter(([key, ok]) => !isCheckFieldUnknown(result, `flags.${key}` as CheckFieldKey) && !ok);
  const unknownServices = reportFlags.filter(([key]) => isCheckFieldUnknown(result, `flags.${key}` as CheckFieldKey));
  const unknownFields = getUnknownCheckFields(result);
  const disks = [result.disks.root, result.disks.home, result.disks.storage];
  const diskNames = ["root", "home", "storage"] as const;
  const collectedDisks = disks.filter((_, index) => !isCheckFieldUnknown(result, `disks.${diskNames[index]}.usedPercent`));
  const maxDiskUsage = collectedDisks.length ? Math.max(...collectedDisks.map((disk) => disk.usedPercent)) : null;
  const severity = getResultSeverity(result, failedServices.length, maxDiskUsage, unknownFields.length);
  const licenseComplete = !isCheckFieldUnknown(result, "license.total") && !isCheckFieldUnknown(result, "license.used");
  const licenseUsagePercent = licenseComplete && result.license.total > 0 ? Math.round((result.license.used / result.license.total) * 100) : null;
  const monthlyReportRaw = pickReportStatusValue(result.raw.monthlyReportStatus, logData.monthlyReportStatus, logData.checkMonthlyReportExist);
  const monthlyReportStatus = formatReportStatus(monthlyReportRaw);
  const monthlyReportIssue = result.quality ? checkFieldIssueLabel(result, "monthlyReport") : null;
  const orgSyncStatus = (result.quality ? checkFieldIssueLabel(result, "hrSync") : null) ?? formatRawValue(result.raw.orgSyncStatus ?? logData.checkOrgSync);
  const collectionTime = result.system.checkTime || formatRawValue(result.raw.dateOfEntry ?? logData.time);
  const collectionTimeLabel = formatCollectionTime(collectionTime);
  const visibleServices = Object.entries(result.flags).filter(([key, ok]) => serviceFilter === "all" || (key !== "mail" && (!ok || isCheckFieldUnknown(result, `flags.${key}` as CheckFieldKey))));
  const resourceConcerns = [
    !isCheckFieldUnknown(result, "system.cpuUsagePercent") && result.system.cpuUsagePercent >= 75 ? `CPU ${result.system.cpuUsagePercent}%` : null,
    !isCheckFieldUnknown(result, "system.memUsagePercent") && result.system.memUsagePercent >= 75 ? `메모리 ${result.system.memUsagePercent}%` : null,
    maxDiskUsage !== null && maxDiskUsage >= 80 ? `디스크 최대 ${maxDiskUsage}%` : null,
    !isCheckFieldUnknown(result, "license.unverified") && result.license.unverified > 0 ? `미인증 라이선스 ${result.license.unverified}` : null,
  ].filter(Boolean);
  const hasConcerns = failedServices.length > 0 || result.warnings.length > 0 || resourceConcerns.length > 0 || unknownFields.length > 0;

  return (
    <section className="check-result min-w-0 overflow-hidden rounded-lg border bg-card" aria-label="점검 수집 결과">
      <header className="border-b px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">{result.companyName || "고객명 없음"}</h2>
              {result.companyId ? <Badge variant="secondary" className="font-normal">고객 코드 {result.companyId}</Badge> : null}
            </div>
            <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs leading-relaxed">
              <div className="flex gap-2"><dt className="text-muted-foreground">시리얼</dt><dd className="font-mono text-foreground">{result.serial || "-"}</dd></div>
              <div className="flex gap-2"><dt className="text-muted-foreground">제품</dt><dd>{result.softwareName || "-"}</dd></div>
              <div className="flex gap-2"><dt className="text-muted-foreground">운영체제</dt><dd>{checkFieldIssueLabel(result, "system.osInfo") ?? result.system.osInfo}</dd></div>
            </dl>
          </div>
          <div className="flex flex-col items-start gap-1.5 sm:items-end">
            <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${isCheckFieldUnknown(result, "system.checkTime") ? "bg-muted text-muted-foreground" : "bg-primary/8 text-primary"}`}><Clock3 className="size-3.5" aria-hidden="true" />{checkFieldIssueLabel(result, "system.checkTime") ? `수집 시각 ${checkFieldIssueLabel(result, "system.checkTime")}` : collectionTimeLabel ? `수집 ${collectionTimeLabel} KST` : "수집 시각 확인 필요"}</span>
            <span className="text-xs text-muted-foreground">조회 완료 · 수집된 결과 기준</span>
          </div>
        </div>
      </header>
      <div className="space-y-5 p-5">
        <div className={`flex items-start gap-3 rounded-md border px-3.5 py-3 ${hasConcerns ? "border-[color:var(--warning)]/25 bg-[color:var(--warning)]/5" : "border-border bg-muted/30"}`}>
          {hasConcerns ? <AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <strong className="font-medium">{hasConcerns ? "확인할 항목이 있습니다" : "확인이 필요한 항목이 없습니다"}</strong>
              <Badge variant={severity.variant} className={severity.className}>{severity.label}</Badge>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hasConcerns ? [failedServices.length ? `서비스 이상 ${failedServices.length}건` : null, ...resourceConcerns, unknownFields.length ? `미수집·확인불가 ${unknownFields.length}항목` : null, result.warnings.length ? `수집 경고 ${result.warnings.length}건` : null].filter(Boolean).join(" · ") : "점검 대상 서비스와 주요 리소스를 확인한 뒤 확인서를 생성하세요."}</p>
            {unknownFields.length ? <details className="mt-2 text-xs leading-relaxed"><summary className="cursor-pointer font-medium">수집 확인이 필요한 항목</summary><p className="mt-1 text-muted-foreground">값이 없거나 해석할 수 없어 정상·이상을 판단하지 않았습니다. 수집 원본을 확인하세요.</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{unknownFields.map(key => <li key={key}>{CHECK_FIELD_LABELS[key]} · {checkFieldIssueLabel(result, key)}</li>)}</ul></details> : null}
            {result.warnings.length ? <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-foreground">{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
          </div>
        </div>

        <section aria-labelledby="resource-metrics-title">
          <h3 id="resource-metrics-title" className="mb-3 text-sm font-semibold">시스템 주요 지표</h3>
          <div className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
            <ResourceMetric icon={Cpu} label="CPU 사용률" value={collectedNumberText(result, "system.cpuUsagePercent", result.system.cpuUsagePercent, "%")} percent={isCheckFieldUnknown(result, "system.cpuUsagePercent") ? null : result.system.cpuUsagePercent} tone={usageTone(result.system.cpuUsagePercent)}>
              <p>Load {collectedNumberText(result, "system.load1", result.system.load1, "", 2)} / {collectedNumberText(result, "system.load5", result.system.load5, "", 2)} / {collectedNumberText(result, "system.load15", result.system.load15, "", 2)}</p>
              <p className="mt-0.5 text-muted-foreground/80">1분 / 5분 / 15분</p>
            </ResourceMetric>
            <ResourceMetric icon={MemoryStick} label="메모리 사용률" value={collectedNumberText(result, "system.memUsagePercent", result.system.memUsagePercent, "%")} percent={isCheckFieldUnknown(result, "system.memUsagePercent") ? null : result.system.memUsagePercent} tone={usageTone(result.system.memUsagePercent)}>
              <p>전체 {collectedNumberText(result, "system.memTotalGb", result.system.memTotalGb, " GB")}</p>
            </ResourceMetric>
            <ResourceMetric icon={HardDrive} label={collectedDisks.length < disks.length ? "수집된 디스크 최대 사용률" : "디스크 최대 사용률"} value={maxDiskUsage === null ? "미수집·확인불가" : `${maxDiskUsage}%`} percent={maxDiskUsage} tone={usageTone(maxDiskUsage ?? 0)}>
              {disks.map((disk, index) => <p key={index} className="flex justify-between gap-2"><span className="font-mono">{disk.mount || ["/", "/home", "/storage"][index]}</span><span className="tabular-nums">{collectedNumberText(result, `disks.${diskNames[index]}.usedPercent`, disk.usedPercent, "%")}</span></p>)}
            </ResourceMetric>
            <ResourceMetric icon={KeyRound} label="라이선스 사용" value={`${collectedNumberText(result, "license.used", result.license.used)} / ${collectedNumberText(result, "license.total", result.license.total)}`} percent={licenseUsagePercent} tone={result.license.unverified > 0 ? "warning" : "neutral"}>
              <p>사용률 {licenseUsagePercent === null ? licenseComplete ? "산정 불가" : "미수집·확인불가" : `${licenseUsagePercent}%`} · 미인증 {collectedNumberText(result, "license.unverified", result.license.unverified)}</p>
            </ResourceMetric>
          </div>
        </section>

        <section aria-labelledby="service-result-title">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 id="service-result-title" className="text-sm font-semibold">서비스 점검 결과</h3>
            <div className="inline-flex rounded-md border bg-muted/30 p-0.5" aria-label="서비스 상태 필터">
              <button type="button" className={`min-h-11 rounded px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${serviceFilter === "all" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground"}`} aria-pressed={serviceFilter === "all"} onClick={() => setServiceFilter("all")}>전체 {Object.keys(result.flags).length}</button>
              <button type="button" className={`min-h-11 rounded px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${serviceFilter === "attention" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground"}`} aria-pressed={serviceFilter === "attention"} onClick={() => setServiceFilter("attention")}>확인 필요 {failedServices.length + unknownServices.length}</button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[500px] border-collapse text-left text-xs">
              <thead className="bg-muted/45 text-muted-foreground"><tr><th scope="col" className="px-3 py-2.5 font-medium">서비스</th><th scope="col" className="px-3 py-2.5 font-medium">수집 상태</th><th scope="col" className="px-3 py-2.5 font-medium">문서 반영</th><th scope="col" className="px-3 py-2.5 font-medium">수집값 · 판단 근거</th></tr></thead>
              <tbody>{visibleServices.map(([key, ok]) => <ServiceStatusRow key={key} name={key} ok={ok} issue={checkFieldIssue(result, `flags.${key}` as CheckFieldKey)} documentValue={documentFlags?.[key]} rawValue={result.raw[rawKeyForFlag(key)]} />)}</tbody>
            </table>
            {visibleServices.length === 0 ? <p className="px-4 py-7 text-center text-sm text-muted-foreground">확인이 필요한 서비스가 없습니다.</p> : null}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">미수집·확인불가는 이상으로 판정하지 않습니다. 문서 반영값을 직접 선택해도 수집 원본은 유지됩니다. 메일 서버는 기존 정책에 따라 점검에서 제외합니다.</p>
        </section>

        <details className="group rounded-md border bg-muted/15">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md px-3.5 py-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="flex items-center gap-2"><ChevronDown className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />시스템 상세</span><span className="hidden text-xs font-normal text-muted-foreground sm:inline">버전 · 파티션 · 백업 · 리포트</span></summary>
          <dl className="grid gap-x-5 gap-y-3 border-t bg-card p-4 text-xs sm:grid-cols-2">
            <Detail label="서버 모델" value={result.system.serverModel || result.hardwareType || "-"} />
            <Detail label="OS 정보" value={checkFieldIssueLabel(result, "system.osInfo") ?? result.system.osInfo} />
            <Detail label="Docker" value={checkFieldIssueLabel(result, "versions.docker") ?? result.versions.docker} />
            <Detail label="Windows 에이전트" value={checkFieldIssueLabel(result, "versions.agentWin") ?? result.versions.agentWin} />
            <Detail label="Mac 에이전트" value={checkFieldIssueLabel(result, "versions.agentMac") ?? result.versions.agentMac} />
            <Detail label="수집 시각" value={checkFieldIssueLabel(result, "system.checkTime") ?? collectionTime} />
            <Detail label="최근 재부팅" value={checkFieldIssueLabel(result, "system.lastReboot") ?? result.system.lastReboot} />
            <Detail label="백업" value={`${collectedServiceText(result, "backup", result.flags.backup)} · ${checkFieldIssueLabel(result, "backup.latest") ?? result.backup.latest} · ${collectedNumberText(result, "backup.sizeGb", result.backup.sizeGb, " GB")}`} />
            <Detail label="최근 리포트 생성일" value={monthlyReportIssue ?? (monthlyReportStatus.detail !== "-" ? `${monthlyReportStatus.status} · ${monthlyReportStatus.detail}` : monthlyReportStatus.status)} />
            <Detail label="조직 연동" value={orgSyncStatus} />
            {disks.map((disk, index) => <Detail key={index} label={`${disk.mount || ["/", "/home", "/storage"][index]} 파티션`} value={`${checkFieldIssueLabel(result, `disks.${diskNames[index]}.used`) ?? disk.used} / ${checkFieldIssueLabel(result, `disks.${diskNames[index]}.size`) ?? disk.size} · ${collectedNumberText(result, `disks.${diskNames[index]}.usedPercent`, disk.usedPercent, "%")}`} />)}
          </dl>
        </details>
        <details className="group rounded-md border bg-muted/15">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md px-3.5 py-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="flex items-center gap-2"><ChevronDown className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />원본 주요 값</span><span className="hidden text-xs font-normal text-muted-foreground sm:inline">수집된 원본 데이터 확인</span></summary>
          <dl className="overflow-hidden rounded-b-md border-t bg-card text-xs">{rawRows.map(([label, value]) => <div className="grid grid-cols-[minmax(100px,30%)_minmax(0,1fr)] border-b last:border-b-0" key={label}><dt className="bg-muted/35 px-3 py-2 font-medium text-muted-foreground">{label}</dt><dd className="break-words px-3 py-2 text-foreground">{formatRawValue(value)}</dd></div>)}</dl>
        </details>
      </div>
    </section>
  );
}

function ResourceMetric({ icon: Icon, label, value, percent, tone, children }: { icon: LucideIcon; label: string; value: string; percent: number | null; tone: "neutral" | "warning" | "danger"; children: ReactNode }) {
  return <div className="min-w-0 rounded-md border bg-card p-3.5">
    <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-4 shrink-0" aria-hidden="true" />{label}</div>
    <p className="mt-2 text-xl font-semibold tracking-tight text-foreground tabular-nums">{value}</p>
    <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">{percent !== null ? <div className={`h-full rounded-full ${tone === "danger" ? "bg-destructive" : tone === "warning" ? "bg-[var(--warning)]" : "bg-primary"}`} style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} /> : null}</div>
    <div className="mt-2.5 space-y-0.5 text-xs leading-relaxed text-muted-foreground">{children}</div>
  </div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-medium text-foreground">{value}</dd></div>;
}

function ServiceStatusRow({ name, ok, issue, rawValue, documentValue }: { name: string; ok: boolean; issue: "missing" | "invalid" | null; rawValue: unknown; documentValue?: boolean }) {
  const config = serviceLabels[name] ?? { label: name };
  const displayValue = getServiceDisplayValue(name, ok, rawValue);
  const appliedValue = documentValue ?? (issue ? undefined : ok);
  const hasOverride = documentValue !== undefined;
  const changed = hasOverride && (issue !== null || documentValue !== ok);
  const sourceLabel = issue === "invalid" ? "확인불가" : issue === "missing" ? "미수집" : statusText(ok);
  return <tr className="border-t hover:bg-muted/20">
    <th scope="row" className="px-3 py-3 font-medium text-foreground">{config.label}</th>
    <td className="px-3 py-3">{config.excluded ? <span className="text-muted-foreground">점검 제외</span> : <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${issue ? "text-[var(--warning)]" : ok ? "text-primary" : "text-destructive"}`}><span className="size-1.5 rounded-full bg-current" aria-hidden="true" />{sourceLabel}</span>}</td>
    <td className="px-3 py-3">{config.excluded ? <span className="text-muted-foreground">—</span> : <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-1 ${changed ? "bg-muted text-foreground" : "text-foreground"}`}>{appliedValue === undefined ? sourceLabel : statusText(appliedValue)}<span className="text-[10px] text-muted-foreground">{hasOverride ? "직접 선택" : issue ? "미판정" : "수집값"}</span></span>}</td>
    <td className="max-w-56 break-words px-3 py-3 leading-relaxed text-muted-foreground">{displayValue === "-" ? "상세 수집값 없음" : displayValue}</td>
  </tr>;
}

function buildRawRows(result: CheckResult): Array<[string, unknown]> {
  return [
    ["고객사 ID", result.raw.company],
    ["고객사명", result.raw.companyName],
    ["시리얼", result.raw.serial],
    ["제품명", result.raw.productName],
    ["전체 라이선스", result.raw.totalLicence],
    ["사용 라이선스", result.raw.useLicence],
    ["미인증 라이선스", result.raw.uncertifiedLicence],
    ["Docker 버전", result.raw.dockerImageVersion],
    ["Windows 에이전트 버전", result.raw.agentVersion],
    ["Mac 에이전트 버전", result.raw.agentVersionMac],
    ["서버 모델", result.raw.serverModel],
    ["OS 정보", result.system.osInfo || result.raw.checkOsVersion],
    ["수집일", result.raw.dateOfEntry],
    ["CPU 사용률", result.raw.cpuUsage],
    ["Load Average 1분", result.raw.loadAvg1Min ?? result.raw.load1 ?? result.raw.loadAverage1m],
    ["Load Average 5분", result.raw.loadAvg5Min ?? result.raw.load5 ?? result.raw.loadAverage5m],
    ["Load Average 15분", result.raw.loadAvg15Min ?? result.raw.load15 ?? result.raw.loadAverage15m],
    ["메모리 사용률", result.raw.memoryUsage],
    ["총 메모리", result.raw.totalMemorySize],
    ["최근 리포트 생성일", result.raw.monthlyReportStatus],
    ["조직 동기화", result.raw.orgSyncStatus],
    ["/ 파티션", result.raw.rootDiskFormatted],
    ["/home 파티션", result.raw.homeDiskFormatted],
    ["/storage 파티션", result.raw.storageDiskFormatted],
    ...serviceKeys.map((key) => [rawLabelForServiceKey(key), result.raw[key]] as [string, unknown]),
  ];
}

function parseRawLogData(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function rawKeyForFlag(key: string) {
  const map: Record<string, string> = {
    agent: "agentStatus",
    mail: "mailServerStatus",
    web: "webConnectionStatus",
    httpd: "httpdStatus",
    mysqld: "mysqldStatus",
    ntp: "ntpSyncStatus",
    iptables: "iptablesStatus",
    firewall: "firewallStatus",
    backup: "backupStatus",
  };
  return map[key] ?? key;
}

function rawLabelForServiceKey(key: string) {
  const flagKey = Object.entries({
    agentStatus: "agent",
    mailServerStatus: "mail",
    webConnectionStatus: "web",
    httpdStatus: "httpd",
    mysqldStatus: "mysqld",
    ntpSyncStatus: "ntp",
    iptablesStatus: "iptables",
    firewallStatus: "firewall",
    backupStatus: "backup",
  }).find(([rawKey]) => rawKey === key)?.[1];
  return flagKey ? serviceLabels[flagKey]?.label ?? key : key;
}

function getServiceDisplayValue(name: string, ok: boolean, rawValue: unknown) {
  const rawText = formatRawValue(rawValue);
  if (
    name === "firewall" &&
    ok &&
    /(filenotfound|file not found|statusnotactive|notactive|service not active)/i.test(rawText)
  ) {
    return "서비스 미설치/비활성 허용";
  }
  return rawText;
}

function statusText(ok: boolean) {
  return ok ? "정상" : "이상";
}

function pickReportStatusValue(...values: unknown[]) {
  const withMonth = values.find((value) => /\b\d{4}-\d{2}\b/.test(formatRawValue(value)));
  if (withMonth !== undefined) {
    return withMonth;
  }

  return values.find((value) => formatRawValue(value) !== "-");
}

function formatReportStatus(value: unknown) {
  const text = formatRawValue(value).trim();
  const knownStatus = readCheckBoolean(value);
  const ok = knownStatus === true;
  const month = text.match(/\b(\d{4})-(\d{2})\b/);
  const simpleStatus = /^(y|n|yes|no|true|false|ok|normal|정상|이상|o)$/i.test(text);

  return {
    ok,
    status: !text || text === "-" ? "미수집" : knownStatus === null ? "확인불가" : ok ? "정상" : "이상",
    detail: month ? `${month[1]}-${month[2]}` : text && text !== "-" && !simpleStatus ? text : "-",
  };
}

function formatRawValue(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return "-";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function formatCollectionTime(value: string) {
  const text = value.trim();
  if (!text || text === "-") {
    return "";
  }
  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return text;
  }
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatRemaining(seconds: number): string {
  const mm = Math.floor(seconds / 60).toString().padStart(2, "0");
  const ss = (seconds % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function getResultSeverity(result: CheckResult, failedServices: number, maxDiskUsage: number | null, unknownFields: number) {
  if (
    failedServices > 0 ||
    result.warnings.length > 0 ||
    (!isCheckFieldUnknown(result, "system.cpuUsagePercent") && result.system.cpuUsagePercent >= 90) ||
    (!isCheckFieldUnknown(result, "system.memUsagePercent") && result.system.memUsagePercent >= 90) ||
    (maxDiskUsage !== null && maxDiskUsage >= 90)
  ) {
    return { label: "확인 필요", variant: "destructive" as const, className: undefined };
  }
  if (
    unknownFields > 0 ||
    (!isCheckFieldUnknown(result, "license.unverified") && result.license.unverified > 0) ||
    (!isCheckFieldUnknown(result, "system.cpuUsagePercent") && result.system.cpuUsagePercent >= 75) ||
    (!isCheckFieldUnknown(result, "system.memUsagePercent") && result.system.memUsagePercent >= 75) ||
    (maxDiskUsage !== null && maxDiskUsage >= 80)
  ) {
    return {
      label: unknownFields > 0 ? "수집 확인 필요" : "주의",
      variant: "outline" as const,
      className:
        "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
    };
  }
  return {
    label: "정상",
    variant: "outline" as const,
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  };
}

function usageTone(percent: number): "neutral" | "warning" | "danger" {
  if (percent >= 90) {
    return "danger";
  }
  if (percent >= 75) {
    return "warning";
  }
  return "neutral";
}
