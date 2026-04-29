import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, isRecord } from "@/lib/server/api";

export type ZendeskSettings = {
  defaultGroupId: string | null;
  defaultGroupName: string | null;
  fixedAssigneeEmail: string | null;
  autoSolveDefault: boolean;
  fields: Record<string, string | number>;
  defaultValues: Record<string, string>;
  supportAddress: string | null;
};

const SETTINGS_KEY = "zendesk";

export function getDefaultZendeskSettings(): ZendeskSettings {
  return {
    defaultGroupId: process.env.ZENDESK_DEFAULT_GROUP_ID ?? null,
    defaultGroupName: process.env.ZENDESK_DEFAULT_GROUP_NAME ?? null,
    fixedAssigneeEmail:
      process.env.ZENDESK_FIXED_ASSIGNEE_EMAIL ?? process.env.ZENDESK_EMAIL ?? null,
    autoSolveDefault: false,
    fields: {},
    defaultValues: {},
    supportAddress: process.env.ZENDESK_SUPPORT_ADDRESS ?? null,
  };
}

export async function getZendeskSettings(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle<{ value: unknown }>();

  if (error) {
    throw new ApiError(500, "SETTINGS_LOOKUP_FAILED", "Zendesk 설정을 불러올 수 없습니다.");
  }

  return normalizeZendeskSettings(data?.value);
}

export async function saveZendeskSettings(
  supabase: SupabaseClient,
  value: unknown,
  updatedBy: string,
) {
  const settings = normalizeZendeskSettings(value);
  const { error } = await supabase.from("app_settings").upsert({
    key: SETTINGS_KEY,
    value: settings,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw new ApiError(500, "SETTINGS_SAVE_FAILED", "Zendesk 설정을 저장할 수 없습니다.");
  }

  return settings;
}

export function normalizeZendeskSettings(value: unknown): ZendeskSettings {
  const defaults = getDefaultZendeskSettings();

  if (!isRecord(value)) {
    return defaults;
  }

  return {
    defaultGroupId: stringOrNull(value.defaultGroupId) ?? defaults.defaultGroupId,
    defaultGroupName: stringOrNull(value.defaultGroupName) ?? defaults.defaultGroupName,
    fixedAssigneeEmail: stringOrNull(value.fixedAssigneeEmail) ?? defaults.fixedAssigneeEmail,
    autoSolveDefault:
      typeof value.autoSolveDefault === "boolean"
        ? value.autoSolveDefault
        : defaults.autoSolveDefault,
    fields: normalizeStringRecord(value.fields, defaults.fields),
    defaultValues: normalizeStringOnlyRecord(value.defaultValues, defaults.defaultValues),
    supportAddress: stringOrNull(value.supportAddress) ?? defaults.supportAddress,
  };
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeStringRecord(
  value: unknown,
  fallback: Record<string, string | number>,
) {
  if (!isRecord(value)) {
    return fallback;
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string | number] => {
      const [, entryValue] = entry;
      return typeof entryValue === "string" || typeof entryValue === "number";
    }),
  );
}

function normalizeStringOnlyRecord(
  value: unknown,
  fallback: Record<string, string>,
) {
  if (!isRecord(value)) {
    return fallback;
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => {
      const [, entryValue] = entry;
      return typeof entryValue === "string";
    }),
  );
}
