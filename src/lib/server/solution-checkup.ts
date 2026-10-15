import "server-only";

import { ApiError, isRecord } from "@/lib/server/api";
import { normalizeCheckResult, type CheckResult } from "@/lib/server/check-result";

const SERIAL_PATTERN = /^LO\d{4,}$/i;

// Match the aliases supported by normalizeCheckResult. A serial/company-only
// response is not collected check data, while numeric zero and boolean false
// are legitimate measurements and must not be rejected as empty.
const COLLECTED_DATA_PATHS = [
  "totalLicence", "total_licence", "license.total", "useLicence", "usedLicence", "used_licence", "license.used",
  "uncertifiedLicence", "unverifiedLicence", "unverified_licence", "license.uncertified", "license.unverified",
  "dockerImageVersion", "dockerVersion", "docker_version", "agentVersion", "agentVersionWin", "agent_version_win",
  "agentWindowsVersion", "agentVersionMac", "agent_version_mac", "agentMacVersion",
  "checkOsVersion", "osVersion", "osInfo", "os_info", "os", "system.osInfo",
  "cpuUsage", "cpuUsagePercent", "cpu_usage_percent", "cpu.usagePercent", "system.cpuUsage",
  "totalMemorySize", "memTotalGb", "mem_total_gb", "memory.totalGb", "system.memory.totalGB",
  "memoryUsage", "memUsagePercent", "mem_usage_percent", "memory.usagePercent", "system.memory.usagePercent",
  "loadAvg1Min", "load1", "loadAverage1m", "system.loadAverage.1min",
  "loadAvg5Min", "load5", "loadAverage5m", "system.loadAverage.5min",
  "loadAvg15Min", "load15", "loadAverage15m", "system.loadAverage.15min",
  ...["root", "home", "storage"].flatMap((disk) => [
    `${disk}DirectorySize`, `${disk}DirectoryUsage`, `${disk}DirectoryUsed`, `${disk}_disk_formatted`, `${disk}DiskFormatted`,
    `disk.${disk}.sizeGB`, `disk.${disk}.size`, `disk.${disk}.usagePercent`, `disk.${disk}.percent`, `disk.${disk}.used`,
  ]),
  "agentStatus", "agent_ok", "agentOk", "agent.status", "mailServerStatus", "mail_ok", "mailOk",
  "webConnectionStatus", "web_ok", "webOk", "httpdStatus", "httpd_ok", "httpdOk", "process.httpd",
  "mysqldStatus", "mysqld_ok", "mysqldOk", "process.mysqld", "ntpSyncStatus", "ntp_ok", "ntpOk", "sync.ntp",
  "iptablesStatus", "iptables_ok", "iptablesOk", "network.iptables", "firewallStatus", "firewall_ok", "firewallOk", "network.firewall",
  "backupStatus", "backup_ok", "backupOk", "backup_latest", "backupLatest", "backup_latest_size_gb", "backupLatestSizeGb",
];
const COLLECTED_LOG_PATHS = ["checkOsVersion", "osVersion", "osInfo", "getLastRebootRecord", "isFirewallActive", "checkMailServer"];

export type CheckupFetchResult = {
  result: CheckResult;
  rawPayload: unknown;
};

export async function fetchCheckup(
  serial: string,
  token: string,
  tokenType = "Bearer",
): Promise<CheckupFetchResult> {
  const baseUrl = process.env.SOLUTION_API_BASE_URL;

  if (!baseUrl) {
    throw new ApiError(500, "SOLUTION_API_NOT_CONFIGURED", "솔루션 연동 정보가 설정되지 않았습니다.");
  }

  const trimmedSerial = serial.trim().toUpperCase();
  if (!SERIAL_PATTERN.test(trimmedSerial)) {
    throw new ApiError(400, "SERIAL_INVALID", "시리얼은 LO + 4자리 이상 숫자 형식이어야 합니다.");
  }

  const url = new URL(`/api/solution/checkup/${encodeURIComponent(trimmedSerial)}`, baseUrl);
  url.searchParams.set("_ts", String(Date.now()));

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `${tokenType} ${token}`,
        "cache-control": "no-cache, no-store, must-revalidate",
        pragma: "no-cache",
        expires: "0",
      },
      cache: "no-store",
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "warn",
        message: "solution_checkup_network_failed",
        serial: trimmedSerial,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw new ApiError(502, "SOLUTION_API_UNREACHABLE", "솔루션 서버에 연결할 수 없습니다.");
  }

  const payload = await readJsonSafe(response);

  if (response.status === 401) {
    throw new ApiError(401, "SOLUTION_TOKEN_EXPIRED", "솔루션 로그인 시간이 만료되었습니다. 다시 로그인하세요.");
  }

  if (!response.ok) {
    const detail = classifyCheckupFailure(payload, response.status);
    console.error(
      JSON.stringify({
        level: "warn",
        message: "solution_checkup_failed",
        status: response.status,
        serial: trimmedSerial,
        errorCode: detail.code,
      }),
    );
    throw new ApiError(detail.status, detail.code, detail.message);
  }

  validateCheckupPayload(payload, trimmedSerial);
  const result = normalizeCheckResult(payload);
  result.serial = trimmedSerial;

  return {
    result,
    rawPayload: payload,
  };
}

function validateCheckupPayload(payload: unknown, requestedSerial: string) {
  if (!isRecord(payload)) {
    throw invalidResponse();
  }
  // HTTP 200 is not sufficient: CRM can return an application-level failure.
  const data = isRecord(payload.data) ? payload.data : payload;
  for (const envelope of data === payload ? [payload] : [payload, data]) {
    if (isFailureEnvelope(envelope)) {
      const status = failureStatus(envelope);
      const failure = classifyCheckupFailure(envelope, status);
      throw new ApiError(failure.status, failure.code, failure.message);
    }
  }
  // A present data wrapper must contain an object, never null/array/text.
  if (Object.hasOwn(payload, "data") && !isRecord(payload.data)) {
    throw invalidResponse();
  }
  const serial = data.serial ?? data.serialNumber;
  if (typeof serial !== "string" || !SERIAL_PATTERN.test(serial.trim())) {
    throw new ApiError(502, "SOLUTION_CHECKUP_IDENTITY_MISSING", "점검 응답에 유효한 시리얼이 없어 결과를 사용할 수 없습니다. 다시 조회하세요.");
  }
  if (serial.trim().toUpperCase() !== requestedSerial) {
    throw new ApiError(502, "SOLUTION_CHECKUP_SERIAL_MISMATCH", "요청한 시리얼과 점검 응답의 시리얼이 다릅니다. 결과를 적용하지 않았습니다. 다시 조회하세요.");
  }
  const logData = readLogData(data.logData);
  if (!COLLECTED_DATA_PATHS.some((path) => hasCollectedValue(data, path)) &&
      !COLLECTED_LOG_PATHS.some((path) => hasCollectedValue(logData, path))) {
    throw new ApiError(502, "SOLUTION_CHECKUP_DATA_EMPTY", "해당 시리얼의 수집된 점검 항목이 비어 있습니다. 결과를 적용하지 않았습니다. 수집 상태를 확인하세요.");
  }
}

function invalidResponse() {
  return new ApiError(502, "SOLUTION_CHECKUP_INVALID_RESPONSE", "솔루션 서버에서 올바른 점검 데이터를 받지 못했습니다. 다시 조회하세요.");
}

function hasCollectedValue(data: Record<string, unknown>, path: string) {
  let value: unknown = data;
  for (const part of path.split(".")) {
    if (!isRecord(value)) return false;
    value = value[part];
  }
  return typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && value.trim().length > 0);
}

function readLogData(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (isRecord(parsed)) return parsed;
    } catch { /* An unreadable log is not evidence of collected data. */ }
  }
  return {};
}

function isFailureEnvelope(payload: Record<string, unknown>) {
  const error = payload.error;
  const explicitError = error !== undefined && error !== null && error !== false && error !== "" && error !== 0;
  const errorCode = payload.errorCode ?? payload.error_code;
  const hasErrorCode = errorCode !== undefined && errorCode !== null &&
    !/^(?:|0|200|ok|success)$/i.test(String(errorCode).trim());
  const code = String(payload.code ?? "");
  const status = String(payload.status ?? "");
  return payload.success === false || payload.ok === false || explicitError || hasErrorCode ||
    /^(?:error|failed|failure)$/i.test(status) ||
    /unauthori[sz]ed|forbidden|permission|not.?found|no.?data|expired|rate.?limit|error|failed/i.test(code) ||
    (/^\d{3}$/.test(code) && Number(code) >= 400) ||
    (/^\d{3}$/.test(status) && Number(status) >= 400);
}

function failureStatus(payload: Record<string, unknown>) {
  const nestedError = isRecord(payload.error) ? payload.error : {};
  const value = Number(payload.status ?? payload.statusCode ?? payload.code ?? payload.errorCode ?? payload.error_code ?? nestedError.status ?? nestedError.code);
  return Number.isInteger(value) && value >= 400 && value <= 599 ? value : 502;
}

function classifyCheckupFailure(payload: unknown, status: number) {
  const code = extractPayloadCode(payload);
  const message = extractPayloadMessage(payload);
  const text = `${code} ${message}`.toLowerCase();

  if (status === 401 || /unauthori[sz]ed|token.*expired|expired.*token|인증.*만료|토큰.*만료/.test(text)) {
    return {
      status: 401,
      code: "SOLUTION_TOKEN_EXPIRED",
      message: "솔루션 로그인 시간이 만료되었습니다. 다시 로그인하세요.",
    };
  }

  if (status === 400) {
    return {
      status: 400,
      code: code || "SOLUTION_CHECKUP_BAD_REQUEST",
      message: "점검 데이터 조회 요청 형식이 올바르지 않습니다. 시리얼을 확인하세요.",
    };
  }

  if (status === 403 || /forbidden|permission|권한/.test(text)) {
    return {
      status: 403,
      code: code || "SOLUTION_CHECKUP_FORBIDDEN",
      message: "해당 계정에 점검 데이터 조회 권한이 없습니다.",
    };
  }

  if (status === 404 || /not.*found|missing|no.*data|없/.test(text)) {
    return {
      status: 404,
      code: code || "SOLUTION_CHECKUP_NOT_FOUND",
      message: "해당 시리얼의 점검 데이터를 찾을 수 없습니다.",
    };
  }

  if (status === 429 || /too many|rate|limit|요청.*많/.test(text)) {
    return {
      status: 429,
      code: code || "SOLUTION_CHECKUP_RATE_LIMITED",
      message: "점검 데이터 조회 요청이 많습니다. 잠시 후 다시 시도하세요.",
    };
  }

  if (status >= 500) {
    return {
      status: 502,
      code: code || "SOLUTION_CHECKUP_UPSTREAM_FAILED",
      message: "솔루션 서버에서 점검 데이터 조회를 처리하지 못했습니다.",
    };
  }

  return {
    status: 502,
    code: code || "SOLUTION_CHECKUP_FAILED",
    message: "점검 데이터 조회에 실패했습니다. 시리얼과 솔루션 계정을 확인하세요.",
  };
}

function extractPayloadCode(payload: unknown) {
  if (!isRecord(payload)) {
    return "";
  }
  const nestedError = isRecord(payload.error) ? payload.error : {};
  const value = payload.code ?? payload.errorCode ?? payload.error_code ?? nestedError.code ?? payload.error;
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

function extractPayloadMessage(payload: unknown) {
  if (!isRecord(payload)) {
    return "";
  }
  const nestedError = isRecord(payload.error) ? payload.error : {};
  const value = payload.message ?? payload.error_description ?? payload.errorMessage ?? payload.error_message ?? nestedError.message;
  return typeof value === "string" ? value.trim() : "";
}

async function readJsonSafe(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (!text.trim()) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}
