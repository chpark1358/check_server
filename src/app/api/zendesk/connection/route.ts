import type { NextRequest } from "next/server";
import { apiOk, requireRole, withApiHandler } from "@/lib/server/api";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { getZendeskOAuthStatus } from "@/lib/server/zendesk-oauth";
import { checkZendeskReadCapabilities, getZendeskCurrentUser } from "@/lib/server/zendesk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function verifyConnection(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "admin");
    await enforceRateLimit(`zendesk-oauth-check:${auth.user.id}`, 10, 60_000);
    const configured = getZendeskOAuthStatus().configured;
    // Authentication happens automatically on the server. Never infer feature
    // permissions from users/me alone, and never perform a test write here.
    const account = configured ? await getZendeskCurrentUser() : undefined;
    const capabilities = configured ? await checkZendeskReadCapabilities() : undefined;
    const available = capabilities?.filter(item => item.status === "available").length ?? 0;
    const response = apiOk(requestId, {
      connection: getZendeskOAuthStatus(), account, capabilities,
      ...(capabilities ? {
        readAccess: available === capabilities.length ? "ready" : available ? "partial" : "unavailable",
        verifiedAt: new Date().toISOString(),
      } : {}),
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
}

// The admin panel verifies on mount; POST remains a compatible manual recheck.
export function GET(request: NextRequest) {
  return verifyConnection(request);
}

export function POST(request: NextRequest) {
  return verifyConnection(request);
}
