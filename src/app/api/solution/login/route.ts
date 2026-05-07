import type { NextRequest } from "next/server";
import {
  ApiError,
  apiOk,
  assertNonEmptyString,
  readJsonObject,
  requireRole,
  withApiHandler,
} from "@/lib/server/api";
import { writeAuditLog } from "@/lib/server/audit";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { setSolutionSessionCookies, solutionLogin, type SolutionLoginResult } from "@/lib/server/solution-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "operator");
    await enforceRateLimit(`solution-login:${auth.user.id}`, 10, 60_000);

    const body = await readJsonObject(request);
    const username = assertNonEmptyString(body.username, "USERNAME_REQUIRED", "솔루션 아이디가 필요합니다.");
    const password = assertNonEmptyString(body.password, "PASSWORD_REQUIRED", "솔루션 비밀번호가 필요합니다.");

    let session: SolutionLoginResult;
    try {
      session = await solutionLogin(username, password);
    } catch (error) {
      await writeAuditLog(auth.supabase, auth.user, "solution.login_failed", "solution_session", null, {
        requestId,
        solutionUsername: username,
        errorCode: error instanceof ApiError ? error.code : "SOLUTION_LOGIN_FAILED",
        errorSummary: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

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
