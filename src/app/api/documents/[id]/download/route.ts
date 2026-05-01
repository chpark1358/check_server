import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ApiError, requireRole, withApiHandler } from "@/lib/server/api";
import { writeAuditLog } from "@/lib/server/audit";
import { createSignedDocumentUrl } from "@/lib/server/document-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type GeneratedDocumentRow = {
  id: string;
  created_by: string;
  company_name: string;
  serial: string;
  docx_path: string;
  pdf_path: string | null;
  pdf_status: "success" | "failed" | "unavailable" | "not_requested";
  expires_at: string;
};

export function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "viewer");
    const { id } = await context.params;
    if (!isUuid(id)) {
      throw new ApiError(400, "INVALID_DOCUMENT_ID", "문서 ID 형식이 올바르지 않습니다.");
    }

    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    if (type !== "docx" && type !== "pdf") {
      throw new ApiError(400, "INVALID_DOCUMENT_TYPE", "type 파라미터는 docx 또는 pdf여야 합니다.");
    }

    const { data, error } = await auth.supabase
      .from("generated_documents")
      .select("id, created_by, company_name, serial, docx_path, pdf_path, pdf_status, expires_at")
      .eq("id", id)
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
      throw new ApiError(403, "FORBIDDEN", "이 문서를 다운로드할 권한이 없습니다.");
    }

    if (Date.parse(data.expires_at) <= Date.now()) {
      throw new ApiError(410, "GENERATED_DOCUMENT_EXPIRED", "이 문서는 만료되었습니다.");
    }

    const storageKey = type === "docx" ? data.docx_path : data.pdf_path;
    if (!storageKey) {
      throw new ApiError(404, "GENERATED_DOCUMENT_TYPE_UNAVAILABLE", "이 형식의 문서가 없습니다.");
    }

    const fileName = storageKey.split("/").pop() ?? `document.${type}`;
    const signedUrl = await createSignedDocumentUrl(auth.supabase, storageKey, fileName);

    await writeAuditLog(auth.supabase, auth.user, "document.check_report.download", "document", data.id, {
      requestId,
      type,
    });

    return NextResponse.redirect(signedUrl, 302);
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
