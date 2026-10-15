import type { NextRequest } from "next/server";
import { apiOk, requireRole, withApiHandler } from "@/lib/server/api";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { getZendeskOAuthStatus } from "@/lib/server/zendesk-oauth";
import { getZendeskCurrentUser } from "@/lib/server/zendesk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    await requireRole(request, requestId, "admin");
    const response = apiOk(requestId, { connection: getZendeskOAuthStatus() });
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
}

// An explicit admin action verifies identity with a read-only Zendesk request.
export function POST(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "admin");
    await enforceRateLimit(`zendesk-oauth-check:${auth.user.id}`, 5, 60_000);
    const account = await getZendeskCurrentUser();
    const response = apiOk(requestId, {
      connection: getZendeskOAuthStatus(), account, verifiedAt: new Date().toISOString(),
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
}
