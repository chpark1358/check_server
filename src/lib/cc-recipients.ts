export const MAX_CC_RECIPIENTS = 48;
const MAX_CC_INPUT_BYTES = 16 * 1024;

export class CcValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "CcValidationError";
  }
}

export function isPlainEmailAddress(value: string): boolean {
  if (value.length > 254 || /\s/.test(value)) return false;
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;
  const labels = domain.split(".");
  return labels.length >= 2 && labels.every(label =>
    label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
  );
}

export function parseCcEmails(value: unknown, requesterEmail?: string | null): string[] {
  if (value === undefined) return [];
  if (typeof value !== "string" && (!Array.isArray(value) || value.some(item => typeof item !== "string"))) {
    throw new CcValidationError("INVALID_CC_EMAILS", "CC는 이메일 주소를 쉼표·세미콜론·줄바꿈으로 구분해 입력하세요.");
  }
  const inputs: string[] = typeof value === "string" ? [value] : value as string[];
  let bytes = Math.max(0, inputs.length - 1);
  if (bytes > MAX_CC_INPUT_BYTES) tooLarge();
  for (const input of inputs) {
    // Count UTF-8 without a Node-only dependency so form and server share one parser.
    for (const character of input) {
      const point = character.codePointAt(0)!;
      bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
      if (bytes > MAX_CC_INPUT_BYTES) tooLarge();
    }
  }
  const requester = requesterEmail?.trim().toLowerCase();
  const recipients = new Set<string>();
  for (const input of inputs) {
    for (const raw of input.split(/[,;\r\n]/)) {
      const email = raw.trim().toLowerCase();
      if (!email) continue;
      if (!isPlainEmailAddress(email)) {
        throw new CcValidationError("INVALID_CC_EMAILS", "CC에 올바르지 않은 이메일 주소가 있습니다. 이름 없이 이메일 주소만 입력하세요.");
      }
      if (email === requester) continue;
      recipients.add(email);
      if (recipients.size > MAX_CC_RECIPIENTS) {
        throw new CcValidationError("TOO_MANY_CC_RECIPIENTS", `CC는 요청자를 제외하고 최대 ${MAX_CC_RECIPIENTS}개까지 지정할 수 있습니다.`);
      }
    }
  }
  return [...recipients];
}

export function getStoredCcRecipients(row: { cc_emails?: string[] | null }): {
  ccEmails: string[] | null;
  ccEvidence: "recorded" | "legacy";
} {
  if (!Array.isArray(row.cc_emails) || !row.cc_emails.every(email => typeof email === "string" && isPlainEmailAddress(email))) {
    return { ccEmails: null, ccEvidence: "legacy" };
  }
  return { ccEmails: [...row.cc_emails], ccEvidence: "recorded" };
}

function tooLarge(): never {
  throw new CcValidationError("CC_INPUT_TOO_LARGE", "CC 입력은 16 KB 이내로 작성해 주세요.");
}
