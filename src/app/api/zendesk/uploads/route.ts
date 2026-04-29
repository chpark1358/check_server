import type { NextRequest } from "next/server";
import { ApiError, apiOk, requireRole, withApiHandler } from "@/lib/server/api";
import { writeAuditLog } from "@/lib/server/audit";
import { enforceMemoryRateLimit } from "@/lib/server/rate-limit";
import { uploadZendeskFile } from "@/lib/server/zendesk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const maxFiles = 5;
const maxFileBytes = 10 * 1024 * 1024;
const maxTotalBytes = 25 * 1024 * 1024;
const allowedExtensions = new Set([
  ".csv",
  ".doc",
  ".docx",
  ".jpeg",
  ".jpg",
  ".log",
  ".pdf",
  ".png",
  ".txt",
  ".xls",
  ".xlsx",
  ".zip",
]);

export function POST(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "operator");
    enforceMemoryRateLimit(`zendesk-upload:${auth.user.id}`, 20, 60_000);
    const formData = await request.formData();
    const files = formData
      .getAll("files")
      .filter((value): value is File => value instanceof File);

    validateFiles(files);

    const uploads = await Promise.all(files.map((file) => uploadZendeskFile(file)));

    await writeAuditLog(auth.supabase, auth.user, "zendesk.uploads.create", "zendesk_upload", null, {
      requestId,
      fileCount: files.length,
      totalBytes: files.reduce((total, file) => total + file.size, 0),
      dryRun: uploads.every((upload) => upload.dryRun),
    });

    return apiOk(
      requestId,
      {
        uploads,
        uploadTokens: uploads.map((upload) => upload.token),
      },
      uploads.every((upload) => upload.dryRun) ? 202 : 201,
    );
  });
}

function validateFiles(files: File[]) {
  if (files.length === 0) {
    throw new ApiError(400, "FILES_REQUIRED", "첨부 파일이 필요합니다.");
  }

  if (files.length > maxFiles) {
    throw new ApiError(400, "TOO_MANY_FILES", `첨부 파일은 최대 ${maxFiles}개까지 가능합니다.`);
  }

  const totalBytes = files.reduce((total, file) => total + file.size, 0);

  if (totalBytes > maxTotalBytes) {
    throw new ApiError(400, "TOTAL_FILE_SIZE_EXCEEDED", "첨부 파일 총 용량은 25MB를 넘을 수 없습니다.");
  }

  for (const file of files) {
    const extension = getExtension(file.name);

    if (!extension || !allowedExtensions.has(extension)) {
      throw new ApiError(400, "FILE_TYPE_NOT_ALLOWED", "허용되지 않은 첨부 파일 형식입니다.");
    }

    if (file.size > maxFileBytes) {
      throw new ApiError(400, "FILE_SIZE_EXCEEDED", "첨부 파일 1개 용량은 10MB를 넘을 수 없습니다.");
    }
  }
}

function getExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
}
