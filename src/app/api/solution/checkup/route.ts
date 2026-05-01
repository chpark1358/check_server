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
import { readSolutionSessionFromRequest } from "@/lib/server/solution-auth";
import { fetchCheckup } from "@/lib/server/solution-checkup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "operator");
    await enforceRateLimit(`solution-checkup:${auth.user.id}`, 30, 60_000);

    const body = await readJsonObject(request);
    const serial = assertNonEmptyString(body.serial, "SERIAL_REQUIRED", "시리얼이 필요합니다.");
    const { token, tokenType } = readSolutionSessionFromRequest(request);

    const { result } = await fetchCheckup(serial, token, tokenType);

    await writeAuditLog(auth.supabase, auth.user, "solution.checkup", "solution_serial", result.serial || serial, {
      requestId,
      companyId: result.companyId,
      companyName: result.companyName,
      warningsCount: result.warnings.length,
    });

    return apiOk(requestId, { result });
  });
}
