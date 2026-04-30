import "server-only";

import { isRecord } from "@/lib/server/api";

export type CheckResultDisk = {
  mount: string;
  size: string;
  used: string;
  usedPercent: number;
};

export type CheckResultFlags = {
  agent: boolean;
  mail: boolean;
  web: boolean;
  httpd: boolean;
  mysqld: boolean;
  ntp: boolean;
  iptables: boolean;
  firewall: boolean;
  backup: boolean;
};

export type CheckResult = {
  companyId: string;
  companyName: string;
  serial: string;
  softwareName: string;
  hardwareType: string;
  license: {
    total: number;
    used: number;
    unverified: number;
  };
  versions: {
    docker: string;
    agentWin: string;
    agentMac: string;
  };
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
    root: CheckResultDisk;
    home: CheckResultDisk;
    storage: CheckResultDisk;
  };
  flags: CheckResultFlags;
  backup: {
    latest: string;
    sizeGb: number;
  };
  warnings: string[];
  raw: Record<string, unknown>;
};

export function normalizeCheckResult(payload: unknown): CheckResult {
  const data = extractDataObject(payload);

  return {
    companyId: pickString(data, ["companyId", "company_id", "company.id"]),
    companyName: pickString(data, ["companyName", "company_name", "company.name"]),
    serial: pickString(data, ["serial", "serialNumber"]),
    softwareName: pickString(data, ["softwareName", "software_name", "productName", "product"]),
    hardwareType: inferHardwareType(
      pickString(data, ["hardwareType", "hardware_type", "model", "serverModel", "server.model"]),
    ),
    license: {
      total: pickNumber(data, ["totalLicence", "total_licence", "license.total"]),
      used: pickNumber(data, ["useLicence", "usedLicence", "used_licence", "license.used"]),
      unverified: pickNumber(data, [
        "uncertifiedLicence",
        "unverifiedLicence",
        "unverified_licence",
        "license.uncertified",
        "license.unverified",
      ]),
    },
    versions: {
      docker: normalizeDockerVersion(pickString(data, ["dockerImageVersion", "dockerVersion", "docker_version"])),
      agentWin: normalizeAgentVersion(
        pickString(data, ["agentVersion", "agentVersionWin", "agent_version_win", "agentWindowsVersion"]),
      ),
      agentMac: pickString(data, ["agentVersionMac", "agent_version_mac", "agentMacVersion"]),
    },
    system: {
      osInfo: pickString(data, ["osInfo", "os_info", "os", "system.osInfo"]),
      serverModel: pickString(data, ["serverModel", "server_model", "server.model"]),
      cpuUsagePercent: pickNumber(data, ["cpuUsage", "cpuUsagePercent", "cpu_usage_percent", "cpu.usagePercent", "system.cpuUsage"]),
      memTotalGb: pickNumber(data, ["totalMemorySize", "memTotalGb", "mem_total_gb", "memory.totalGb", "system.memory.totalGB"]),
      memUsagePercent: pickNumber(data, ["memoryUsage", "memUsagePercent", "mem_usage_percent", "memory.usagePercent", "system.memory.usagePercent"]),
      load1: pickNumber(data, ["loadAvg1Min", "load1", "loadAverage1m", "system.loadAverage.1min"]),
      load5: pickNumber(data, ["loadAvg5Min", "load5", "loadAverage5m", "system.loadAverage.5min"]),
      load15: pickNumber(data, ["loadAvg15Min", "load15", "loadAverage15m", "system.loadAverage.15min"]),
      checkTime: pickString(data, ["checkTime", "check_time", "checkedAt"]),
      lastReboot: pickString(data, ["lastReboot", "last_reboot", "rebootAt", "server.lastReboot"]),
    },
    disks: {
      root: parseDisk(data, "/", "root"),
      home: parseDisk(data, "/home", "home"),
      storage: parseDisk(data, "/storage", "storage"),
    },
    flags: {
      agent: pickBoolean(data, ["agentStatus", "agent_ok", "agentOk", "agent.status"]),
      mail: pickBoolean(data, ["mailServerStatus", "mail_ok", "mailOk"]),
      web: pickBoolean(data, ["webConnectionStatus", "web_ok", "webOk"]),
      httpd: pickBoolean(data, ["httpdStatus", "httpd_ok", "httpdOk", "process.httpd"]),
      mysqld: pickBoolean(data, ["mysqldStatus", "mysqld_ok", "mysqldOk", "process.mysqld"]),
      ntp: pickBoolean(data, ["ntpSyncStatus", "ntp_ok", "ntpOk", "sync.ntp"]),
      iptables: pickBoolean(data, ["iptablesStatus", "iptables_ok", "iptablesOk", "network.iptables"]),
      firewall: normalizeFirewallStatus(data),
      backup: pickBoolean(data, ["backupStatus", "backup_ok", "backupOk"]),
    },
    backup: {
      latest: pickString(data, ["backup_latest", "backupLatest"]),
      sizeGb: pickNumber(data, ["backup_latest_size_gb", "backupLatestSizeGb"]),
    },
    warnings: pickStringArray(data, ["warnings"]),
    raw: data,
  };
}

function extractDataObject(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) {
    return {};
  }
  if (payload.success === false) {
    return payload;
  }
  if (isRecord(payload.data)) {
    return payload.data;
  }
  return payload;
}

function pickValue(data: Record<string, unknown>, paths: string[]): unknown {
  for (const path of paths) {
    let cursor: unknown = data;
    for (const part of path.split(".")) {
      if (!isRecord(cursor)) {
        cursor = undefined;
        break;
      }
      cursor = cursor[part];
    }
    if (cursor !== undefined && cursor !== null) {
      return cursor;
    }
  }
  return undefined;
}

function pickString(data: Record<string, unknown>, paths: string[]): string {
  const value = pickValue(data, paths);
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function pickNumber(data: Record<string, unknown>, paths: string[]): number {
  const value = pickValue(data, paths);
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.\-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function pickBoolean(data: Record<string, unknown>, paths: string[]): boolean {
  const value = pickValue(data, paths);
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return /^(true|y|yes|ok|1|active|running|success|normal|정상)$/i.test(value.trim());
  }
  if (typeof value === "number") {
    return value === 1;
  }
  return false;
}

function pickStringArray(data: Record<string, unknown>, paths: string[]): string[] {
  const value = pickValue(data, paths);
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function parseDisk(data: Record<string, unknown>, defaultMount: string, key: "root" | "home" | "storage"): CheckResultDisk {
  const directorySizeKey = `${key}DirectorySize`;
  const directoryUsageKey = `${key}DirectoryUsage`;
  const formatted = pickString(data, [`${key}_disk_formatted`, `${key}DiskFormatted`]);
  const sizeStr = pickString(data, [directorySizeKey, `disk.${key}.sizeGB`, `disk.${key}.size`]);
  const usedPercent = pickNumber(data, [directoryUsageKey, `disk.${key}.usagePercent`, `disk.${key}.percent`]);
  const usedStr = pickString(data, [`${key}DirectoryUsed`, `disk.${key}.used`]);

  if (formatted) {
    const match =
      formatted.match(/(.+?)\s*\/\s*(\d+)%\s*\(Total\s*:\s*([^)]+)\)/i) ??
      formatted.match(/(\S+)\s+(\S+)\s+\((\d+)%?\)/);
    if (match) {
      if (match.length === 4 && formatted.includes("/")) {
        return {
          mount: defaultMount,
          size: match[3].trim(),
          used: match[1].trim(),
          usedPercent: Number(match[2]) || 0,
        };
      }

      return {
        mount: defaultMount,
        size: match[1],
        used: match[2],
        usedPercent: Number(match[3]) || 0,
      };
    }
  }

  return {
    mount: defaultMount,
    size: sizeStr,
    used: usedStr,
    usedPercent,
  };
}

function normalizeDockerVersion(value: string) {
  if (!value) {
    return "";
  }

  return value.includes(":") ? value.split(":", 2)[1].trim() : value;
}

function normalizeAgentVersion(value: string) {
  if (!value) {
    return "";
  }

  if (value.toUpperCase().startsWith("V")) {
    return value;
  }

  return /^\d+$/.test(value) ? `V${value}` : value;
}

function inferHardwareType(serverModelOrType: string) {
  const text = serverModelOrType.trim();
  if (!text) {
    return "";
  }

  const lower = text.toLowerCase();
  if (["vmware", "virtual", "hyper-v", "kvm", "qemu"].some((word) => lower.includes(word))) {
    return "VM";
  }

  if (["amazon", "aws", "ec2"].some((word) => lower.includes(word))) {
    return "AWS";
  }

  return text;
}

function normalizeFirewallStatus(data: Record<string, unknown>) {
  const explicit = pickBoolean(data, ["firewallStatus", "firewall_ok", "firewallOk", "network.firewall"]);
  const logData = parseLogData(pickValue(data, ["logData"]));
  const detail = String(logData.isFirewallActive ?? "").trim().toLowerCase();

  if (["inactive", "statusnotactive", "notactive", "service not active"].includes(detail)) {
    return true;
  }

  return explicit;
}

function parseLogData(value: unknown) {
  if (isRecord(value)) {
    return value;
  }

  if (typeof value !== "string" || !value.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
