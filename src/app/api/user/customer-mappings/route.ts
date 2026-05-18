import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import {
  ApiError,
  apiOk,
  isRecord,
  readJsonObject,
  requireRole,
  withApiHandler,
} from "@/lib/server/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CustomerMailMapping = {
  id: string;
  companyName: string;
  serial: string;
  zendeskOrgId: string;
  requesterName: string;
  requesterEmail: string;
  ccEmails: string;
  defaultEngineerName: string;
  memo: string;
};

type CustomerMailMappingRow = {
  id: string;
  company_name: string | null;
  serial: string | null;
  zendesk_org_id: string | null;
  requester_name: string | null;
  requester_email: string | null;
  cc_emails: string | null;
  default_engineer_name: string | null;
  memo: string | null;
};

const mappingColumns =
  "id,company_name,serial,zendesk_org_id,requester_name,requester_email,cc_emails,default_engineer_name,memo";

export function GET(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "viewer");
    const { data, error } = await auth.supabase
      .from("customer_mail_mappings")
      .select(mappingColumns)
      .eq("user_id", auth.user.id)
      .order("updated_at", { ascending: false })
      .limit(200);

    if (error) {
      if (isMissingTableError(error)) {
        return apiOk(requestId, { mappings: [] });
      }
      throw new ApiError(500, "CUSTOMER_MAPPINGS_LOAD_FAILED", "고객사 담당자 매핑을 불러올 수 없습니다.");
    }

    return apiOk(requestId, { mappings: ((data ?? []) as CustomerMailMappingRow[]).map(mapRow) });
  });
}

export function PUT(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "viewer");
    const body = await readJsonObject(request);
    const mappings = normalizeMappings(body.mappings);

    if (mappings.length > 200) {
      throw new ApiError(400, "TOO_MANY_CUSTOMER_MAPPINGS", "고객사 담당자 매핑은 최대 200개까지 저장할 수 있습니다.");
    }

    if (await tableMissing(auth.supabase, auth.user.id)) {
      return apiOk(requestId, { mappings });
    }

    const { error: deleteError } = await auth.supabase
      .from("customer_mail_mappings")
      .delete()
      .eq("user_id", auth.user.id);

    if (deleteError) {
      throw new ApiError(500, "CUSTOMER_MAPPINGS_SAVE_FAILED", "고객사 담당자 매핑을 저장할 수 없습니다.");
    }

    if (mappings.length > 0) {
      const now = new Date().toISOString();
      const { error: insertError } = await auth.supabase.from("customer_mail_mappings").insert(
        mappings.map((mapping) => ({
          id: mapping.id,
          user_id: auth.user.id,
          company_name: mapping.companyName,
          company_name_key: normalizeCompanyKey(mapping.companyName),
          serial: mapping.serial,
          serial_key: normalizeSerialKey(mapping.serial),
          zendesk_org_id: mapping.zendeskOrgId,
          requester_name: mapping.requesterName,
          requester_email: mapping.requesterEmail,
          cc_emails: mapping.ccEmails,
          default_engineer_name: mapping.defaultEngineerName,
          memo: mapping.memo,
          last_used_at: now,
          updated_at: now,
        })),
      );

      if (insertError) {
        throw new ApiError(500, "CUSTOMER_MAPPINGS_SAVE_FAILED", "고객사 담당자 매핑을 저장할 수 없습니다.");
      }
    }

    const { data, error } = await auth.supabase
      .from("customer_mail_mappings")
      .select(mappingColumns)
      .eq("user_id", auth.user.id)
      .order("updated_at", { ascending: false })
      .limit(200);

    if (error) {
      throw new ApiError(500, "CUSTOMER_MAPPINGS_SAVE_FAILED", "고객사 담당자 매핑을 저장할 수 없습니다.");
    }

    return apiOk(requestId, { mappings: ((data ?? []) as CustomerMailMappingRow[]).map(mapRow) });
  });
}

async function tableMissing(supabase: SupabaseClient, userId: string) {
  const { error } = await supabase
    .from("customer_mail_mappings")
    .select("id")
    .eq("user_id", userId)
    .limit(1);
  return isMissingTableError(error);
}

function normalizeMappings(value: unknown): CustomerMailMapping[] {
  if (!Array.isArray(value)) {
    throw new ApiError(400, "INVALID_CUSTOMER_MAPPINGS", "고객사 담당자 매핑 형식이 올바르지 않습니다.");
  }

  const nextMappings: CustomerMailMapping[] = [];
  const seenSerials = new Set<string>();
  const seenCompanies = new Set<string>();

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const mapping = normalizeMapping(item);
    const serialKey = normalizeSerialKey(mapping.serial);
    const companyKey = normalizeCompanyKey(mapping.companyName);

    if (!mapping.zendeskOrgId || !mapping.requesterEmail || (!serialKey && !companyKey)) {
      continue;
    }
    if ((serialKey && seenSerials.has(serialKey)) || (!serialKey && companyKey && seenCompanies.has(companyKey))) {
      continue;
    }

    if (serialKey) {
      seenSerials.add(serialKey);
    }
    if (companyKey) {
      seenCompanies.add(companyKey);
    }
    nextMappings.push(mapping);
  }

  return nextMappings;
}

function normalizeMapping(item: Record<string, unknown>): CustomerMailMapping {
  return {
    id: validUuid(item.id) ? String(item.id) : crypto.randomUUID(),
    companyName: stringValue(item.companyName),
    serial: normalizeSerialDisplay(item.serial),
    zendeskOrgId: stringValue(item.zendeskOrgId),
    requesterName: stringValue(item.requesterName),
    requesterEmail: stringValue(item.requesterEmail),
    ccEmails: stringValue(item.ccEmails),
    defaultEngineerName: stringValue(item.defaultEngineerName),
    memo: stringValue(item.memo),
  };
}

function mapRow(row: CustomerMailMappingRow): CustomerMailMapping {
  return {
    id: row.id,
    companyName: row.company_name ?? "",
    serial: row.serial ?? "",
    zendeskOrgId: row.zendesk_org_id ?? "",
    requesterName: row.requester_name ?? "",
    requesterEmail: row.requester_email ?? "",
    ccEmails: row.cc_emails ?? "",
    defaultEngineerName: row.default_engineer_name ?? "",
    memo: row.memo ?? "",
  };
}

function normalizeSerialDisplay(value: unknown) {
  const digits = stringValue(value).replace(/^LO/i, "").replace(/\D/g, "");
  return digits ? `LO${digits}` : "";
}

function normalizeSerialKey(value: string) {
  return value.replace(/^LO/i, "").replace(/\D/g, "");
}

function normalizeCompanyKey(value: string) {
  return value.trim().toLowerCase();
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isMissingTableError(error: { code?: string; message?: string } | null) {
  return error?.code === "42P01" || error?.message?.includes("customer_mail_mappings") === true;
}
