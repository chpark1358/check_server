import { checkFieldIssue, CHECK_FIELD_LABELS, type CheckFieldKey, type CheckResultQuality } from "@/lib/check-result-quality";

type QualityResult = { quality?: CheckResultQuality };

// Automatic batch selection requires actual collected evidence for operational
// decisions, even when a known agent failure or high disk usage is allowed by policy.
// Mail / Firewalld are excluded by the existing batch policy. Optional versions,
// load details and report metadata remain visible without blocking batch selection.
export const REQUIRED_CHECK_FIELDS: readonly CheckFieldKey[] = [
  "license.total", "license.used", "license.unverified",
  "system.cpuUsagePercent", "system.memUsagePercent", "system.memTotalGb",
  "disks.root.usedPercent", "disks.home.usedPercent", "disks.storage.usedPercent",
  "flags.agent", "flags.web", "flags.httpd", "flags.mysqld", "flags.ntp", "flags.iptables", "flags.backup",
];

export function getUnknownRequiredCheckFields(result: QualityResult): CheckFieldKey[] {
  return REQUIRED_CHECK_FIELDS.filter(key => checkFieldIssue(result, key) !== null);
}

export function getUnknownCheckFields(result: QualityResult): CheckFieldKey[] {
  const keys = result.quality ? Object.keys(CHECK_FIELD_LABELS) as CheckFieldKey[] : REQUIRED_CHECK_FIELDS;
  return keys.filter(key => key !== "flags.mail" && checkFieldIssue(result, key) !== null);
}

export function checkFieldIssueLabel(result: QualityResult, key: CheckFieldKey) {
  const issue = checkFieldIssue(result, key);
  return issue === "invalid" ? "확인불가" : issue === "missing" ? "미수집" : null;
}

export function collectedNumberText(result: QualityResult, key: CheckFieldKey, value: number, suffix = "", decimals?: number) {
  const issue = checkFieldIssueLabel(result, key);
  return issue ?? `${decimals === undefined ? value : value.toFixed(decimals)}${suffix}`;
}

export function collectedServiceText(result: QualityResult | null | undefined, name: string, value?: boolean) {
  if (!result) return "조회 전";
  const key = `flags.${name}` as CheckFieldKey;
  return checkFieldIssueLabel(result, key) ?? (value === true ? "정상" : "이상");
}

export function resolveDefaultDocumentFlagOverride(result: QualityResult, name: "agent" | "iptables", preference: "auto" | "Y" | "N"): Partial<Record<"agent" | "iptables", boolean>> {
  if (preference === "auto" || checkFieldIssue(result, `flags.${name}`) !== null) return {};
  return { [name]: preference === "Y" };
}

type BatchCheckResult = QualityResult & {
  flags: Record<string, boolean>;
  warnings: string[];
  license: { total: number; used: number; unverified: number };
  system: { cpuUsagePercent: number; memUsagePercent: number; memTotalGb: number };
  disks: Record<"root" | "home" | "storage", { usedPercent: number }>;
};

export function getBatchCheckReviewReasons(result: BatchCheckResult, options: { ignoreAgent?: boolean; ignoreDiskUsage?: boolean } = {}) {
  const ignoredKeys = new Set(["mail", "mailServer", "firewall", "firewalld", "firewallStatus"]);
  const isAgentKey = (key: string) => /agent|에이전트/.test(key.toLowerCase().replace(/[^a-z0-9가-힣]/g, ""));
  const serviceLabels: Record<string, string> = {
    agent: "에이전트", agentStatus: "에이전트", checkAgentConnection: "에이전트", backup: "백업", docker: "Docker",
    httpd: "웹 서비스", iptables: "방화벽 정책", monthlyReport: "월간 리포트", mysqld: "DB 서비스", ntp: "시간 동기화", orgSync: "조직 동기화", web: "웹 접속",
  };
  const failedServices = Object.entries(result.flags)
    .filter(([key, value]) => !ignoredKeys.has(key) && !(options.ignoreAgent && isAgentKey(key)) &&
      checkFieldIssue(result, `flags.${key}` as CheckFieldKey) === null && !value)
    .map(([key]) => serviceLabels[key] ?? key);
  const warnings = result.warnings.filter(warning => {
    const compact = warning.toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
    return !/mail|smtp|메일/.test(compact) && !(options.ignoreAgent && /agent|에이전트/.test(compact));
  });
  const unknown = getUnknownRequiredCheckFields(result);
  const reasons: string[] = [];
  if (unknown.length) reasons.push(`수집 확인 필요: ${unknown.map(key => CHECK_FIELD_LABELS[key]).join(", ")}`);
  if (failedServices.length) reasons.push(`서비스 확인 필요: ${failedServices.join(", ")}`);
  if (warnings.length) reasons.push(`경고 ${warnings.length}건`);
  if (checkFieldIssue(result, "license.unverified") === null && result.license.unverified > 0 && !options.ignoreAgent) reasons.push(`미인증 라이선스 ${result.license.unverified}건`);
  if (checkFieldIssue(result, "system.cpuUsagePercent") === null && result.system.cpuUsagePercent >= 75) reasons.push(`CPU ${result.system.cpuUsagePercent}%`);
  if (checkFieldIssue(result, "system.memUsagePercent") === null && result.system.memUsagePercent >= 75) reasons.push(`메모리 ${result.system.memUsagePercent}%`);
  const usages = (["root", "home", "storage"] as const)
    .filter(disk => checkFieldIssue(result, `disks.${disk}.usedPercent`) === null)
    .map(disk => result.disks[disk].usedPercent);
  const maxDiskUsage = usages.length ? Math.max(...usages) : null;
  if (maxDiskUsage !== null && maxDiskUsage >= 80 && !options.ignoreDiskUsage) reasons.push(`파티션 최대 ${maxDiskUsage}%`);
  return reasons;
}
