import type { NextRequest } from "next/server";
import { ApiError, apiOk, requireRole, withApiHandler } from "@/lib/server/api";
import { parseScheduleQuery, ScheduleDataError } from "@/lib/schedule-data";
import { loadScheduleOverview, scheduleMinimumRole } from "@/lib/server/schedule-source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const response = await withApiHandler(request, async requestId => {
    await requireRole(request,requestId,scheduleMinimumRole());
    let filters;
    try { filters = parseScheduleQuery(request.nextUrl.searchParams); }
    catch (cause) {
      if (cause instanceof ScheduleDataError) throw new ApiError(400,"INVALID_SCHEDULE_FILTER",cause.message);
      throw cause;
    }
    return apiOk(requestId,await loadScheduleOverview(filters));
  });
  response.headers.set("Cache-Control","private, no-store, max-age=0");
  return response;
}
