import type { NextRequest } from "next/server";
import {
  apiOk,
  readJsonObject,
  requireRole,
  withApiHandler,
} from "@/lib/server/api";
import {
  loadCustomerMappings,
  parseCustomerMappingsReplacement,
  replaceCustomerMappings,
} from "@/lib/server/customer-mappings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "viewer");
    return apiOk(requestId, await loadCustomerMappings(auth.supabase, auth.user.id));
  });
}

export function PUT(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "viewer");
    const body = await readJsonObject(request);
    const replacement = parseCustomerMappingsReplacement(body);
    return apiOk(requestId, await replaceCustomerMappings(auth.supabase, auth.user.id, replacement));
  });
}
