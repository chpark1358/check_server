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
};

type UserPreferences = {
  defaultEngineerName: string;
  defaultServerModel: string;
  defaultIptablesStatus: "auto" | "Y" | "N";
  defaultSendMode: "dry-run" | "real";
  defaultAutoSolved: boolean;
};

const defaultPreferences: UserPreferences = {
  defaultEngineerName: "",
  defaultServerModel: "auto",
  defaultIptablesStatus: "auto",
  defaultSendMode: "dry-run",
  defaultAutoSolved: false,
};

export function GET(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "viewer");
    const { data, error } = await auth.supabase
      .from("user_preferences")
      .select("default_engineer_name,default_server_model,default_iptables_status,default_send_mode,default_auto_solved")
      .eq("user_id", auth.user.id)
      .maybeSingle<UserPreferenceRow>();

    if (error) {
      throw new ApiError(500, "USER_PREFERENCES_LOAD_FAILED", "개인 설정을 불러올 수 없습니다.");
    }

    return apiOk(requestId, { preferences: data ? mapPreferenceRow(data) : defaultPreferences });
  });
}

export function PUT(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "viewer");
    const body = await readJsonObject(request);
    const preferences = normalizePreferences(body.preferences);

    const { data, error } = await auth.supabase
      .from("user_preferences")
      .upsert({
        user_id: auth.user.id,
        default_engineer_name: preferences.defaultEngineerName || null,
        default_server_model: preferences.defaultServerModel,
        default_iptables_status: preferences.defaultIptablesStatus,
        default_send_mode: preferences.defaultSendMode,
        default_auto_solved: preferences.defaultAutoSolved,
        updated_at: new Date().toISOString(),
      })
      .select("default_engineer_name,default_server_model,default_iptables_status,default_send_mode,default_auto_solved")
      .single<UserPreferenceRow>();

    if (error || !data) {
      throw new ApiError(500, "USER_PREFERENCES_SAVE_FAILED", "개인 설정을 저장할 수 없습니다.");
    }

    return apiOk(requestId, { preferences: mapPreferenceRow(data) });
  });
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
  };
}

function mapPreferenceRow(row: UserPreferenceRow): UserPreferences {
  return {
    defaultEngineerName: row.default_engineer_name ?? "",
    defaultServerModel: row.default_server_model || "auto",
    defaultIptablesStatus: ["auto", "Y", "N"].includes(row.default_iptables_status)
      ? (row.default_iptables_status as UserPreferences["defaultIptablesStatus"])
      : "auto",
    defaultSendMode: row.default_send_mode === "real" ? "real" : "dry-run",
    defaultAutoSolved: row.default_auto_solved === true,
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
