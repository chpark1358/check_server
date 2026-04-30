import "server-only";

import { ApiError, isRecord } from "@/lib/server/api";
import { isRealZendeskSendAllowed } from "@/lib/env";
import type { ZendeskSettings } from "@/lib/server/settings";

type TicketDraft = {
  idempotencyKey: string;
  subject: string;
  body: string;
  requesterEmail: string | null;
  organizationId: string | null;
  groupId: string | null;
  assigneeEmail: string | null;
  autoSolve: boolean;
  customFields: Array<{ id: string | number; value: string | number | boolean | null }>;
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
  const nameMatches = await requestZendeskOrganizationSearch(new URLSearchParams({ name: query }));

  if (nameMatches.length > 0) {
    return nameMatches;
  }

  return requestZendeskOrganizationSearch(new URLSearchParams({ external_id: query }));
}

async function requestZendeskOrganizationSearch(searchParams: URLSearchParams) {
  const response = await zendeskFetch(`/api/v2/organizations/search.json?${searchParams}`);
  return isRecord(response) && Array.isArray(response.organizations) ? response.organizations : [];
}

export async function getZendeskUsersByOrganization(organizationId: string) {
  if (!/^\d+$/.test(organizationId)) {
    throw new ApiError(400, "INVALID_ORGANIZATION_ID", "Zendesk 조직 ID 형식이 올바르지 않습니다.");
  }

  const encodedOrganizationId = encodeURIComponent(organizationId);
  const response = await zendeskFetch(`/api/v2/organizations/${encodedOrganizationId}/users.json`);
  return isRecord(response) && Array.isArray(response.users) ? response.users : [];
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
  if (!isRealZendeskSendEnabled()) {
    return {
      dryRun: true,
      ticketId: null,
      ticketUrl: null,
      payload: buildZendeskTicketPayload(draft),
    };
  }

  const created = (await zendeskFetch("/api/v2/tickets.json", {
    method: "POST",
    body: JSON.stringify({
      ticket: buildZendeskTicketPayload(draft),
    }),
  })) as ZendeskTicketResponse;

  const ticketId = created.ticket?.id ? String(created.ticket.id) : null;

  if (ticketId && draft.autoSolve) {
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
  return {
    subject: draft.subject,
    comment: {
      body: draft.body,
      uploads: draft.uploadTokens,
    },
    requester: draft.requesterEmail ? { email: draft.requesterEmail } : undefined,
    organization_id: draft.organizationId ?? undefined,
    group_id: draft.groupId ?? undefined,
    assignee_email: draft.assigneeEmail ?? undefined,
    custom_fields: draft.customFields,
  };
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
