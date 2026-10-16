"use client";

import type { Session } from "@supabase/supabase-js";
import type { CheckResult } from "@/components/check-flow/check-flow-panel";

export type PreviewApi = (path: string, init?: RequestInit) => Promise<unknown>;

export const previewSession = {
  access_token: "local-preview-only", refresh_token: "", token_type: "bearer", expires_in: 3600,
  user: {
    id: "00000000-0000-4000-8000-000000000001", email: "operator@demo.example",
    app_metadata: {}, user_metadata: { password_set: true }, aud: "authenticated", created_at: "2026-10-15T00:00:00Z",
  },
} as Session;

const DAY = 86_400_000;
const customers = ["A", "B", "C"].map((letter, index) => ({
  companyId: String(index + 1),
  companyName: "샘플 고객 " + letter,
  serial: "LO0000100" + (index + 1),
  organizationId: String(101 + index),
  requester: { id: String(201 + index), name: "담당자 " + letter, email: "ops-" + letter.toLowerCase() + "@demo.example" },
}));

function customerForSerial(serial: string) {
  const suffix = Number(serial.replace(/\D/g, "").slice(-2)) || 1;
  return customers[(suffix - 1) % customers.length];
}

export function previewCheckResult(serial = "LO00001001"): CheckResult {
  const customer = customerForSerial(serial);
  return {
    companyId: customer.companyId, companyName: customer.companyName, serial,
    softwareName: "오피스키퍼", hardwareType: "VM",
    license: { total: 100, used: 72, unverified: 0 },
    versions: { docker: "1.0.0 (예시)", agentWin: "6.0 (예시)", agentMac: "6.0 (예시)" },
    system: {
      osInfo: "Linux (가상 데이터)", serverModel: "VM", cpuUsagePercent: 24, memTotalGb: 16,
      memUsagePercent: 58, load1: .12, load5: .18, load15: .21,
      checkTime: "2026-10-15T09:00:00+09:00", lastReboot: "2026-10-01",
    },
    disks: {
      root: { mount: "/", size: "100G", used: "42G", usedPercent: 42 },
      home: { mount: "/home", size: "300G", used: "180G", usedPercent: 60 },
      storage: { mount: "/storage", size: "500G", used: "310G", usedPercent: 62 },
    },
    flags: {
      agent: true, mail: true, web: true, httpd: true, mysqld: true, ntp: true,
      iptables: true, firewall: true, backup: true,
    },
    backup: { latest: "2026-10-15", sizeGb: 2.4 }, warnings: [], raw: { preview: true, monthlyReportStatus: "Y (2026-10)", orgSyncStatus: "Y" },
  };
}

const allowedMethods: Record<string, string[]> = {
  "/api/health": ["GET"], "/api/settings/zendesk": ["GET"],
  "/api/user/preferences": ["GET", "PUT"], "/api/user/customer-mappings": ["GET", "PUT"],
  "/api/engineer-signatures": ["GET"], "/api/solution/login": ["POST"],
  "/api/solution/logout": ["POST"], "/api/solution/checkup": ["POST"],
  "/api/documents/check-report": ["POST"], "/api/documents": ["GET"],
  "/api/history/overview": ["GET"], "/api/history/ticket-sends": ["GET"],
  "/api/zendesk/organizations": ["GET"], "/api/zendesk/users": ["GET"],
  "/api/zendesk/uploads/generated": ["POST"], "/api/zendesk/uploads": ["POST"],
  "/api/zendesk/tickets": ["POST"], "/api/zendesk/tickets/preview": ["POST"],
  "/api/admin/overview": ["GET"],
  "/api/zendesk/connection": ["GET", "POST"],
};

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function previewTicket(body: Record<string, unknown>) {
  const email = stringValue(body.requesterEmail);
  return {
    subject: stringValue(body.subject),
    comment: { body: stringValue(body.body), public: true, uploads: Array.isArray(body.uploadTokens) ? body.uploadTokens : [] },
    ...(email ? { requester: { name: stringValue(body.requesterName, email), email } } : {}),
    organization_id: body.organizationId ?? undefined,
    group_id: body.groupId ?? undefined,
    assignee_email: body.assigneeEmail ?? undefined,
    tags: ["정기점검"], custom_fields: [],
  };
}

export function createPreviewApi(): PreviewApi {
  let preferences: Record<string, unknown> = {
    defaultEngineerName: "예시 점검자", defaultServerModel: "auto", defaultIptablesStatus: "auto",
    defaultAgentStatus: "auto", defaultSendMode: "dry-run", defaultAutoSolved: false,
    mailBodyTemplate: "안녕하세요. {{requesterName}} 담당자님.\n정기점검 확인서를 전달드립니다.",
  };
  const first = customers[0];
  let mappings = [{
    id: "10000000-0000-4000-8000-000000000001", companyName: first.companyName, serial: first.serial,
    zendeskOrgId: first.organizationId, requesterName: first.requester.name, requesterEmail: first.requester.email,
    ccEmails: "", defaultEngineerName: "예시 점검자", memo: "가상 데이터",
  }];
  const now = Date.now();
  const makeDocument = (n: number, age: number, failed = false) => {
    const customer = customers[(n - 1) % customers.length];
    return {
      id: "20000000-0000-4000-8000-" + String(n).padStart(12, "0"),
      companyName: customer.companyName, serial: customer.serial,
      engineerName: "예시 점검자", actorEmail: "operator@demo.example",
      createdAt: new Date(now - age * DAY).toISOString(), expiresAt: new Date(now + (30 - age) * DAY).toISOString(),
      docx: { fileName: "정기점검_" + n + ".docx", size: 21500, downloadUrl: "/preview-file" },
      pdf: failed ? null : { fileName: "정기점검_" + n + ".pdf", size: 70200, downloadUrl: "/preview-file", status: "success" },
      pdfStatus: failed ? "failed" : "success", pdfErrorSummary: failed ? "가상 PDF 변환 실패" : null, attachedToMail: n % 2 === 0,
    };
  };
  const documents = Array.from({ length: 8 }, (_, i) => makeDocument(i + 1, i * 8, i === 2));
  const documentCursors = new Map<string, { fingerprint: string; ids: string[]; offset: number }>();
  let documentCursorSequence = 0;
  const history = Array.from({ length: 36 }, (_, i) => ({
    id: "event-" + (i + 1), type: (["check", "document", "mail"] as const)[i % 3],
    action: ["solution.checkup", "document.check_report.generate", "zendesk.ticket.send"][i % 3],
    status: i % 7 === 0 ? "failed" : i % 3 === 2 ? "dry_run" : "success",
    actorEmail: "operator@demo.example", companyName: customers[i % 3].companyName, serial: customers[i % 3].serial,
    title: ["점검 조회", "점검서 생성", "메일 테스트"][i % 3],
    summary: i % 7 === 0 ? "샘플 오류 · 재시도 전 원인 확인" : "가상 데이터로 화면을 확인합니다.",
    targetId: String(i + 1), createdAt: new Date(now - i * 5 * DAY).toISOString(),
  }));
  // JSON snapshots prevent consumers from mutating this adapter's memory through
  // a response object. No fetch, storage or server client exists in this module.
  const wrap = (data: Record<string, unknown>) => ({
    ok: true, requestId: "preview", ...JSON.parse(JSON.stringify(data)) as Record<string, unknown>,
  });
  return async (path, init = {}) => {
    if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const u = new URL(path, "https://preview.invalid");
    const method = (init.method ?? "GET").toUpperCase();
    if (!allowedMethods[u.pathname]?.includes(method)) {
      throw new Error("가상 데이터 화면에서는 이 작업을 실행하지 않습니다.");
    }
    const body = typeof init.body === "string" ? objectValue(JSON.parse(init.body)) : {};

    if (u.pathname === "/api/zendesk/connection") return wrap({
      connection: {configured: true, authentication: "oauth", grantType: "client_credentials", subdomain: "sample", missingKeys: [], scopes: ["read"], grantedScopes: ["read"], accessTokenExpiresAt: null},
      account: {id: "101", name: "예시 업무 계정", email: "team@demo.example", role: "admin"}, verifiedAt: new Date(now).toISOString(), readAccess: "ready",
      capabilities: [
        ["groups", "담당 그룹", "/api/v2/groups.json"], ["organizations", "고객 조직 검색", "/api/v2/organizations/autocomplete.json"],
        ["organizationSearch", "시리얼 기반 조직 검색", "/api/v2/search.json"], ["users", "수신자 조회", "/api/v2/users/search.json"],
        ["ticketHistory", "최근 티켓 이력·수신자 추천", "/api/v2/search.json"], ["ticketFields", "티켓 필드", "/api/v2/ticket_fields.json"],
      ].map(([id, label, endpoint]) => ({id, label, endpoint, status: "available", message: null})),
    });

    if (u.pathname === "/api/health") return wrap({ zendeskSendMode: "dry-run", env: "preview · 가상 데이터", role: "admin" });
    if (u.pathname === "/api/settings/zendesk") return wrap({ settings: { defaultGroupId: "100", defaultGroupName: "예시 운영팀", fixedAssigneeEmail: "team@demo.example", autoSolveDefault: false, fields: {}, defaultValues: {} } });
    if (u.pathname === "/api/user/preferences") {
      if (method === "PUT") {
        const submitted = objectValue(body.preferences);
        preferences = Object.fromEntries(Object.entries(preferences).map(([key, previous]) => [
          key, Object.hasOwn(submitted, key) ? submitted[key] : previous,
        ]));
      }
      return wrap({ preferences });
    }
    if (u.pathname === "/api/user/customer-mappings") {
      if (method === "PUT") {
        if (!Array.isArray(body.mappings)) throw new Error("가상 매핑 목록 형식이 올바르지 않습니다.");
        mappings = body.mappings;
      }
      return wrap({ mappings });
    }
    if (u.pathname === "/api/engineer-signatures") return wrap({ signatures: [
      { name: "예시 점검자", id: "sample-signature", hasSignature: true, updatedAt: new Date(now).toISOString() },
      { name: "이석진", id: "preview:lee-seokjin", hasSignature: true, updatedAt: new Date(now).toISOString() },
    ] });
    if (u.pathname === "/api/solution/login") return wrap({ username: "preview", masked: "가상 CRM", tokenType: "Bearer", ttlSeconds: 3600, expiresAt: new Date(now + 3600000).toISOString() });
    if (u.pathname === "/api/solution/logout") return wrap({});
    if (u.pathname === "/api/solution/checkup") return wrap({ result: previewCheckResult(stringValue(body.serial, first.serial)) });
    if (u.pathname === "/api/documents/check-report") {
      const check = objectValue(body.checkResult);
      const includePdf = objectValue(body.output).pdf !== false;
      const d = {
        ...makeDocument(documents.length + 1, 0), companyName: stringValue(check.companyName, "샘플 고객"),
        serial: stringValue(check.serial, first.serial), attachedToMail: false,
      };
      if (!includePdf) { d.pdf = null; d.pdfStatus = "not_requested"; }
      documents.unshift(d);
      return wrap({ document: { ...d, pdfStatus: { ok: true } }, pdfConverterEnabled: true });
    }
    if (u.pathname === "/api/documents") {
      const q = (u.searchParams.get("q") ?? "").trim().toLowerCase();
      const attached = u.searchParams.get("attached") ?? "all", status = u.searchParams.get("status") ?? "all";
      const expiry = u.searchParams.get("expiry") ?? "all", range = u.searchParams.get("range") ?? "all";
      const rawLimit = Number(u.searchParams.get("limit") ?? 50);
      if (!Number.isSafeInteger(rawLimit) || rawLimit < 1) throw new Error("표시 개수는 양의 정수여야 합니다.");
      const limit = Math.min(rawLimit, 200);
      if (!["all", "true", "false"].includes(attached) || !["all", "pdf_success", "success", "not_requested", "failed", "unavailable"].includes(status) ||
        !["all", "available", "expiring", "expired"].includes(expiry) || !["all", "today", "7d", "30d", "90d", "365d", "custom"].includes(range)) throw new Error("문서 검색 조건을 확인하세요.");
      const fromValue = u.searchParams.get("from"), toValue = u.searchParams.get("to");
      const fingerprint = JSON.stringify({ q, attached, status, expiry, range, limit, fromValue, toValue });
      const cursor = u.searchParams.get("cursor");
      const saved = cursor ? documentCursors.get(cursor) : null;
      if (cursor && (!saved || saved.fingerprint !== fingerprint)) throw new Error("문서 검색 조건이 변경되었습니다. 다시 검색하세요.");
      let from: number | null = null, to: number | null = null;
      if (range === "custom") {
        from = fromValue ? Date.parse(fromValue + "T00:00:00+09:00") : NaN;
        to = toValue ? Date.parse(toValue + "T00:00:00+09:00") + DAY : NaN;
        if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new Error("사용자 지정 기간을 확인하세요.");
      } else if (range !== "all") {
        const today = new Date(now + 9 * 3600000).toISOString().slice(0, 10);
        const days = range === "today" ? 1 : Number(range.slice(0, -1));
        from = Date.parse(today + "T00:00:00+09:00") - (days - 1) * DAY;
        to = Date.parse(today + "T00:00:00+09:00") + DAY;
      }
      let docs = documents.filter(d => (d.companyName + " " + d.serial + " " + d.engineerName + " " + (d.pdfErrorSummary ?? "")).toLowerCase().includes(q) &&
        (from === null || Date.parse(d.createdAt) >= from) && (to === null || Date.parse(d.createdAt) < to));
      if (attached === "true" || attached === "false") docs = docs.filter(d => String(d.attachedToMail) === attached);
      if (status && status !== "all") docs = docs.filter(d => d.pdfStatus === (status === "pdf_success" ? "success" : status));
      if (expiry === "expired") docs = docs.filter(d => Date.parse(d.expiresAt) <= now);
      if (expiry === "available" || expiry === "expiring") docs = docs.filter(d => Date.parse(d.expiresAt) > now);
      if (expiry === "expiring") docs = docs.filter(d => Date.parse(d.expiresAt) <= now + 7 * DAY);
      docs.sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      if (saved) docs = docs.filter(d => saved.ids.includes(d.id));
      const ids = saved?.ids ?? docs.map(d => d.id), offset = saved?.offset ?? 0;
      const storeCursor = (nextOffset: number) => {
        const key = "preview-documents-" + (++documentCursorSequence);
        documentCursors.set(key, { fingerprint, ids, offset: nextOffset });
        if (documentCursors.size > 200) documentCursors.delete(documentCursors.keys().next().value!);
        return key;
      };
      return wrap({ documents: docs.slice(offset, offset + limit), hasMore: offset + limit < docs.length,
        nextCursor: offset + limit < docs.length ? storeCursor(offset + limit) : null,
        startCursor: storeCursor(0), asOf: new Date(now).toISOString(), limit,
        summary: { total: docs.length, pdfReady: docs.filter(d => d.pdfStatus === "success").length, attached: docs.filter(d => d.attachedToMail).length } });
    }
    if (u.pathname === "/api/history/overview") {
      const q = (u.searchParams.get("q") ?? "").trim().toLowerCase();
      const type = u.searchParams.get("type") || "all", status = u.searchParams.get("status") || "all";
      const range = u.searchParams.get("range") || "30d", sort = u.searchParams.get("sort") || "newest";
      const rawLimit = Number(u.searchParams.get("limit") ?? 100);
      if (!Number.isSafeInteger(rawLimit) || rawLimit < 1) throw new Error("표시 개수는 양의 정수여야 합니다.");
      const limit = Math.min(200, rawLimit);
      const kstDate = (time: number) => new Date(time + 9 * 3600000).toISOString().slice(0, 10);
      let from: string | null = null, to: string | null = null;
      if (range === "custom") {
        from = u.searchParams.get("from"); to = u.searchParams.get("to");
        if (!from || !to || !Number.isFinite(Date.parse(from + "T00:00:00+09:00")) || !Number.isFinite(Date.parse(to + "T00:00:00+09:00")) || from > to) throw new Error("사용자 지정 기간을 확인하세요.");
      } else if (range !== "all") {
        const days = range === "today" ? 1 : Number(range.slice(0, -1));
        if (![1, 7, 30, 90, 365].includes(days)) throw new Error("조회 기간을 확인하세요.");
        to = kstDate(now);
        from = kstDate(Date.parse(to + "T00:00:00+09:00") - (days - 1) * DAY);
      }
      let items = history.filter(x =>
        (type === "all" || x.type === type) && (status === "all" || x.status === status) &&
        (x.companyName + " " + x.serial + " " + x.title).toLowerCase().includes(q) &&
        (!from || Date.parse(x.createdAt) >= Date.parse(from + "T00:00:00+09:00")) &&
        (!to || Date.parse(x.createdAt) < Date.parse(to + "T00:00:00+09:00") + DAY),
      );
      if (sort === "oldest") items = [...items].reverse();
      const total = items.length, offset = Number(u.searchParams.get("cursor") || "0");
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("가상 이력 페이지를 확인하세요.");
      return wrap({
        items: items.slice(offset, offset + limit), hasMore: offset + limit < total,
        nextCursor: offset + limit < total ? String(offset + limit) : null,
        appliedFilters: { range, from, to, type, status, q, sort, limit, timezone: "Asia/Seoul", asOf: new Date(now).toISOString() },
        summary: u.searchParams.get("includeSummary") === "false" ? null : {
          checks: items.filter(x => x.type === "check").length, documents: items.filter(x => x.type === "document").length,
          mails: items.filter(x => x.type === "mail").length, failures: items.filter(x => x.status === "failed").length,
        },
      });
    }
    if (u.pathname === "/api/history/ticket-sends") return wrap({ sends: [] });
    if (u.pathname === "/api/zendesk/organizations") {
      const serial = u.searchParams.get("serial")?.trim().toUpperCase() || null;
      const query = (u.searchParams.get("query") ?? "").trim().toLowerCase();
      const matches = serial ? [customerForSerial(serial)] : customers.filter(c =>
        (c.companyName + " " + c.serial + " " + c.organizationId).toLowerCase().includes(query),
      );
      const organizations = matches.map(c => ({ id: c.organizationId, name: c.companyName, matched_serial: serial ?? c.serial }));
      return u.searchParams.get("autoMatch") === "true"
        ? wrap({ organizations, matchedOrganization: organizations[0] ?? null, matchMode: serial ? "serial" : "company", serial })
        : wrap({ organizations });
    }
    if (u.pathname === "/api/zendesk/users") {
      const customer = customers.find(c => c.organizationId === u.searchParams.get("organizationId"));
      return wrap({ users: customer ? [customer.requester] : [] });
    }
    if (u.pathname === "/api/zendesk/uploads/generated") {
      const types = Array.isArray(body.types) ? body.types.filter(type => type === "pdf" || type === "docx") : ["pdf"];
      const uploads = types.map(type => ({ token: "preview-upload-" + type, fileName: "가상_정기점검." + type, type, size: 70200, dryRun: true }));
      return wrap({ documentId: body.documentId ?? null, uploads, uploadTokens: uploads.map(upload => upload.token) });
    }
    if (u.pathname === "/api/zendesk/uploads") return wrap({ uploadTokens: [], uploads: [] });
    if (u.pathname === "/api/zendesk/tickets") return wrap({ dryRun: true, duplicate: false, ticketId: null, ticketUrl: null, autoSolveStatus: "not_requested", autoSolveError: null, previewPayload: previewTicket(body) });
    if (u.pathname === "/api/zendesk/tickets/preview") return wrap({ preview: { dryRunOnly: true, ticket: previewTicket(body) } });
    if (u.pathname === "/api/admin/overview") return wrap({
      summary: { auditEvents24h: 3, documents24h: 2, ticketSends24h: 1, failedTicketSends: 1, pendingInvites: 0 },
      users: [{ id: "preview", email: "operator@demo.example", displayName: "예시 운영자", role: "admin", createdAt: new Date(now).toISOString(), updatedAt: null, invitedAt: null, emailConfirmedAt: new Date(now).toISOString(), lastSignInAt: new Date(now).toISOString() }],
      auditLogs: history.slice(0, 8).map(x => ({
        ...x, actorId: "preview", targetType: x.type, targetId: x.serial,
        metadata: { serial: x.serial, companyName: x.companyName, errorSummary: x.status === "failed" ? x.summary : "" },
      })),
      ticketSends: [], documents, authUserLookupWarning: null,
    });
    throw new Error("가상 데이터 화면에서는 이 작업을 실행하지 않습니다.");
  };
}
