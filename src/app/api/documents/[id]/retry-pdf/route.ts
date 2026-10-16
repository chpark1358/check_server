import type { NextRequest } from "next/server";
import { ApiError, apiOk, requireRole, withApiHandler } from "@/lib/server/api";
import { retryDocumentPdf } from "@/lib/server/document-pdf-retry";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "operator");
    const { id } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new ApiError(400, "INVALID_DOCUMENT_ID", "문서 ID 형식이 올바르지 않습니다.");
    }
    await enforceRateLimit(`document-pdf-retry:${auth.user.id}`, 10, 60_000);
    return apiOk(requestId, await retryDocumentPdf(auth, id));
  });
}
