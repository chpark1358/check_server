"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

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
  token: string;
  tokenType: string;
  expiresAt: string;
  masked: string;
  username: string;
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

export function CheckFlowPanel({ accessToken, onResult }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [serialDigits, setSerialDigits] = useState("");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      if (session && new Date(session.expiresAt).getTime() <= tick) {
        setSession(null);
        setError("Solution API 토큰이 만료되었습니다. 다시 로그인하세요.");
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
    const response = await fetch(path, { ...init, headers });
    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.message || "요청 처리 중 오류가 발생했습니다.");
    }
    return data as T & { ok: true };
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
    await runBusy("Solution API 로그인 중", async () => {
      const data = await callApi<{
        token: string;
        tokenType: string;
        expiresAt: string;
        masked: string;
        username: string;
      }>("/api/solution/login", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password }),
      });
      setSession({
        token: data.token,
        tokenType: data.tokenType,
        expiresAt: data.expiresAt,
        masked: data.masked,
        username: data.username,
      });
      setPassword("");
    });
  }

  function logout() {
    setSession(null);
    setResult(null);
    setError(null);
  }

  async function fetchCheckup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) {
      setError("Solution API 로그인이 필요합니다.");
      return;
    }
    if (!/^\d{4,}$/.test(serialDigits)) {
      setError("시리얼은 LO 뒤에 붙는 숫자 4자리 이상이어야 합니다.");
      return;
    }
    await runBusy("점검 데이터 불러오는 중", async () => {
      const data = await callApi<{ result: CheckResult }>("/api/solution/checkup", {
        method: "POST",
        body: JSON.stringify({
          serial: previewSerial,
          token: session.token,
          tokenType: session.tokenType,
        }),
      });
      setResult(data.result);
      onResult?.(data.result);
    });
  }

  return (
    <section className="rounded-md border border-[#d8dee9] bg-white p-4">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold">점검 흐름</h2>
        {session ? (
          <span
            className={`rounded-md border px-2 py-1 text-xs font-medium ${
              remainingSeconds <= 60
                ? "border-[#fecdca] bg-[#fef3f2] text-[#b42318]"
                : "border-[#c6f6d5] bg-[#ecfdf3] text-[#087443]"
            }`}
          >
            {formatRemaining(remainingSeconds)}
          </span>
        ) : (
          <span className="rounded-md border border-[#ffd8a8] bg-[#fff7ed] px-2 py-1 text-xs font-medium text-[#b54708]">
            로그인 필요
          </span>
        )}
      </header>

      {!session ? (
        <form className="mt-3 space-y-3" onSubmit={login}>
          <Field label="Solution 아이디">
            <input
              autoComplete="username"
              className="input"
              onChange={(event) => setUsername(event.target.value)}
              type="text"
              value={username}
            />
          </Field>
          <Field label="비밀번호">
            <input
              autoComplete="current-password"
              className="input"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </Field>
          <button className="primary-button w-full" disabled={Boolean(busyLabel)} type="submit">
            로그인
          </button>
        </form>
      ) : (
        <div className="mt-3 space-y-3">
          <InfoRow label="아이디" value={session.username} />
          <InfoRow label="토큰" value={session.masked} />
          <button className="secondary-button w-full" onClick={logout} type="button">
            로그아웃
          </button>
        </div>
      )}

      <form className="mt-4 space-y-2" onSubmit={fetchCheckup}>
        <label className="block text-sm font-semibold text-[#344054]">시리얼 (LO + 숫자)</label>
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-[#d8dee9] bg-[#f8fafc] px-2 py-2 text-sm font-semibold">LO</span>
          <input
            className="input flex-1"
            inputMode="numeric"
            onChange={(event) => setSerialDigits(event.target.value.replace(/\D/g, ""))}
            placeholder="24030501"
            value={serialDigits}
          />
        </div>
        <p className="text-xs text-[#667085]">미리보기: {previewSerial}</p>
        <button className="primary-button w-full" disabled={!isReadyToFetch || Boolean(busyLabel)} type="submit">
          점검 데이터 불러오기
        </button>
      </form>

      <section className="mt-4 rounded-md border border-[#e4e9f2] bg-[#f8fafc] p-3 text-xs text-[#667085]">
        <p className="font-semibold text-[#344054]">문서 생성</p>
        <p className="mt-1">점검 데이터를 불러온 뒤 우측 확인서 생성 영역에서 DOCX/PDF를 생성하고 메일 첨부로 추가할 수 있습니다.</p>
      </section>

      {busyLabel ? <p className="mt-3 text-xs text-[#667085]">{busyLabel}...</p> : null}
      {error ? (
        <p className="mt-3 rounded-md border border-[#fecdca] bg-[#fef3f2] p-2 text-xs font-medium text-[#b42318]">{error}</p>
      ) : null}

      {result ? <ResultSummary result={result} /> : null}
    </section>
  );
}

function ResultSummary({ result }: { result: CheckResult }) {
  const rawRows = buildRawRows(result);

  return (
    <div className="mt-4 space-y-3 border-t border-[#e4e9f2] pt-3">
      <h3 className="text-sm font-semibold">점검 결과</h3>
      <div className="rounded-md bg-[#f8fafc] p-3 text-xs">
        <p className="font-semibold">{result.companyName || "(이름 없음)"}</p>
        <p className="text-[#667085]">
          {result.serial || "-"} / {result.softwareName || "-"} / {result.hardwareType || "-"}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="라이선스" value={`${result.license.used} / ${result.license.total}`} sub={`미인증 ${result.license.unverified}`} />
        <Stat label="CPU" value={`${result.system.cpuUsagePercent}%`} sub={`load ${result.system.load1}`} />
        <Stat label="MEM" value={`${result.system.memUsagePercent}%`} sub={`${result.system.memTotalGb}GB`} />
        <Stat label="Docker" value={result.versions.docker || "-"} />
        <Stat label="/" value={`${result.disks.root.usedPercent}%`} sub={`${result.disks.root.used || "-"} / ${result.disks.root.size || "-"}`} />
        <Stat label="/home" value={`${result.disks.home.usedPercent}%`} sub={`${result.disks.home.used || "-"} / ${result.disks.home.size || "-"}`} />
        <Stat label="/storage" value={`${result.disks.storage.usedPercent}%`} sub={`${result.disks.storage.used || "-"} / ${result.disks.storage.size || "-"}`} />
        <Stat label="백업" value={statusText(result.flags.backup)} sub={result.backup.latest || "-"} />
      </div>

      <section>
        <p className="mb-2 text-xs font-semibold text-[#344054]">서비스 상태</p>
        <div className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
          {Object.entries(result.flags).map(([key, ok]) => (
            <div
              key={key}
              className={`rounded-md border px-2 py-1 ${
                ok
                  ? "border-[#c6f6d5] bg-[#ecfdf3] text-[#087443]"
                  : "border-[#fecdca] bg-[#fef3f2] text-[#b42318]"
              }`}
            >
              <span className="font-semibold">{key}</span>
              <span className="ml-2">{statusText(ok)}</span>
              <span className="ml-2 text-[#667085]">{formatRawValue(result.raw[rawKeyForFlag(key)])}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <p className="mb-2 text-xs font-semibold text-[#344054]">원본 주요 값</p>
        <div className="rounded-md border border-[#e4e9f2] bg-white text-xs">
          {rawRows.map(([label, value]) => (
            <div className="grid grid-cols-[130px_minmax(0,1fr)] border-b border-[#edf1f7] last:border-b-0" key={label}>
              <span className="bg-[#f8fafc] px-2 py-1 font-semibold text-[#667085]">{label}</span>
              <span className="break-words px-2 py-1 text-[#172033]">{formatRawValue(value)}</span>
            </div>
          ))}
        </div>
      </section>

      {result.warnings.length > 0 ? (
        <ul className="list-disc rounded-md bg-[#fff7ed] p-3 pl-6 text-xs text-[#b54708]">
          {result.warnings.map((warning, idx) => (
            <li key={idx}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-[#e4e9f2] bg-white p-2">
      <p className="text-[#667085]">{label}</p>
      <p className="mt-1 font-semibold text-[#172033]">{value}</p>
      {sub ? <p className="text-[#94a3b8]">{sub}</p> : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-semibold text-[#344054]">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-[#e4e9f2] bg-[#f8fafc] px-3 py-2">
      <span className="text-xs font-semibold text-[#667085]">{label}</span>
      <span className="text-xs font-medium text-[#172033]">{value}</span>
    </div>
  );
}

function buildRawRows(result: CheckResult): Array<[string, unknown]> {
  return [
    ["company", result.raw.company],
    ["companyName", result.raw.companyName],
    ["serial", result.raw.serial],
    ["productName", result.raw.productName],
    ["totalLicence", result.raw.totalLicence],
    ["useLicence", result.raw.useLicence],
    ["uncertifiedLicence", result.raw.uncertifiedLicence],
    ["dockerImageVersion", result.raw.dockerImageVersion],
    ["agentVersion", result.raw.agentVersion],
    ["cpuUsage", result.raw.cpuUsage],
    ["memoryUsage", result.raw.memoryUsage],
    ["totalMemorySize", result.raw.totalMemorySize],
    ["rootDiskFormatted", result.raw.rootDiskFormatted],
    ["homeDiskFormatted", result.raw.homeDiskFormatted],
    ["storageDiskFormatted", result.raw.storageDiskFormatted],
    ...serviceKeys.map((key) => [key, result.raw[key]] as [string, unknown]),
  ];
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

function statusText(ok: boolean) {
  return ok ? "정상" : "이상";
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
