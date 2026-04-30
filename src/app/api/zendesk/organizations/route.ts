import type { NextRequest } from "next/server";
import {
  ApiError,
  apiOk,
  assertNonEmptyString,
  requireRole,
  withApiHandler,
} from "@/lib/server/api";
import { enforceMemoryRateLimit } from "@/lib/server/rate-limit";
import { matchZendeskOrganizations, searchZendeskOrganizations } from "@/lib/server/zendesk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "viewer");
    enforceMemoryRateLimit(`zendesk-organizations:${auth.user.id}`, 30, 60_000);

    const query = assertNonEmptyString(
      request.nextUrl.searchParams.get("query"),
      "QUERY_REQUIRED",
      "검색어가 필요합니다.",
    );

    if (query.length < 2) {
      throw new ApiError(400, "QUERY_TOO_SHORT", "검색어는 2자 이상이어야 합니다.");
    }

    if (request.nextUrl.searchParams.get("autoMatch") === "true") {
      const serial = request.nextUrl.searchParams.get("serial")?.trim() || null;
      const result = await matchZendeskOrganizations(query, serial);
      return apiOk(requestId, {
        organizations: result.organizations,
        matchedOrganization: result.match,
        matchMode: result.mode,
        serial: result.serial,
      });
    }

    const organizations = await searchZendeskOrganizations(query);
    return apiOk(requestId, { organizations });
  });
}
