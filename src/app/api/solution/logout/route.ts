import type { NextRequest } from "next/server";
import { apiOk, requireRole, withApiHandler } from "@/lib/server/api";
import { writeAuditLog } from "@/lib/server/audit";
import { clearSolutionSessionCookies } from "@/lib/server/solution-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const response = await withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "operator");

    await writeAuditLog(auth.supabase, auth.user, "solution.logout", "solution_session", null, {
      requestId,
    });

    return apiOk(requestId, { ok: true });
  });
  // Local credentials must be removed even when app auth has expired or the
  // audit service is unavailable. The response still preserves its error.
  clearSolutionSessionCookies(response);
  return response;
}
