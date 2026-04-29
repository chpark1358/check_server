import type { NextRequest } from "next/server";
import {
  apiOk,
  assertNonEmptyString,
  requireRole,
  withApiHandler,
} from "@/lib/server/api";
import { enforceMemoryRateLimit } from "@/lib/server/rate-limit";
import { getZendeskUsersByOrganization } from "@/lib/server/zendesk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "viewer");
    enforceMemoryRateLimit(`zendesk-users:${auth.user.id}`, 30, 60_000);

    const organizationId = assertNonEmptyString(
      request.nextUrl.searchParams.get("organizationId"),
      "ORGANIZATION_ID_REQUIRED",
      "조직 ID가 필요합니다.",
    );

    const users = await getZendeskUsersByOrganization(organizationId);
    return apiOk(requestId, { users });
  });
}
