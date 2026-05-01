import type { NextRequest } from "next/server";
import { apiOk, requireRole, withApiHandler } from "@/lib/server/api";
import { writeAuditLog } from "@/lib/server/audit";
import { clearSolutionSessionCookies } from "@/lib/server/solution-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "operator");

    await writeAuditLog(auth.supabase, auth.user, "solution.logout", "solution_session", null, {
      requestId,
    });

    const response = apiOk(requestId, { ok: true });
    clearSolutionSessionCookies(response);
    return response;
  });
}
