const awsInstanceTypePattern =
  /\b[a-z][a-z0-9]*[0-9][a-z0-9]*\.(?:nano|micro|small|medium|large|xlarge|[0-9]+xlarge|metal)\b/i;

const vmKeywords = [
  "virtual machine",
  "virtual platform",
  "virtualbox",
  "vmware",
  "hyper-v",
  "kvm",
  "qemu",
  "xen",
];

export function inferDocumentServerModel(value: unknown): string {
  const text = normalizeServerModelText(value);
  if (!text || text === "-") {
    return "-";
  }

  const lower = text.toLowerCase();
  if (lower.includes("aws") || lower.includes("amazon ec2") || lower.includes("ec2") || awsInstanceTypePattern.test(text)) {
    return "AWS";
  }

  if (vmKeywords.some((keyword) => lower.includes(keyword)) || /\bvm\b/i.test(text)) {
    return "VM";
  }

  return text;
}

export function normalizeServerModelText(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  return "";
}
