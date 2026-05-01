import type { NextRequest } from "next/server";
import { ApiError, apiOk, requireRole, withApiHandler } from "@/lib/server/api";
import { writeAuditLog } from "@/lib/server/audit";
import { enforceMemoryRateLimit } from "@/lib/server/rate-limit";
import {
  listEngineerSignatures,
  uploadEngineerSignature,
} from "@/lib/server/engineer-signatures";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_SIGNATURE_BYTES = 256 * 1024;

export function GET(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "operator");
    const signatures = await listEngineerSignatures(auth.supabase);
    return apiOk(requestId, {
      signatures: signatures.map((row) => ({
        id: row.id,
        name: row.name,
        updatedAt: row.updated_at,
      })),
    });
  });
}

export function POST(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "admin");
    enforceMemoryRateLimit(`engineer-signature-upload:${auth.user.id}`, 20, 60_000);

    const formData = await request.formData();
    const nameRaw = formData.get("name");
    const fileRaw = formData.get("file");

    if (typeof nameRaw !== "string" || nameRaw.trim().length === 0) {
      throw new ApiError(400, "NAME_REQUIRED", "점검자 이름이 필요합니다.");
    }
    if (!(fileRaw instanceof File)) {
      throw new ApiError(400, "FILE_REQUIRED", "PNG 파일이 필요합니다.");
    }
    if (fileRaw.size === 0) {
      throw new ApiError(400, "FILE_EMPTY", "빈 파일은 업로드할 수 없습니다.");
    }
    if (fileRaw.size > MAX_SIGNATURE_BYTES) {
      throw new ApiError(
        400,
        "FILE_TOO_LARGE",
        `서명 이미지는 ${Math.round(MAX_SIGNATURE_BYTES / 1024)}KB 이하만 허용됩니다.`,
      );
    }
    const fileType = (fileRaw.type || "").toLowerCase();
    if (fileType && fileType !== "image/png") {
      throw new ApiError(400, "FILE_TYPE_NOT_ALLOWED", "PNG 이미지만 업로드할 수 있습니다.");
    }
    const fileName = fileRaw.name.toLowerCase();
    if (!fileName.endsWith(".png")) {
      throw new ApiError(400, "FILE_TYPE_NOT_ALLOWED", "PNG 이미지만 업로드할 수 있습니다.");
    }

    const buffer = Buffer.from(await fileRaw.arrayBuffer());
    const row = await uploadEngineerSignature(auth.supabase, nameRaw, buffer, auth.user.id);

    await writeAuditLog(auth.supabase, auth.user, "engineer_signature.upload", "engineer_signature", row.id, {
      requestId,
      name: row.name,
    });

    return apiOk(requestId, {
      signature: {
        id: row.id,
        name: row.name,
        updatedAt: row.updated_at,
      },
    });
  });
}
