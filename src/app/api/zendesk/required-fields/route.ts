import type { NextRequest } from "next/server";
import { apiOk, requireRole, withApiHandler } from "@/lib/server/api";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { getZendeskSettings } from "@/lib/server/settings";
import { getZendeskTicketFields } from "@/lib/server/zendesk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "viewer");
    await enforceRateLimit(`zendesk-required-fields:${auth.user.id}`, 30, 60_000);
    const [fields, settings] = await Promise.all([
      getZendeskTicketFields(),
      getZendeskSettings(auth.supabase),
    ]);

    return apiOk(requestId, {
      fields,
      configuredFieldIds: settings.fields,
      defaultValues: settings.defaultValues,
    });
  });
}
