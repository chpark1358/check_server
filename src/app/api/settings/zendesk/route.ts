import type { NextRequest } from "next/server";
import {
  apiOk,
  readJsonObject,
  requireRole,
  withApiHandler,
} from "@/lib/server/api";
import { writeAuditLog } from "@/lib/server/audit";
import { getZendeskSettings, saveZendeskSettings } from "@/lib/server/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "viewer");
    const settings = await getZendeskSettings(auth.supabase);
    return apiOk(requestId, { settings });
  });
}

export function POST(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "admin");
    const body = await readJsonObject(request);
    const settings = await saveZendeskSettings(auth.supabase, body, auth.user.id);

    await writeAuditLog(auth.supabase, auth.user, "settings.zendesk.update", "app_setting", "zendesk", {
      requestId,
      defaultGroupId: settings.defaultGroupId,
      fixedAssigneeEmail: settings.fixedAssigneeEmail,
      autoSolveDefault: settings.autoSolveDefault,
    });

    return apiOk(requestId, { settings });
  });
}
