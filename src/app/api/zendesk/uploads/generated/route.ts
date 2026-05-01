import type { NextRequest } from "next/server";
import { ApiError, apiOk, readJsonObject, requireRole, withApiHandler } from "@/lib/server/api";
import { writeAuditLog } from "@/lib/server/audit";
import { enforceMemoryRateLimit } from "@/lib/server/rate-limit";
import {
  documentContentType,
  downloadDocumentObject,
} from "@/lib/server/document-storage";
import { uploadZendeskFile } from "@/lib/server/zendesk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type GeneratedDocumentRow = {
  id: string;
  created_by: string;
  docx_path: string;
  pdf_path: string | null;
  attached_to_mail: boolean;
  expires_at: string;
};

type AttachmentType = "docx" | "pdf";

export function POST(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "operator");
    enforceMemoryRateLimit(`zendesk-upload-generated:${auth.user.id}`, 20, 60_000);

    const body = await readJsonObject(request);
    const documentId = typeof body.documentId === "string" ? body.documentId.trim() : "";
    if (!isUuid(documentId)) {
      throw new ApiError(400, "INVALID_DOCUMENT_ID", "documentId 형식이 올바르지 않습니다.");
    }
    const requestedTypes = parseTypes(body.types);

    const { data, error } = await auth.supabase
      .from("generated_documents")
      .select("id, created_by, docx_path, pdf_path, attached_to_mail, expires_at")
      .eq("id", documentId)
      .maybeSingle<GeneratedDocumentRow>();
    if (error) {
      throw new ApiError(500, "GENERATED_DOCUMENT_LOOKUP_FAILED", `생성 문서를 조회할 수 없습니다: ${error.message}`);
    }
    if (!data) {
      throw new ApiError(404, "GENERATED_DOCUMENT_NOT_FOUND", "해당 문서를 찾을 수 없습니다.");
    }
    const isOwner = data.created_by === auth.user.id;
    const isAdmin = auth.role === "admin";
    if (!isOwner && !isAdmin) {
      throw new ApiError(403, "FORBIDDEN", "이 문서를 메일에 첨부할 권한이 없습니다.");
    }
    if (Date.parse(data.expires_at) <= Date.now()) {
      throw new ApiError(410, "GENERATED_DOCUMENT_EXPIRED", "이 문서는 만료되었습니다.");
    }

    const targets: Array<{ type: AttachmentType; storageKey: string }> = [];
    for (const type of requestedTypes) {
      const storageKey = type === "docx" ? data.docx_path : data.pdf_path;
      if (!storageKey) {
        if (type === "pdf") {
          // PDF가 없는 케이스는 정상적으로 발생할 수 있어 skip
          continue;
        }
        throw new ApiError(404, "GENERATED_DOCUMENT_TYPE_UNAVAILABLE", `${type.toUpperCase()} 파일이 없습니다.`);
      }
      targets.push({ type, storageKey });
    }
    if (targets.length === 0) {
      throw new ApiError(400, "NO_ATTACHMENT_AVAILABLE", "첨부할 수 있는 생성 문서가 없습니다.");
    }

    const uploads = await Promise.all(
      targets.map(async ({ type, storageKey }) => {
        const buffer = await downloadDocumentObject(auth.supabase, storageKey);
        const fileName = storageKey.split("/").pop() ?? `document.${type}`;
        const file = new File([new Uint8Array(buffer)], fileName, {
          type: documentContentType(type),
        });
        const result = await uploadZendeskFile(file);
        return {
          type,
          token: result.token,
          fileName: result.fileName,
          size: result.size,
          dryRun: result.dryRun,
        };
      }),
    );

    if (!data.attached_to_mail) {
      const { error: updateError } = await auth.supabase
        .from("generated_documents")
        .update({ attached_to_mail: true })
        .eq("id", documentId);
      if (updateError) {
        console.error(
          JSON.stringify({
            level: "warn",
            message: "generated_document_attach_flag_update_failed",
            documentId,
            error: updateError.message,
          }),
        );
      }
    }

    await writeAuditLog(auth.supabase, auth.user, "zendesk.uploads.generated", "generated_document", documentId, {
      requestId,
      types: targets.map((target) => target.type),
      dryRun: uploads.every((upload) => upload.dryRun),
    });

    return apiOk(
      requestId,
      {
        documentId,
        uploads,
        uploadTokens: uploads.map((upload) => upload.token),
      },
      uploads.every((upload) => upload.dryRun) ? 202 : 201,
    );
  });
}

function parseTypes(value: unknown): AttachmentType[] {
  if (!Array.isArray(value)) {
    return ["pdf"];
  }
  const allowed: AttachmentType[] = [];
  for (const item of value) {
    if (item === "docx" || item === "pdf") {
      if (!allowed.includes(item)) {
        allowed.push(item);
      }
    }
  }
  return allowed.length > 0 ? allowed : ["pdf"];
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
