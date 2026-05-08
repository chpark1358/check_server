"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

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
  accessToken: string | null;
  onResult?: (result: CheckResult) => void;
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

const solutionUsernameStorageKey = "check-server:solution-username:v1";
const solutionSessionStorageKey = "check-server:solution-session:v1";

class ClientApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function CheckFlowPanel({ accessToken, onResult }: Props) {
  const [username, setUsername] = useState(() => readStoredSolutionUsername());
  const [password, setPassword] = useState("");
  const [session, setSession] = useState<Session | null>(() => readStoredSolutionSession());
  const [serialDigits, setSerialDigits] = useState("");
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      if (session && new Date(session.expiresAt).getTime() <= tick) {
        setSession(null);
        clearStoredSolutionSession();
        setError("솔루션 로그인 시간이 만료되었습니다. 다시 로그인하세요.");
      }
    }, 1000);
    return () => clearInterval(id);
  }, [session]);

  const remainingSeconds = useMemo(() => {
    if (!session) return 0;
    return Math.max(0, Math.floor((new Date(session.expiresAt).getTime() - now) / 1000));
  }, [session, now]);

  const isReadyToFetch = Boolean(session) && remainingSeconds > 0 && /^\d{4,}$/.test(serialDigits);
  const previewSerial = serialDigits ? `LO${serialDigits}` : "LO________";

  async function callApi<T>(path: string, init: RequestInit = {}) {
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
    if (!username.trim() || !password) {
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
      writeStoredSolutionSession(nextSession);
      const nextUsername = data.username || username.trim();
      setUsername(nextUsername);
      writeStoredSolutionUsername(nextUsername);
      setPassword("");
    });
  }

  async function logout() {
    setSession(null);
    setError(null);
    clearStoredSolutionSession();
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
        onResult?.(data.result);
      } catch (nextError) {
        if (
          nextError instanceof ClientApiError &&
          ["SOLUTION_TOKEN_EXPIRED", "SOLUTION_NOT_AUTHENTICATED"].includes(nextError.code)
        ) {
          setSession(null);
          clearStoredSolutionSession();
        }
        throw nextError;
      }
    });
  }

  return (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            CRM 로그인
          </CardTitle>
          {session ? (
            <Badge
              variant="outline"
              className={
                remainingSeconds <= 60
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
              }
            >
              {formatRemaining(remainingSeconds)}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              로그인 필요
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!session ? (
          <form className="space-y-3" onSubmit={login}>
            <div className="space-y-1.5">
              <Label htmlFor="solution-username">CRM 아이디</Label>
              <Input
                id="solution-username"
                autoComplete="username"
                onChange={(event) => setUsername(event.target.value)}
                type="text"
                value={username}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="solution-password">비밀번호</Label>
              <Input
                id="solution-password"
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
            </div>
            <Button className="w-full" disabled={Boolean(busyLabel)} type="submit">
              로그인
            </Button>
          </form>
        ) : (
          <div className="space-y-2">
            <InfoRow label="아이디" value={session.username} />
            <InfoRow label="토큰" value={session.masked} />
            <Button variant="outline" className="w-full" onClick={() => void logout()} type="button">
              로그아웃
            </Button>
          </div>
        )}

        <Separator />

        <form className="space-y-2" onSubmit={fetchCheckup}>
          <Label htmlFor="serial-digits">시리얼 (LO + 숫자)</Label>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 items-center rounded-lg border bg-muted/40 px-2 text-sm font-medium">LO</span>
            <Input
              id="serial-digits"
              className="flex-1"
              inputMode="numeric"
              onChange={(event) => setSerialDigits(event.target.value.replace(/\D/g, ""))}
              placeholder="24030501"
              value={serialDigits}
            />
          </div>
          <p className="text-xs text-muted-foreground">미리보기: {previewSerial}</p>
          <Button className="w-full" disabled={!isReadyToFetch || Boolean(busyLabel)} type="submit">
            점검 데이터 불러오기
          </Button>
        </form>

        <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">문서 생성</p>
          <p className="mt-1">점검 데이터를 불러온 뒤 우측 확인서 생성 영역에서 DOCX/PDF를 생성하고 메일 첨부로 추가할 수 있습니다.</p>
        </div>

        {busyLabel ? <p className="text-xs text-muted-foreground">{busyLabel}…</p> : null}
        {error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs font-medium text-destructive">{error}</p>
        ) : null}

      </CardContent>
    </Card>
  );
}

export function ResultSummary({ result }: { result: CheckResult }) {
  const rawRows = buildRawRows(result);
  const logData = parseRawLogData(result.raw.logData);
  const reportFlags = Object.entries(result.flags).filter(([key]) => key !== "mail");
  const failedServices = reportFlags.filter(([, ok]) => !ok);
  const maxDiskUsage = Math.max(
    result.disks.root.usedPercent,
    result.disks.home.usedPercent,
    result.disks.storage.usedPercent,
  );
  const severity = getResultSeverity(result, failedServices.length, maxDiskUsage);
  const licenseUsagePercent =
    result.license.total > 0 ? Math.round((result.license.used / result.license.total) * 100) : 0;
  const monthlyReportRaw = pickReportStatusValue(
    result.raw.monthlyReportStatus,
    logData.monthlyReportStatus,
    logData.checkMonthlyReportExist,
  );
  const monthlyReportStatus = formatReportStatus(monthlyReportRaw);
  const orgSyncStatus = formatRawValue(result.raw.orgSyncStatus ?? logData.checkOrgSync);
  const collectionTime = result.system.checkTime || formatRawValue(result.raw.dateOfEntry ?? logData.time);

  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-muted/30 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {result.companyName || "(이름 없음)"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {result.serial || "-"} · {result.softwareName || "-"} · {result.hardwareType || "-"}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={severity.variant} className={severity.className}>
              {severity.label}
            </Badge>
            <Badge variant="outline">경고 {result.warnings.length}</Badge>
            <Badge variant="outline">서비스 이상 {failedServices.length}</Badge>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat
          label="라이선스"
          value={`${result.license.used} / ${result.license.total}`}
          sub={`미인증 ${result.license.unverified} · ${licenseUsagePercent}%`}
          tone={result.license.unverified > 0 ? "warning" : "neutral"}
        />
        <Stat
          label="CPU"
          value={`${result.system.cpuUsagePercent}%`}
          sub={`load ${result.system.load1}`}
          tone={usageTone(result.system.cpuUsagePercent)}
        />
        <Stat
          label="MEM"
          value={`${result.system.memUsagePercent}%`}
          sub={`${result.system.memTotalGb}GB`}
          tone={usageTone(result.system.memUsagePercent)}
        />
        <Stat label="Docker" value={result.versions.docker || "-"} />
        <Stat
          label="/ 파티션"
          value={`${result.disks.root.usedPercent}%`}
          sub={`${result.disks.root.used || "-"} / ${result.disks.root.size || "-"}`}
          tone={usageTone(result.disks.root.usedPercent)}
        />
        <Stat
          label="/home 파티션"
          value={`${result.disks.home.usedPercent}%`}
          sub={`${result.disks.home.used || "-"} / ${result.disks.home.size || "-"}`}
          tone={usageTone(result.disks.home.usedPercent)}
        />
        <Stat
          label="/storage 파티션"
          value={`${result.disks.storage.usedPercent}%`}
          sub={`${result.disks.storage.used || "-"} / ${result.disks.storage.size || "-"}`}
          tone={usageTone(result.disks.storage.usedPercent)}
        />
        <Stat
          label="백업"
          value={statusText(result.flags.backup)}
          tone={result.flags.backup ? "success" : "danger"}
        />
        <Stat label="Win Agent" value={result.versions.agentWin || "-"} />
        <Stat label="Mac Agent" value={result.versions.agentMac || "-"} />
        <Stat
          label="최근 리포트 생성일"
          value={monthlyReportStatus.status}
          sub={monthlyReportStatus.detail !== "-" ? monthlyReportStatus.detail : undefined}
          tone={monthlyReportStatus.ok ? "success" : "danger"}
        />
        <Stat label="서버 모델" value={result.system.serverModel || result.hardwareType || "-"} />
      </div>

      <section>
        <p className="mb-2 text-xs font-medium text-foreground">시스템 상세</p>
        <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="총 메모리" value={`${result.system.memTotalGb || 0}GB`} />
          <Detail label="수집일" value={collectionTime || "-"} />
          <Detail label="최근 재부팅" value={result.system.lastReboot || "-"} />
          <Detail
            label="최근 리포트 생성일"
            value={
              monthlyReportStatus.detail !== "-"
                ? `${monthlyReportStatus.status} · ${monthlyReportStatus.detail}`
                : monthlyReportStatus.status
            }
          />
          <Detail label="조직 연동" value={orgSyncStatus} />
        </div>
      </section>

      <section>
        <p className="mb-2 text-xs font-medium text-foreground">서비스 상태</p>
        <div className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
          {Object.entries(result.flags).map(([key, ok]) => (
            <ServiceStatusRow key={key} name={key} ok={ok} rawValue={result.raw[rawKeyForFlag(key)]} />
          ))}
        </div>
      </section>

      <section>
        <p className="mb-2 text-xs font-medium text-foreground">원본 주요 값</p>
        <div className="overflow-hidden rounded-md border bg-card text-xs">
          {rawRows.map(([label, value]) => (
            <div className="grid grid-cols-[130px_minmax(0,1fr)] border-b last:border-b-0" key={label}>
              <span className="bg-muted/40 px-2 py-1 font-medium text-muted-foreground">{label}</span>
              <span className="break-words px-2 py-1 text-foreground">{formatRawValue(value)}</span>
            </div>
          ))}
        </div>
      </section>

      {result.warnings.length > 0 ? (
        <ul className="list-disc rounded-md border border-amber-200 bg-amber-50 p-3 pl-6 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {result.warnings.map((warning, idx) => (
            <li key={idx}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <div className={`rounded-md border bg-card p-2 ${resultCardHoverClass} ${statToneClass(tone)}`}>
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium text-foreground">{value}</p>
      {sub ? <p className="text-muted-foreground/70">{sub}</p> : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className={`rounded-md border bg-muted/30 px-2 py-1.5 ${resultCardHoverClass}`}>
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words font-medium text-foreground">{value}</p>
    </div>
  );
}

function ServiceStatusRow({ name, ok, rawValue }: { name: string; ok: boolean; rawValue: unknown }) {
  const config = serviceLabels[name] ?? { label: name };
  const displayValue = getServiceDisplayValue(name, ok, rawValue);

  if (config.excluded) {
    return (
      <div className={`flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1 text-muted-foreground ${resultCardHoverClass}`}>
        <span className="font-medium">{config.label}</span>
        <Badge variant="outline">점검 제외</Badge>
        <span className="ml-auto truncate">{displayValue}</span>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-2 py-1 ${resultCardHoverClass} ${
        ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
          : "border-destructive/30 bg-destructive/10 text-destructive"
      }`}
    >
      <span className="font-medium">{config.label}</span>
      <Badge variant={ok ? "secondary" : "destructive"}>{statusText(ok)}</Badge>
      <span className="ml-auto truncate text-muted-foreground">{displayValue}</span>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-xs font-medium text-foreground">{value}</span>
    </div>
  );
}

const resultCardHoverClass =
  "transform-gpu transition-[transform,box-shadow,border-color] duration-150 ease-out hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-18px_rgba(15,23,42,0.55)] hover:[transform:perspective(900px)_rotateX(1deg)_translateY(-2px)]";

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
    ["수집일", result.raw.dateOfEntry],
    ["CPU 사용률", result.raw.cpuUsage],
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
  const ok = /^(y|yes|true|ok|normal|정상|o)(?:\b|\(|$)/i.test(text);
  const month = text.match(/\b(\d{4})-(\d{2})\b/);
  const simpleStatus = /^(y|n|yes|no|true|false|ok|normal|정상|이상|o)$/i.test(text);

  return {
    ok,
    status: ok ? "정상" : "이상",
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

function formatRemaining(seconds: number): string {
  const mm = Math.floor(seconds / 60).toString().padStart(2, "0");
  const ss = (seconds % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function readStoredSolutionUsername() {
  if (typeof window === "undefined") {
    return "";
  }
  return localStorage.getItem(solutionUsernameStorageKey) ?? "";
}

function readStoredSolutionSession(): Session | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = localStorage.getItem(solutionSessionStorageKey);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (
      typeof parsed.expiresAt !== "string" ||
      typeof parsed.masked !== "string" ||
      typeof parsed.username !== "string"
    ) {
      clearStoredSolutionSession();
      return null;
    }
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
      clearStoredSolutionSession();
      return null;
    }
    return {
      expiresAt: parsed.expiresAt,
      masked: parsed.masked,
      username: parsed.username,
    };
  } catch {
    clearStoredSolutionSession();
    return null;
  }
}

function writeStoredSolutionUsername(value: string) {
  if (typeof window === "undefined") {
    return;
  }
  const next = value.trim();
  if (next) {
    localStorage.setItem(solutionUsernameStorageKey, next);
  }
}

function writeStoredSolutionSession(session: Session) {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(solutionSessionStorageKey, JSON.stringify(session));
}

function clearStoredSolutionSession() {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.removeItem(solutionSessionStorageKey);
}

function getResultSeverity(result: CheckResult, failedServices: number, maxDiskUsage: number) {
  if (
    failedServices > 0 ||
    result.warnings.length > 0 ||
    result.system.cpuUsagePercent >= 90 ||
    result.system.memUsagePercent >= 90 ||
    maxDiskUsage >= 90
  ) {
    return { label: "확인 필요", variant: "destructive" as const, className: undefined };
  }
  if (
    result.license.unverified > 0 ||
    result.system.cpuUsagePercent >= 75 ||
    result.system.memUsagePercent >= 75 ||
    maxDiskUsage >= 80
  ) {
    return {
      label: "주의",
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

function statToneClass(tone: "neutral" | "success" | "warning" | "danger") {
  if (tone === "success") {
    return "border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/30 dark:bg-emerald-500/10";
  }
  if (tone === "warning") {
    return "border-amber-200 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-500/10";
  }
  if (tone === "danger") {
    return "border-destructive/30 bg-destructive/10";
  }
  return "";
}
