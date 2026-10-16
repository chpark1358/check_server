import type { NextRequest } from "next/server";
import { ApiError, apiOk, requireRole, withApiHandler } from "@/lib/server/api";
import { buildDocumentDisplayFileName } from "@/lib/server/document-storage";
import { buildDocumentsQuery, createDocumentCursor, DocumentQueryError, parseDocumentQuery, type DocumentQuery } from "@/lib/server/document-query";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type GeneratedDocumentRow = {
  id: string;
  created_by: string;
  company_name: string;
  serial: string;
  engineer_name: string | null;
  docx_path: string;
  pdf_path: string | null;
  pdf_status: string;
  pdf_error_summary: string | null;
  attached_to_mail: boolean;
  created_at: string;
  expires_at: string;
};

export function GET(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "operator");
    const signingKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!signingKey) throw new Error("Document cursor signing is not configured.");
    let criteria: DocumentQuery;
    try { criteria = parseDocumentQuery(request.nextUrl.searchParams, auth.user.id, signingKey); }
    catch (error) {
      if (error instanceof DocumentQueryError) throw new ApiError(400, error.code, error.message);
      throw error;
    }
    const limit = criteria.history.filters.limit;

    // Four bounded queries at most. Counts use the same predicates as the page,
    // excluding only its keyset cursor, so they cover all matching documents.
    const [documentsResult, totalCount, pdfReadyCount, attachedCount] = await Promise.all([
      buildDocumentsQuery(auth.supabase, auth.user.id, criteria).limit(limit + 1),
      runCount(buildDocumentsQuery(auth.supabase, auth.user.id, criteria, true)),
      criteria.status !== "all" && criteria.status !== "success" ? 0 :
        runCount(buildDocumentsQuery(auth.supabase, auth.user.id, { ...criteria, status: "success" }, true)),
      criteria.attached === "false" ? 0 :
        runCount(buildDocumentsQuery(auth.supabase, auth.user.id, { ...criteria, attached: "true" }, true)),
    ]);

    if (documentsResult.error) {
      throw new Error(documentsResult.error.message);
    }

    const rows = (documentsResult.data ?? []) as GeneratedDocumentRow[];
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const documents = page.map((row) => ({
      id: row.id,
      createdBy: row.created_by,
      actorEmail: null,
      companyName: row.company_name,
      serial: row.serial,
      engineerName: row.engineer_name,
      pdfStatus: row.pdf_status,
      pdfErrorSummary: row.pdf_error_summary,
      attachedToMail: row.attached_to_mail,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      docx: {
        fileName: buildDocumentDisplayFileName(row.company_name, row.created_at, "docx"),
        size: 0,
        downloadUrl: `/api/documents/${row.id}/download?type=docx`,
      },
      pdf: row.pdf_path
        ? {
            fileName: buildDocumentDisplayFileName(row.company_name, row.created_at, "pdf"),
            size: 0,
            downloadUrl: `/api/documents/${row.id}/download?type=pdf`,
            status: "success" as const,
          }
        : null,
    }));

    return apiOk(requestId, {
      documents,
      hasMore,
      nextCursor: hasMore && last ? createDocumentCursor(criteria, { id: last.id, createdAt: last.created_at }, signingKey) : null,
      startCursor: createDocumentCursor(criteria, null, signingKey),
      asOf: criteria.history.filters.asOf,
      limit,
      summary: {
        total: totalCount,
        pdfReady: pdfReadyCount,
        attached: attachedCount,
      },
    });
  });
}

async function runCount(query: ReturnType<typeof buildDocumentsQuery>) {
  const { count, error } = await query;
  if (error) {
    throw new Error(error.message);
  }
  if (count === null || !Number.isSafeInteger(count) || count < 0) {
    throw new ApiError(502, "DOCUMENT_COUNT_UNAVAILABLE", "문서 집계 결과를 확인할 수 없습니다. 다시 조회하세요.");
  }
  return count;
}
