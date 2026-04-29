import type { NextRequest } from "next/server";
import { apiOk, requireRole, withApiHandler } from "@/lib/server/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "admin");
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? 50), 100);
    const { data, error } = await auth.supabase
      .from("audit_logs")
      .select("id,actor_id,action,target_type,target_id,metadata,created_at")
      .order("created_at", { ascending: false })
      .limit(Number.isFinite(limit) && limit > 0 ? limit : 50);

    if (error) {
      throw new Error(error.message);
    }

    return apiOk(requestId, { auditLogs: data ?? [] });
  });
}
