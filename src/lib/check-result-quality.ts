/** Field availability accompanies legacy numeric/boolean values; 0 and false remain real values. */
export const CHECK_FIELD_LABELS = {
  "license.total": "전체 라이선스", "license.used": "사용 라이선스", "license.unverified": "미인증 라이선스",
  "versions.docker": "Docker 버전", "versions.agentWin": "Windows 에이전트 버전", "versions.agentMac": "Mac 에이전트 버전",
  "system.osInfo": "서버 OS", "system.checkTime": "수집 시각", "system.lastReboot": "마지막 재부팅",
  "system.cpuUsagePercent": "CPU 사용률", "system.memTotalGb": "메모리 용량", "system.memUsagePercent": "메모리 사용률",
  "system.load1": "1분 부하", "system.load5": "5분 부하", "system.load15": "15분 부하",
  "disks.root.size": "루트 디스크 용량", "disks.root.used": "루트 디스크 사용량", "disks.root.usedPercent": "루트 디스크 사용률",
  "disks.home.size": "홈 디스크 용량", "disks.home.used": "홈 디스크 사용량", "disks.home.usedPercent": "홈 디스크 사용률",
  "disks.storage.size": "스토리지 용량", "disks.storage.used": "스토리지 사용량", "disks.storage.usedPercent": "스토리지 사용률",
  "flags.agent": "에이전트", "flags.mail": "메일 서버", "flags.web": "웹 접속", "flags.httpd": "Httpd", "flags.mysqld": "MySQL",
  "flags.ntp": "시간 동기화", "flags.iptables": "Iptables", "flags.firewall": "방화벽", "flags.backup": "백업",
  monthlyReport: "월간 보고서", hrSync: "인사 연동",
  "backup.sizeGb": "백업 용량", "backup.latest": "마지막 백업",
} as const;

export type CheckFieldKey = keyof typeof CHECK_FIELD_LABELS;
export type CheckResultQuality = { version: 1; missingFields: CheckFieldKey[]; invalidFields: CheckFieldKey[] };
type QualityResult = { quality?: CheckResultQuality };
export type CheckFieldIssue = "missing" | "invalid" | null;

export function checkFieldIssue(result: QualityResult, key: CheckFieldKey): CheckFieldIssue {
  const raw = (result as Record<string, unknown>).raw;
  const quality = result.quality ?? (raw && typeof raw === "object" && !Array.isArray(raw) ? collectCheckResultQuality(raw as Record<string, unknown>) : undefined);
  if (quality) {
    if (quality.invalidFields.includes(key)) return "invalid";
    if (quality.missingFields.includes(key)) return "missing";
    return null;
  }
  // Legacy normalized-only fixtures cannot be traced to raw. When raw is present,
  // recompute availability above instead of trusting historical fallback zeros.
  const value = readPath(result as Record<string, unknown>, key);
  if (isAbsent(value)) return "missing";
  if (key.startsWith("flags.")) return readCheckBoolean(value) === null ? "invalid" : null;
  if (NUMERIC_FIELDS.has(key) || key.endsWith("usedPercent")) return validNumber(key, value) === null ? "invalid" : null;
  return typeof value === "string" || typeof value === "number" ? null : "invalid";
}

export function isCheckFieldUnknown(result: QualityResult, key: CheckFieldKey) {
  return checkFieldIssue(result, key) !== null;
}

export function readCheckNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const match = value.trim().match(/^([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|[+-]?\.\d+)\s*(?:%|[KMGT]?i?B|[KMGT])?$/i);
  if (!match) return null;
  const parsed = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function readCheckBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === 0) return value === 1;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (/^(true|y|yes|ok|1|active|running|success|normal|정상|o)(?:\s*\([^)]*\))?$/i.test(text)) return true;
  if (/^(false|n|no|0|inactive|stopped|failed|failure|error|abnormal|이상|비정상|x)(?:\s*\([^)]*\))?$/i.test(text)) return false;
  return null;
}

export const CHECK_RAW_PATHS: Partial<Record<CheckFieldKey, string[]>> = {
  "license.total": ["totalLicence", "total_licence", "license.total"],
  "license.used": ["useLicence", "usedLicence", "used_licence", "license.used"],
  "license.unverified": ["uncertifiedLicence", "unverifiedLicence", "unverified_licence", "license.uncertified", "license.unverified"],
  "versions.docker": ["dockerImageVersion", "dockerVersion", "docker_version"],
  "versions.agentWin": ["agentVersion", "agentVersionWin", "agent_version_win", "agentWindowsVersion"],
  "versions.agentMac": ["agentVersionMac", "agent_version_mac", "agentMacVersion"],
  "system.osInfo": ["checkOsVersion", "osVersion", "osInfo", "os_info", "os", "system.osInfo"],
  "system.checkTime": ["checkTime", "check_time", "checkedAt", "dateOfEntry"],
  "system.lastReboot": ["lastReboot", "last_reboot", "rebootAt", "server.lastReboot"],
  "system.cpuUsagePercent": ["cpuUsage", "cpuUsagePercent", "cpu_usage_percent", "cpu.usagePercent", "system.cpuUsage"],
  "system.memTotalGb": ["totalMemorySize", "memTotalGb", "mem_total_gb", "memory.totalGb", "system.memory.totalGB"],
  "system.memUsagePercent": ["memoryUsage", "memUsagePercent", "mem_usage_percent", "memory.usagePercent", "system.memory.usagePercent"],
  "system.load1": ["loadAvg1Min", "load1", "loadAverage1m", "system.loadAverage.1min"],
  "system.load5": ["loadAvg5Min", "load5", "loadAverage5m", "system.loadAverage.5min"],
  "system.load15": ["loadAvg15Min", "load15", "loadAverage15m", "system.loadAverage.15min"],
  "flags.agent": ["agentStatus", "agent_ok", "agentOk", "agent.status"],
  "flags.mail": ["mailServerStatus", "mail_ok", "mailOk"],
  "flags.web": ["webConnectionStatus", "web_ok", "webOk"],
  "flags.httpd": ["httpdStatus", "httpd_ok", "httpdOk", "process.httpd"],
  "flags.mysqld": ["mysqldStatus", "mysqld_ok", "mysqldOk", "process.mysqld"],
  "flags.ntp": ["ntpSyncStatus", "ntp_ok", "ntpOk", "sync.ntp"],
  "flags.iptables": ["iptablesStatus", "iptables_ok", "iptablesOk", "network.iptables"],
  "flags.firewall": ["firewallStatus", "firewall_ok", "firewallOk", "network.firewall"],
  "flags.backup": ["backupStatus", "backup_ok", "backupOk"],
  monthlyReport: ["monthlyReportOk", "monthly_report_ok", "monthlyReport", "monthlyReportStatus", "monthly_report_status", "checkMonthlyReportExist", "report.monthlyReportOk"],
  hrSync: ["hrSyncEnabled", "hr_sync_enabled", "orgSyncEnabled", "org_sync_enabled", "sync.hrEnabled", "orgSyncStatus", "org_sync_status", "sync.orgSyncStatus"],
  "backup.sizeGb": ["backup_latest_size_gb", "backupLatestSizeGb"], "backup.latest": ["backup_latest", "backupLatest"],
};
const LOG_PATHS: Partial<Record<CheckFieldKey, string[]>> = {
  "system.osInfo": ["checkOsVersion", "osVersion", "osInfo"], "system.checkTime": ["time"], "system.lastReboot": ["getLastRebootRecord"],
  "flags.mail": ["checkMailServer"], "flags.firewall": ["isFirewallActive"],
  monthlyReport: ["monthlyReportStatus", "checkMonthlyReportExist"], hrSync: ["checkOrgSync", "orgSyncStatus"],
};
const NUMERIC_FIELDS = new Set<CheckFieldKey>([
  "license.total", "license.used", "license.unverified", "system.cpuUsagePercent", "system.memTotalGb", "system.memUsagePercent", "system.load1", "system.load5", "system.load15",
  "backup.sizeGb",
]);

export function collectCheckResultQuality(raw: Record<string, unknown>): CheckResultQuality {
  const quality: CheckResultQuality = { version: 1, missingFields: [], invalidFields: [] };
  const log = readCheckLogData(raw.logData);
  for (const key of Object.keys(CHECK_FIELD_LABELS) as CheckFieldKey[]) {
    let value = pickCheckValue(raw, CHECK_RAW_PATHS[key] ?? []);
    if (isAbsent(value)) value = pickCheckValue(log, LOG_PATHS[key] ?? []);
    if (key.startsWith("disks.")) {
      const [, disk, field] = key.split(".");
      const paths = field === "usedPercent" ? [`${disk}DirectoryUsage`, `disk.${disk}.usagePercent`, `disk.${disk}.percent`] :
        field === "size" ? [`${disk}DirectorySize`, `disk.${disk}.sizeGB`, `disk.${disk}.size`] : [`${disk}DirectoryUsed`, `disk.${disk}.used`];
      value = pickCheckValue(raw, paths);
      const formatted = pickCheckValue(raw, [`${disk}_disk_formatted`, `${disk}DiskFormatted`]);
      if (typeof formatted === "string") {
        const one = formatted.match(/(.+?)\s*\/\s*(\d+(?:\.\d+)?)%\s*\(Total\s*:\s*([^)]+)\)/i);
        const two = formatted.match(/(\S+)\s+(\S+)\s+\((\d+(?:\.\d+)?)%?\)/);
        if (one) value = field === "size" ? one[3] : field === "used" ? one[1] : one[2];
        else if (two) value = field === "size" ? two[1] : field === "used" ? two[2] : two[3];
      }
    }
    if (key === "flags.mail" && readMailStatus(raw) !== null) continue;
    if (key === "flags.firewall" && isFirewallNotUsed(log.isFirewallActive)) continue;
    if (isAbsent(value)) { quality.missingFields.push(key); continue; }
    let valid = typeof value === "string" || typeof value === "number";
    if (NUMERIC_FIELDS.has(key) || key.startsWith("disks.")) valid = validNumber(key, value) !== null;
    else if (key.startsWith("flags.") || key === "monthlyReport" || key === "hrSync") valid = readCheckBoolean(value) !== null;
    else if (key === "system.checkTime") valid = typeof value === "string" && !Number.isNaN(Date.parse(value));
    if (!valid) quality.invalidFields.push(key);
  }
  return quality;
}

export function readMailStatus(raw: Record<string, unknown>): boolean | null {
  const explicit = pickCheckValue(raw, CHECK_RAW_PATHS["flags.mail"]!);
  const detail = readCheckLogData(raw.logData).checkMailServer;
  if (isMailError(explicit) || isMailError(detail)) return false;
  // An explicit N means SMTP is not used, which is an existing business exception.
  if ([explicit, detail].some(value => typeof value === "string" && /^n$/i.test(value.trim()))) return true;
  return readCheckBoolean(explicit) ?? readCheckBoolean(detail);
}

export function isFirewallNotUsed(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const detail = value.trim().toLowerCase();
  return ["inactive", "statusnotactive", "notactive", "service not active"].includes(detail) ||
    detail.includes("statusnotactive") || detail.includes("service not active") || detail.includes("filenotfound") || detail.includes("file not found");
}

export function readFirewallStatus(raw: Record<string, unknown>): boolean | null {
  const detail = readCheckLogData(raw.logData).isFirewallActive;
  if (isFirewallNotUsed(detail)) return true;
  return readCheckBoolean(pickCheckValue(raw, CHECK_RAW_PATHS["flags.firewall"]!)) ?? readCheckBoolean(detail);
}

function isMailError(value: unknown) {
  return typeof value === "string" && (/\[\s*line\b[^\]]*\]\s*::\s*\S+/i.test(value) || /connection\s*failed|connection refused|timeout|exception/i.test(value));
}
function validNumber(key: CheckFieldKey, value: unknown) {
  const number = readCheckNumber(value);
  if (number === null || number < 0 || ((key.endsWith("Percent")) && number > 100) ||
      (key.startsWith("license.") && !Number.isInteger(number))) return null;
  return number;
}
function isAbsent(value: unknown) {
  return value === null || value === undefined || (typeof value === "string" && /^(?:|[-—]|n\/a|null|undefined|unknown)$/i.test(value.trim()));
}
function readPath(data: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = data;
  for (const part of path.split(".")) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}
export function pickCheckValue(data: Record<string, unknown>, paths: string[]): unknown {
  for (const path of paths) { const value = readPath(data, path); if (value !== null && value !== undefined) return value; }
  return undefined;
}
export function readCheckLogData(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") { try { const parsed = JSON.parse(value) as unknown; if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>; } catch { /* malformed logs carry no evidence */ } }
  return {};
}
