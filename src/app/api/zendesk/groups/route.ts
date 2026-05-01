import type { NextRequest } from "next/server";
import { apiOk, requireRole, withApiHandler } from "@/lib/server/api";
import { writeAuditLog } from "@/lib/server/audit";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { getZendeskGroups } from "@/lib/server/zendesk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "viewer");
    await enforceRateLimit(`zendesk-groups:${auth.user.id}`, 30, 60_000);
    const groups = await getZendeskGroups();

    await writeAuditLog(auth.supabase, auth.user, "zendesk.groups.list", "zendesk_group", null, {
      requestId,
      resultCount: groups.length,
    });

    return apiOk(requestId, { groups });
  });
}
