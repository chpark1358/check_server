import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, isRecord } from "@/lib/server/api";
import { CcValidationError, isPlainEmailAddress, parseCcEmails } from "@/lib/cc-recipients";

const fields = [
  "companyName", "serial", "zendeskOrgId", "requesterName", "requesterEmail",
  "ccEmails", "defaultEngineerName", "memo",
] as const;

export type CustomerMailMapping = { id: string } & Record<typeof fields[number], string>;
export type CustomerMappingsState = { mappings: CustomerMailMapping[]; revision: string };
export type CustomerMappingsReplacement = CustomerMappingsState & { allowEmpty: boolean };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const revisionPattern = /^[0-9a-f]{64}$/;

export function parseCustomerMappingsReplacement(body: Record<string, unknown>): CustomerMappingsReplacement {
  if (typeof body.expectedRevision !== "string" || !revisionPattern.test(body.expectedRevision)) {
    throw new ApiError(428, "CUSTOMER_MAPPINGS_REVISION_REQUIRED", "최신 매핑 목록을 불러온 뒤 다시 저장해 주세요.");
  }
  if (body.allowEmpty !== undefined && typeof body.allowEmpty !== "boolean") invalidMappings();
  if (!Array.isArray(body.mappings)) invalidMappings();
  if (body.mappings.length > 200) {
    throw new ApiError(400, "TOO_MANY_CUSTOMER_MAPPINGS", "고객사 담당자 매핑은 최대 200개까지 저장할 수 있습니다.");
  }
  if (body.mappings.length === 0 && body.allowEmpty !== true) {
    throw new ApiError(400, "EMPTY_CUSTOMER_MAPPINGS_CONFIRMATION_REQUIRED", "모든 매핑 삭제 여부를 확인해 주세요.");
  }

  const seenIds = new Set<string>();
  const seenSerials = new Set<string>();
  const seenCompaniesWithoutSerial = new Set<string>();
  const mappings = body.mappings.map((item): CustomerMailMapping => {
    if (!isRecord(item) || typeof item.id !== "string" || !uuidPattern.test(item.id)) invalidMappings();
    const id = item.id.toLowerCase();
    if (seenIds.has(id)) invalidMappings();
    seenIds.add(id);
    const values = {} as Record<typeof fields[number], string>;
    for (const field of fields) {
      const value = item[field];
      if (typeof value !== "string" || value.length > 8192 || value.includes("\0")) invalidMappings();
      values[field] = value.trim();
    }
    const serialKey = values.serial.replace(/^LO/i, "").replace(/\D/g, "");
    if (values.serial && !serialKey) invalidMappings();
    values.serial = serialKey ? `LO${serialKey}` : "";
    const companyKey = values.companyName.toLowerCase();
    if (!values.zendeskOrgId || !values.requesterEmail || (!serialKey && !companyKey)) invalidMappings();
    try {
      const ccEmails = parseCcEmails(values.ccEmails, values.requesterEmail);
      if (ccEmails.length && !isPlainEmailAddress(values.requesterEmail)) {
        throw new ApiError(400, "INVALID_REQUESTER_EMAIL", "참조 주소가 있는 매핑의 요청자 이메일을 확인하세요.");
      }
      values.ccEmails = ccEmails.join(", ");
    } catch (error) {
      if (error instanceof CcValidationError) throw new ApiError(400, error.code, error.message);
      throw error;
    }
    if (serialKey) {
      if (seenSerials.has(serialKey)) invalidMappings();
      seenSerials.add(serialKey);
    } else {
      if (seenCompaniesWithoutSerial.has(companyKey)) invalidMappings();
      seenCompaniesWithoutSerial.add(companyKey);
    }
    return { id, ...values };
  });
  return { mappings, revision: body.expectedRevision, allowEmpty: body.allowEmpty === true };
}

export async function loadCustomerMappings(supabase: SupabaseClient, userId: string): Promise<CustomerMappingsState> {
  const { data, error } = await supabase.rpc("customer_mail_mappings_state", { p_user_id: userId });
  if (error) throwDatabaseError(error, false);
  return parseState(data);
}

export async function replaceCustomerMappings(
  supabase: SupabaseClient, userId: string, replacement: CustomerMappingsReplacement,
): Promise<CustomerMappingsState> {
  // Only the validated authentication context supplies the owner. Never accept it from the body.
  const { data, error } = await supabase.rpc("replace_customer_mail_mappings", {
    p_user_id: userId,
    p_mappings: replacement.mappings,
    p_expected_revision: replacement.revision,
    p_allow_empty: replacement.allowEmpty,
  });
  if (error) throwDatabaseError(error, true);
  return parseState(data);
}

function parseState(value: unknown): CustomerMappingsState {
  if (!isRecord(value) || !Array.isArray(value.mappings)
    || typeof value.revision !== "string" || !revisionPattern.test(value.revision)
    || value.mappings.some((item) => !isRecord(item) || typeof item.id !== "string"
      || !uuidPattern.test(item.id) || fields.some((field) => typeof item[field] !== "string"))) {
    throw new ApiError(503, "CUSTOMER_MAPPINGS_UNAVAILABLE", "매핑 저장 상태를 확인할 수 없습니다. 목록을 새로 불러와 주세요.");
  }
  return { mappings: value.mappings as CustomerMailMapping[], revision: value.revision };
}

function invalidMappings(): never {
  throw new ApiError(400, "INVALID_CUSTOMER_MAPPINGS", "매핑에 잘못되거나 중복된 항목이 있습니다. 기존 자료는 변경하지 않았습니다.");
}

function throwDatabaseError(error: { code?: string; message?: string }, saving: boolean): never {
  if (["PGRST202", "42883", "42P01"].includes(error.code ?? "")) {
    throw new ApiError(503, "CUSTOMER_MAPPINGS_UNAVAILABLE", "매핑 저장 기능을 준비 중입니다. 입력을 보관하고 잠시 후 다시 시도해 주세요.");
  }
  if (error.code === "PT409") {
    const idConflict = error.message === "CUSTOMER_MAPPING_ID_CONFLICT";
    throw new ApiError(409, idConflict ? "CUSTOMER_MAPPING_ID_CONFLICT" : "CUSTOMER_MAPPINGS_CONFLICT",
      idConflict ? "사용할 수 없는 매핑 ID가 있습니다. 목록을 새로 불러와 주세요."
        : "다른 창에서 매핑이 변경되었습니다. 최신 목록을 확인한 뒤 다시 저장해 주세요.");
  }
  if (error.code === "PT428") {
    throw new ApiError(428, "CUSTOMER_MAPPINGS_REVISION_REQUIRED", "최신 매핑 목록을 불러온 뒤 다시 저장해 주세요.");
  }
  if (error.code === "PT400") invalidMappings();
  throw new ApiError(500, saving ? "CUSTOMER_MAPPINGS_SAVE_FAILED" : "CUSTOMER_MAPPINGS_LOAD_FAILED",
    saving ? "매핑 저장을 확인할 수 없습니다. 입력을 보관하고 최신 목록을 확인해 주세요." : "매핑 목록을 불러올 수 없습니다.");
}
