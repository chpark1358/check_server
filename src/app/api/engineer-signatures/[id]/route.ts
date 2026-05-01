import type { NextRequest } from "next/server";
import { ApiError, apiOk, requireRole, withApiHandler } from "@/lib/server/api";
import { writeAuditLog } from "@/lib/server/audit";
import { deleteEngineerSignature } from "@/lib/server/engineer-signatures";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "admin");
    const { id } = await context.params;
    if (!isUuid(id)) {
      throw new ApiError(400, "INVALID_SIGNATURE_ID", "ID 형식이 올바르지 않습니다.");
    }

    await deleteEngineerSignature(auth.supabase, id);

    await writeAuditLog(auth.supabase, auth.user, "engineer_signature.delete", "engineer_signature", id, {
      requestId,
    });

    return apiOk(requestId, { id });
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
