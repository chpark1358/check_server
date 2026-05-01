import type { NextRequest } from "next/server";
import {
  apiOk,
  assertNonEmptyString,
  readJsonObject,
  requireRole,
  withApiHandler,
} from "@/lib/server/api";
import { writeAuditLog } from "@/lib/server/audit";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { setSolutionSessionCookies, solutionLogin } from "@/lib/server/solution-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "operator");
    await enforceRateLimit(`solution-login:${auth.user.id}`, 10, 60_000);

    const body = await readJsonObject(request);
    const username = assertNonEmptyString(body.username, "USERNAME_REQUIRED", "Solution API 아이디가 필요합니다.");
    const password = assertNonEmptyString(body.password, "PASSWORD_REQUIRED", "Solution API 비밀번호가 필요합니다.");

    const session = await solutionLogin(username, password);

    await writeAuditLog(auth.supabase, auth.user, "solution.login", "solution_session", null, {
      requestId,
      solutionUsername: username,
      ttlSeconds: session.ttlSeconds,
    });

    const response = apiOk(requestId, {
      tokenType: session.tokenType,
      expiresAt: session.expiresAt,
      ttlSeconds: session.ttlSeconds,
      masked: session.masked,
      username: session.username,
    });
    setSolutionSessionCookies(response, {
      token: session.token,
      tokenType: session.tokenType,
      ttlSeconds: session.ttlSeconds,
    });
    return response;
  });
}
