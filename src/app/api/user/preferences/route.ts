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

type UserPreferenceRow = {
  default_engineer_name: string | null;
  default_server_model: string;
  default_iptables_status: string;
  default_send_mode: string;
  default_auto_solved: boolean;
  mail_body_template?: string | null;
};

type UserPreferences = {
  defaultEngineerName: string;
  defaultServerModel: string;
  defaultIptablesStatus: "auto" | "Y" | "N";
  defaultSendMode: "dry-run" | "real";
  defaultAutoSolved: boolean;
  mailBodyTemplate: string;
};

const defaultPreferences: UserPreferences = {
  defaultEngineerName: "",
  defaultServerModel: "auto",
  defaultIptablesStatus: "auto",
  defaultSendMode: "dry-run",
  defaultAutoSolved: false,
  mailBodyTemplate: "",
};

const preferenceColumns =
  "default_engineer_name,default_server_model,default_iptables_status,default_send_mode,default_auto_solved,mail_body_template";
const legacyPreferenceColumns =
  "default_engineer_name,default_server_model,default_iptables_status,default_send_mode,default_auto_solved";

export function GET(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "viewer");
    const result = await loadPreferences(auth.supabase, auth.user.id);

    if (result.error) {
      throw new ApiError(500, "USER_PREFERENCES_LOAD_FAILED", "개인 설정을 불러올 수 없습니다.");
    }

    return apiOk(requestId, { preferences: result.data ? mapPreferenceRow(result.data) : defaultPreferences });
  });
}

export function PUT(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "viewer");
    const body = await readJsonObject(request);
    const preferences = normalizePreferences(body.preferences);
    const result = await savePreferences(auth.supabase, auth.user.id, preferences);

    if (result.error || !result.data) {
      throw new ApiError(500, "USER_PREFERENCES_SAVE_FAILED", "개인 설정을 저장할 수 없습니다.");
    }

    return apiOk(requestId, { preferences: mapPreferenceRow(result.data, preferences.mailBodyTemplate) });
  });
}

async function loadPreferences(supabase: SupabaseClient, userId: string) {
  const result = await supabase
    .from("user_preferences")
    .select(preferenceColumns)
    .eq("user_id", userId)
    .maybeSingle<UserPreferenceRow>();

  if (!isMissingColumnError(result.error)) {
    return result;
  }

  return supabase
    .from("user_preferences")
    .select(legacyPreferenceColumns)
    .eq("user_id", userId)
    .maybeSingle<UserPreferenceRow>();
}

async function savePreferences(supabase: SupabaseClient, userId: string, preferences: UserPreferences) {
  const result = await supabase
    .from("user_preferences")
    .upsert({
      user_id: userId,
      default_engineer_name: preferences.defaultEngineerName || null,
      default_server_model: preferences.defaultServerModel,
      default_iptables_status: preferences.defaultIptablesStatus,
      default_send_mode: preferences.defaultSendMode,
      default_auto_solved: preferences.defaultAutoSolved,
      mail_body_template: preferences.mailBodyTemplate,
      updated_at: new Date().toISOString(),
    })
    .select(preferenceColumns)
    .single<UserPreferenceRow>();

  if (!isMissingColumnError(result.error)) {
    return result;
  }

  return supabase
    .from("user_preferences")
    .upsert({
      user_id: userId,
      default_engineer_name: preferences.defaultEngineerName || null,
      default_server_model: preferences.defaultServerModel,
      default_iptables_status: preferences.defaultIptablesStatus,
      default_send_mode: preferences.defaultSendMode,
      default_auto_solved: preferences.defaultAutoSolved,
      updated_at: new Date().toISOString(),
    })
    .select(legacyPreferenceColumns)
    .single<UserPreferenceRow>();
}

function normalizePreferences(value: unknown): UserPreferences {
  if (!isRecord(value)) {
    throw new ApiError(400, "INVALID_USER_PREFERENCES", "개인 설정 형식이 올바르지 않습니다.");
  }

  return {
    defaultEngineerName: stringValue(value.defaultEngineerName),
    defaultServerModel: stringValue(value.defaultServerModel) || "auto",
    defaultIptablesStatus: ["auto", "Y", "N"].includes(String(value.defaultIptablesStatus))
      ? (value.defaultIptablesStatus as UserPreferences["defaultIptablesStatus"])
      : "auto",
    defaultSendMode: value.defaultSendMode === "real" ? "real" : "dry-run",
    defaultAutoSolved: value.defaultAutoSolved === true,
    mailBodyTemplate: stringValue(value.mailBodyTemplate),
  };
}

function mapPreferenceRow(row: UserPreferenceRow, fallbackMailBodyTemplate = ""): UserPreferences {
  return {
    defaultEngineerName: row.default_engineer_name ?? "",
    defaultServerModel: row.default_server_model || "auto",
    defaultIptablesStatus: ["auto", "Y", "N"].includes(row.default_iptables_status)
      ? (row.default_iptables_status as UserPreferences["defaultIptablesStatus"])
      : "auto",
    defaultSendMode: row.default_send_mode === "real" ? "real" : "dry-run",
    defaultAutoSolved: row.default_auto_solved === true,
    mailBodyTemplate: row.mail_body_template ?? fallbackMailBodyTemplate,
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isMissingColumnError(error: { code?: string; message?: string } | null) {
  return error?.code === "42703" || error?.message?.includes("mail_body_template") === true;
}
