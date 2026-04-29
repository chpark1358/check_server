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
