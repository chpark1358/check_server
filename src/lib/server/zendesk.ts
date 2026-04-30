import "server-only";

import { ApiError, isRecord } from "@/lib/server/api";
import { isRealZendeskSendAllowed } from "@/lib/env";
import type { ZendeskSettings } from "@/lib/server/settings";

type TicketDraft = {
  idempotencyKey: string;
  subject: string;
  body: string;
  requesterName: string | null;
  requesterEmail: string | null;
  organizationId: string | null;
  groupId: string | null;
  assigneeEmail: string | null;
  assigneeId: string | null;
  recipient: string | null;
  autoSolve: boolean;
  customFields: Array<{ id: string | number; value: string | number | boolean | string[] | null }>;
  uploadTokens: string[];
};

type ZendeskTicketResponse = {
  ticket?: {
    id?: number | string;
    url?: string;
  };
};

export async function getZendeskGroups() {
  const response = await zendeskFetch("/api/v2/groups.json");
  return isRecord(response) && Array.isArray(response.groups) ? response.groups : [];
}

export async function getZendeskTicketFields() {
  const response = await zendeskFetch("/api/v2/ticket_fields.json");
  return isRecord(response) && Array.isArray(response.ticket_fields)
    ? response.ticket_fields
    : [];
}

export async function searchZendeskOrganizations(query: string) {
  if (!query.trim()) {
    return [];
  }

  const response = await zendeskFetch(
    `/api/v2/organizations/autocomplete.json?${new URLSearchParams({ name: query })}`,
  );
  return isRecord(response) && Array.isArray(response.organizations)
    ? response.organizations
    : [];
}

export async function matchZendeskOrganizations(companyName: string | null, serial: string | null) {
  const normalizedSerial = normalizeSerial(serial);
  const organizations: Array<Record<string, unknown>> = [];
  let match: Record<string, unknown> | null = null;
  let mode: "serial" | "company" = "company";

  if (normalizedSerial) {
    mode = "serial";
    const serialCandidates = await searchZendeskOrganizationsBySerial(serial ?? "");
    for (const organization of serialCandidates) {
      const enriched = { ...organization };
      const extracted = extractOrgSerial(enriched);
      enriched.matched_serial = extracted;
      organizations.push(enriched);
      if (!match && normalizeSerial(extracted) === normalizedSerial) {
        match = enriched;
      }
    }

    if (match) {
      return { organizations, match, mode, serial };
    }
  }

  const companyCandidates = companyName?.trim()
    ? await searchZendeskOrganizations(companyName.trim())
    : [];
  for (const organization of companyCandidates) {
    const organizationId = getRecordId(organization);
    let detail = organization;
    if (organizationId) {
      detail = (await getZendeskOrganization(organizationId)) ?? organization;
    }
    const enriched = { ...detail };
    const extracted = extractOrgSerial(enriched);
    enriched.matched_serial = extracted;
    organizations.push(enriched);
    if (normalizedSerial && normalizeSerial(extracted) === normalizedSerial) {
      match = enriched;
    }
  }

  return { organizations: dedupeById(organizations), match, mode, serial };
}

export async function getZendeskOrganization(organizationId: string) {
  if (!/^\d+$/.test(organizationId)) {
    throw new ApiError(400, "INVALID_ORGANIZATION_ID", "Zendesk 조직 ID 형식이 올바르지 않습니다.");
  }

  const encodedOrganizationId = encodeURIComponent(organizationId);
  const response = await zendeskFetch(`/api/v2/organizations/${encodedOrganizationId}.json`);
  return isRecord(response) && isRecord(response.organization) ? response.organization : null;
}

async function searchZendeskOrganizationsBySerial(serial: string) {
  const query = `type:organization Serial:${serial.trim()}`;
  const response = await zendeskFetch(`/api/v2/search.json?${new URLSearchParams({ query })}`);
  const results = isRecord(response) && Array.isArray(response.results) ? response.results : [];
  return results.filter((item): item is Record<string, unknown> => {
    return isRecord(item) && (!item.result_type || item.result_type === "organization");
  });
}

export async function getZendeskUsersByOrganization(organizationId: string) {
  if (!/^\d+$/.test(organizationId)) {
    throw new ApiError(400, "INVALID_ORGANIZATION_ID", "Zendesk 조직 ID 형식이 올바르지 않습니다.");
  }

  const [endUsers, tickets] = await Promise.all([
    searchZendeskUsersByOrganization(organizationId, "end-user"),
    searchZendeskTicketsByOrganization(organizationId),
  ]);
  const users = endUsers.length > 0 ? endUsers : await searchZendeskUsersByOrganization(organizationId);
  return rankZendeskUsers(users, tickets);
}

export function buildTicketDraft(
  body: Record<string, unknown>,
  settings: ZendeskSettings,
): TicketDraft {
  const idempotencyKey =
    typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const ticketBody = typeof body.body === "string" ? body.body.trim() : "";

  if (!idempotencyKey || idempotencyKey.length > 120) {
    throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "중복 발송 방지 키가 필요합니다.");
  }

  if (!subject) {
    throw new ApiError(400, "SUBJECT_REQUIRED", "제목이 필요합니다.");
  }

  if (!ticketBody) {
    throw new ApiError(400, "BODY_REQUIRED", "본문이 필요합니다.");
  }

  const customFields = buildConfiguredCustomFields(body, settings);

  const uploadTokens = Array.isArray(body.uploadTokens)
    ? body.uploadTokens.filter((value): value is string => typeof value === "string")
    : [];
  const groupId =
    typeof body.groupId === "string" && body.groupId.trim()
      ? body.groupId.trim()
      : settings.defaultGroupId;
  const assigneeEmail =
    typeof body.assigneeEmail === "string" && body.assigneeEmail.trim()
      ? body.assigneeEmail.trim()
      : settings.fixedAssigneeEmail;

  if (!groupId) {
    throw new ApiError(
      500,
      "ZENDESK_GROUP_NOT_CONFIGURED",
      `Zendesk 그룹 설정이 필요합니다.${settings.defaultGroupName ? ` 현재 그룹명: ${settings.defaultGroupName}` : ""}`,
    );
  }

  if (!assigneeEmail) {
    throw new ApiError(500, "ZENDESK_ASSIGNEE_NOT_CONFIGURED", "Zendesk 담당자 설정이 필요합니다.");
  }

  return {
    idempotencyKey,
    subject,
    body: ticketBody,
    requesterName:
      typeof body.requesterName === "string" && body.requesterName.trim()
        ? body.requesterName.trim()
        : null,
    requesterEmail:
      typeof body.requesterEmail === "string" && body.requesterEmail.trim()
        ? body.requesterEmail.trim()
        : null,
    organizationId:
      typeof body.organizationId === "string" && body.organizationId.trim()
        ? body.organizationId.trim()
        : null,
    groupId,
    assigneeEmail,
    assigneeId: null,
    recipient: settings.supportAddress,
    autoSolve:
      typeof body.autoSolve === "boolean" ? body.autoSolve : settings.autoSolveDefault,
    customFields,
    uploadTokens,
  };
}

export function isRealZendeskSendEnabled() {
  return isRealZendeskSendAllowed();
}

export async function uploadZendeskFile(file: File) {
  if (!isRealZendeskSendEnabled()) {
    return {
      dryRun: true,
      token: `dry-run-${crypto.randomUUID()}`,
      fileName: file.name,
      size: file.size,
    };
  }

  const query = new URLSearchParams({ filename: file.name });
  const response = await zendeskFetch(`/api/v2/uploads.json?${query}`, {
    method: "POST",
    body: Buffer.from(await file.arrayBuffer()),
    headers: {
      "content-type": file.type || "application/octet-stream",
    },
  });

  const upload = isRecord(response) && isRecord(response.upload) ? response.upload : null;
  const token = upload && typeof upload.token === "string" ? upload.token : null;

  if (!token) {
    throw new ApiError(502, "ZENDESK_UPLOAD_FAILED", "Zendesk 첨부 업로드 응답을 확인할 수 없습니다.");
  }

  return {
    dryRun: false,
    token,
    fileName: file.name,
    size: file.size,
  };
}

export async function createZendeskTicket(draft: TicketDraft) {
  const resolvedDraft = isRealZendeskSendEnabled() ? await resolveZendeskTicketDraft(draft) : draft;

  if (!isRealZendeskSendEnabled()) {
    return {
      dryRun: true,
      ticketId: null,
      ticketUrl: null,
      payload: buildZendeskTicketPayload(resolvedDraft),
    };
  }

  const created = (await zendeskFetch("/api/v2/tickets.json", {
    method: "POST",
    body: JSON.stringify({
      ticket: buildZendeskTicketPayload(resolvedDraft),
    }),
  })) as ZendeskTicketResponse;

  const ticketId = created.ticket?.id ? String(created.ticket.id) : null;

  if (ticketId && resolvedDraft.autoSolve) {
    await zendeskFetch(`/api/v2/tickets/${ticketId}.json`, {
      method: "PUT",
      body: JSON.stringify({
        ticket: {
          status: "solved",
        },
      }),
    });
  }

  return {
    dryRun: false,
    ticketId,
    ticketUrl: ticketId ? getZendeskTicketUrl(ticketId) : created.ticket?.url ?? null,
    payload: null,
  };
}

export function buildZendeskTicketPayload(draft: TicketDraft) {
  const customFields = mergeCustomFields([
    ...buildDefaultCustomFields(draft),
    ...draft.customFields,
  ]);

  return {
    subject: draft.subject,
    comment: {
      body: draft.body,
      uploads: draft.uploadTokens,
      public: true,
      author_id: draft.assigneeId ?? undefined,
    },
    requester: draft.requesterEmail
      ? { name: draft.requesterName ?? draft.requesterEmail, email: draft.requesterEmail }
      : undefined,
    organization_id: draft.organizationId ?? undefined,
    group_id: draft.groupId ?? undefined,
    recipient: draft.recipient ?? undefined,
    assignee_id: draft.assigneeId ?? undefined,
    assignee_email: draft.assigneeId ? undefined : draft.assigneeEmail ?? undefined,
    tags: ["정기점검"],
    custom_fields: customFields,
  };
}

async function resolveZendeskTicketDraft(draft: TicketDraft): Promise<TicketDraft> {
  const fixedAssignee = draft.assigneeEmail ? await findZendeskUserByEmail(draft.assigneeEmail) : null;
  const assigneeId = fixedAssignee ? getRecordId(fixedAssignee) : null;

  if (draft.assigneeEmail && !assigneeId) {
    throw new ApiError(
      502,
      "ZENDESK_ASSIGNEE_NOT_FOUND",
      `Zendesk 담당자(${draft.assigneeEmail})를 찾지 못했습니다.`,
    );
  }

  const resolvedDefaultFields = await buildResolvedDefaultCustomFields(draft, assigneeId);
  return {
    ...draft,
    assigneeId,
    customFields: mergeCustomFields([...resolvedDefaultFields, ...draft.customFields]),
  };
}

async function findZendeskUserByEmail(email: string) {
  const query = email.trim();
  if (!query) {
    return null;
  }

  const response = await zendeskFetch(`/api/v2/users/search.json?${new URLSearchParams({ query })}`);
  const users = isRecord(response) && Array.isArray(response.users) ? response.users : [];
  const exact = users.find((user) => {
    return isRecord(user) && String(user.email ?? "").trim().toLowerCase() === query.toLowerCase();
  });

  if (isRecord(exact)) {
    return exact;
  }

  return users.length === 1 && isRecord(users[0]) ? users[0] : null;
}

async function buildResolvedDefaultCustomFields(draft: TicketDraft, assigneeId: string | null) {
  const fields = await Promise.all([
    resolveTicketFieldValue(32000684227225, "오피스키퍼_구축형"),
    resolveTicketFieldValue(31991461954201, "정기점검"),
  ]);
  const customFields: TicketDraft["customFields"] = [
    { id: 32000684227225, value: fields[0] },
    { id: 31991461954201, value: fields[1] },
    { id: 16839628845465, value: draft.body },
  ];

  if (assigneeId) {
    customFields.push({ id: 16839581522713, value: assigneeId });
  }

  return customFields;
}

function buildDefaultCustomFields(draft: TicketDraft) {
  const customFields: TicketDraft["customFields"] = [
    { id: 32000684227225, value: "오피스키퍼_구축형" },
    { id: 31991461954201, value: "정기점검" },
    { id: 16839628845465, value: draft.body },
  ];

  if (draft.assigneeId) {
    customFields.push({ id: 16839581522713, value: draft.assigneeId });
  }

  return customFields;
}

async function resolveTicketFieldValue(fieldId: number, desiredLabel: string) {
  const response = await zendeskFetch(`/api/v2/ticket_fields/${fieldId}.json`);
  const field = isRecord(response) && isRecord(response.ticket_field) ? response.ticket_field : {};
  const type = typeof field.type === "string" ? field.type : "";
  const options = Array.isArray(field.custom_field_options) ? field.custom_field_options : [];
  let value = desiredLabel;

  for (const option of options) {
    if (!isRecord(option)) {
      continue;
    }
    if (option.name === desiredLabel || option.value === desiredLabel) {
      value = String(option.value ?? desiredLabel);
      break;
    }
  }

  return type === "multiselect" ? [value] : value;
}

function mergeCustomFields(fields: TicketDraft["customFields"]) {
  const byId = new Map<string, TicketDraft["customFields"][number]>();
  for (const field of fields) {
    if (field.value === undefined || field.value === null || field.value === "") {
      continue;
    }
    byId.set(String(field.id), field);
  }
  return [...byId.values()];
}

async function searchZendeskUsersByOrganization(organizationId: string, role?: string) {
  const query = role ? `organization_id:${organizationId} role:${role}` : `organization_id:${organizationId}`;
  const response = await zendeskFetch(`/api/v2/users/search.json?${new URLSearchParams({ query })}`);
  return isRecord(response) && Array.isArray(response.users)
    ? response.users.filter((user): user is Record<string, unknown> => isRecord(user))
    : [];
}

async function searchZendeskTicketsByOrganization(organizationId: string) {
  const query = `type:ticket organization_id:${organizationId}`;
  const response = await zendeskFetch(
    `/api/v2/search.json?${new URLSearchParams({ query, per_page: "100" })}`,
  );
  return isRecord(response) && Array.isArray(response.results)
    ? response.results.filter((ticket): ticket is Record<string, unknown> => isRecord(ticket))
    : [];
}

function rankZendeskUsers(users: Array<Record<string, unknown>>, tickets: Array<Record<string, unknown>>) {
  const ranked: Array<Record<string, unknown> & { match_score: number; match_reason: string }> = users
    .map<Record<string, unknown> & { match_score: number; match_reason: string }>((user) => {
      const [score, reason] = scoreZendeskUser(user, tickets);
      return { ...user, match_score: score, match_reason: reason };
    })
    .sort((left, right) => {
      const scoreDiff = Number(right.match_score ?? 0) - Number(left.match_score ?? 0);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      return String(left.name ?? "").localeCompare(String(right.name ?? ""));
    });
  return ranked;
}

function scoreZendeskUser(user: Record<string, unknown>, tickets: Array<Record<string, unknown>>): [number, string] {
  const userId = user.id;
  const email = String(user.email ?? "").trim();
  let score = 0;
  let recentHits = 0;
  let keywordHits = 0;

  for (const ticket of tickets) {
    const weight = ticketRecencyWeight(ticket.created_at);
    const subject = String(ticket.subject ?? "");
    const tags = Array.isArray(ticket.tags) ? ticket.tags : [];
    let keywordBonus = 0;
    if (["정기점검", "오피스키퍼", "확인서"].some((keyword) => subject.includes(keyword))) {
      keywordBonus += 4;
    }
    if (tags.some((tag) => ["정기점검", "오피스키퍼"].some((keyword) => String(tag).includes(keyword)))) {
      keywordBonus += 4;
    }
    if (ticket.requester_id === userId) {
      score += 15 + weight + keywordBonus;
      recentHits += 1;
      if (keywordBonus) {
        keywordHits += 1;
      }
    }
    if (ticket.submitter_id === userId && ticket.requester_id !== userId) {
      score += 10 + weight + keywordBonus;
      recentHits += 1;
      if (keywordBonus) {
        keywordHits += 1;
      }
    }
  }

  const penalty = genericContactPenalty(user);
  score += penalty;
  if (email && penalty === 0) {
    score += 2;
  }

  const reasons: string[] = [];
  if (recentHits) {
    reasons.push(`최근이력 ${recentHits}건`);
  }
  if (keywordHits) {
    reasons.push(`관련티켓 ${keywordHits}건`);
  }
  if (penalty < 0) {
    reasons.push("공용계정 감점");
  }
  return [score, reasons.length > 0 ? reasons.join(", ") : "이력 없음"];
}

function genericContactPenalty(user: Record<string, unknown>) {
  const text = `${String(user.name ?? "")} ${String(user.email ?? "")}`.toLowerCase();
  const weakPatterns = [
    "admin",
    "info",
    "support",
    "help",
    "cs",
    "sales",
    "office",
    "manager",
    "master",
    "group",
    "team",
    "service",
    "관리자",
    "대표",
    "공용",
    "부관리자",
  ];
  let penalty = weakPatterns.some((pattern) => text.includes(pattern)) ? -20 : 0;
  const localPart = String(user.email ?? "").split("@", 1)[0].toLowerCase();
  if (["admin", "info", "cs", "support", "sales", "master"].includes(localPart)) {
    penalty -= 15;
  }
  return penalty;
}

function ticketRecencyWeight(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) {
    return 1;
  }
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) {
    return 1;
  }
  const days = Math.max(Math.floor((Date.now() - timestamp) / 86_400_000), 0);
  if (days <= 30) {
    return 12;
  }
  if (days <= 90) {
    return 8;
  }
  if (days <= 180) {
    return 4;
  }
  return 1;
}

function extractOrgSerial(organization: Record<string, unknown>) {
  for (const key of ["serial", "Serial", "serial_number", "serialNumber"]) {
    const value = organization[key];
    if (value) {
      return String(value).trim();
    }
  }

  const fields = organization.organization_fields;
  if (isRecord(fields)) {
    for (const [key, value] of Object.entries(fields)) {
      if (value && key.toLowerCase().includes("serial")) {
        return String(value).trim();
      }
    }
  }

  return "";
}

function normalizeSerial(value: unknown) {
  return String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function getRecordId(record: unknown) {
  return isRecord(record) && (typeof record.id === "string" || typeof record.id === "number")
    ? String(record.id)
    : null;
}

function dedupeById(records: Array<Record<string, unknown>>) {
  const result: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const record of records) {
    const id = getRecordId(record) ?? JSON.stringify(record);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(record);
  }
  return result;
}

async function zendeskFetch(path: string, init: RequestInit = {}) {
  const subdomain = process.env.ZENDESK_SUBDOMAIN;
  const email = process.env.ZENDESK_EMAIL;
  const token = process.env.ZENDESK_API_TOKEN;

  if (!subdomain || !email || !token) {
    throw new ApiError(500, "ZENDESK_NOT_CONFIGURED", "Zendesk 연동 정보가 설정되지 않았습니다.");
  }

  const response = await fetch(`https://${subdomain}.zendesk.com${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from(`${email}/token:${token}`).toString("base64")}`,
      ...init.headers,
    },
    cache: "no-store",
  });

  const data = await parseJson(response);

  if (!response.ok) {
    const summary = summarizeZendeskError(data);
    console.error(
      JSON.stringify({
        level: "warn",
        message: "zendesk_request_failed",
        path,
        status: response.status,
        response: summary,
      }),
    );

    if (response.status === 401 || response.status === 403) {
      throw new ApiError(
        502,
        "ZENDESK_AUTH_FAILED",
        "Zendesk 인증에 실패했습니다. Vercel 환경변수의 ZENDESK_EMAIL/ZENDESK_API_TOKEN 값을 확인하세요.",
      );
    }

    throw new ApiError(
      response.status === 429 ? 429 : 502,
      "ZENDESK_REQUEST_FAILED",
      summary?.description || summary?.error || "Zendesk 요청을 처리할 수 없습니다.",
    );
  }

  return data;
}

async function parseJson(response: Response) {
  const text = await response.text();
  return text ? (JSON.parse(text) as unknown) : {};
}

function summarizeZendeskError(data: unknown) {
  if (!isRecord(data)) {
    return null;
  }

  return {
    error: typeof data.error === "string" ? data.error : undefined,
    description: typeof data.description === "string" ? data.description : undefined,
  };
}

function getZendeskTicketUrl(ticketId: string) {
  const subdomain = process.env.ZENDESK_SUBDOMAIN;
  return subdomain ? `https://${subdomain}.zendesk.com/agent/tickets/${ticketId}` : null;
}

function buildConfiguredCustomFields(
  body: Record<string, unknown>,
  settings: ZendeskSettings,
): TicketDraft["customFields"] {
  const fieldValues = isRecord(body.fieldValues) ? body.fieldValues : {};

  return Object.entries(settings.fields)
    .map<TicketDraft["customFields"][number] | null>(([name, id]) => {
      const value = fieldValues[name] ?? settings.defaultValues[name];

      if (
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim().length === 0)
      ) {
        return null;
      }

      return { id, value: String(value) };
    })
    .filter((value): value is TicketDraft["customFields"][number] => value !== null);
}
