import type { NextRequest } from "next/server";
import { apiOk, requireRole, withApiHandler } from "@/lib/server/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "operator");
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? 50), 100);
    const { data, error } = await auth.supabase
      .from("ticket_sends")
      .select(
        "id,sent_by,idempotency_key,zendesk_ticket_id,zendesk_ticket_url,organization_id,requester_email,group_id,assignee_email,subject,attachment_count,auto_solved,status,error_summary,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(Number.isFinite(limit) && limit > 0 ? limit : 50);

    if (error) {
      throw new Error(error.message);
    }

    return apiOk(requestId, { sends: data ?? [] });
  });
}
