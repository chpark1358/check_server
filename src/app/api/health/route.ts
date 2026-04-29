import type { NextRequest } from "next/server";
import { apiOk, requireRole, withApiHandler } from "@/lib/server/api";
import { getMissingServerEnv, isRealZendeskSendAllowed } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "viewer");

    return apiOk(requestId, {
      app: "check-server-site",
      env: process.env.NEXT_PUBLIC_APP_ENV ?? "unknown",
      role: auth.role,
      zendeskSendMode: isRealZendeskSendAllowed() ? "real" : "dry-run",
      missingServerEnv: auth.role === "admin" ? getMissingServerEnv() : [],
    });
  });
}
