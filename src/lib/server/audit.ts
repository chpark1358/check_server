import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeErrorMetadata } from "@/lib/server/api";

export type AuditActor = {
  id: string;
  email?: string | null;
};

export async function writeAuditLog(
  supabase: SupabaseClient,
  actor: AuditActor,
  action: string,
  targetType: string,
  targetId: string | null,
  metadata: Record<string, unknown> = {},
) {
  const { error } = await supabase.from("audit_logs").insert({
    actor_id: actor.id,
    action,
    target_type: targetType,
    target_id: targetId,
    serial: deriveSerial(metadata, targetId),
    company_name: deriveCompanyName(metadata),
    search_text: buildSearchText(action, targetType, targetId, actor, metadata),
    metadata: sanitizeErrorMetadata({
      actorEmail: actor.email,
      ...metadata,
    }),
  });

  if (error) {
    console.error(
      JSON.stringify({
        level: "warn",
        message: "audit_log_insert_failed",
        action,
        targetType,
        targetId,
        error: error.message,
      }),
    );
  }
}

function deriveSerial(metadata: Record<string, unknown>, targetId: string | null) {
  return stringValue(metadata.serial) || targetId || null;
}

function deriveCompanyName(metadata: Record<string, unknown>) {
  return stringValue(metadata.companyName) || null;
}

function buildSearchText(
  action: string,
  targetType: string,
  targetId: string | null,
  actor: AuditActor,
  metadata: Record<string, unknown>,
) {
  return [
    action,
    targetType,
    targetId,
    actor.email,
    metadata.serial,
    metadata.companyName,
    metadata.companyId,
    metadata.requesterEmail,
    metadata.errorSummary,
  ]
    .map(stringValue)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value).trim()
    : "";
}
