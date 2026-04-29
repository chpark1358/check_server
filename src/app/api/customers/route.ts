import type { NextRequest } from "next/server";
import {
  ApiError,
  apiOk,
  optionalString,
  requireRole,
  withApiHandler,
} from "@/lib/server/api";
import { writeAuditLog } from "@/lib/server/audit";
import { enforceMemoryRateLimit } from "@/lib/server/rate-limit";
import { searchCustomers } from "@/lib/server/customers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "viewer");
    enforceMemoryRateLimit(`customers-search:${auth.user.id}`, 30, 60_000);
    const serial = optionalString(request.nextUrl.searchParams.get("serial"));
    const name = optionalString(request.nextUrl.searchParams.get("name"));

    if (!serial && !name) {
      throw new ApiError(400, "CUSTOMER_QUERY_REQUIRED", "시리얼 또는 고객사명이 필요합니다.");
    }

    const customers = await searchCustomers({ serial, name });

    await writeAuditLog(auth.supabase, auth.user, "customers.search", "customer", serial ?? name, {
      requestId,
      serial: serial ? "[provided]" : null,
      name: name ? "[provided]" : null,
    });

    return apiOk(requestId, { customers });
  });
}
