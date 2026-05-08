import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiOk, requireRole, withApiHandler } from "@/lib/server/api";
import { buildDocumentDisplayFileName } from "@/lib/server/document-storage";

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
    const params = request.nextUrl.searchParams;
    const limit = normalizeLimit(params.get("limit"));
    const q = normalizeQuery(params.get("q"));
    const attached = params.get("attached");
    const status = params.get("status");

    const [documentsResult, totalCount, pdfReadyCount, attachedCount] = await Promise.all([
      buildDocumentsQuery(auth.supabase, auth.user.id, { q, attached, status }, false).limit(limit),
      runCount(buildDocumentsQuery(auth.supabase, auth.user.id, { q, attached, status }, true)),
      runCount(buildDocumentsQuery(auth.supabase, auth.user.id, { q, attached, status: "pdf_success" }, true)),
      runCount(buildDocumentsQuery(auth.supabase, auth.user.id, { q, attached: "true", status }, true)),
    ]);

    if (documentsResult.error) {
      throw new Error(documentsResult.error.message);
    }

    const documents = ((documentsResult.data ?? []) as GeneratedDocumentRow[]).map((row) => ({
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
      summary: {
        total: totalCount,
        pdfReady: pdfReadyCount,
        attached: attachedCount,
      },
    });
  });
}

function buildDocumentsQuery(
  supabase: SupabaseClient,
  userId: string,
  filters: { q: string; attached: string | null; status: string | null },
  countOnly: boolean,
) {
  let query = supabase
    .from("generated_documents")
    .select(
      "id,created_by,company_name,serial,engineer_name,docx_path,pdf_path,pdf_status,pdf_error_summary,attached_to_mail,created_at,expires_at",
      countOnly ? { count: "exact", head: true } : undefined,
    )
    .eq("created_by", userId)
    .order("created_at", { ascending: false });

  if (filters.attached === "true" || filters.attached === "false") {
    query = query.eq("attached_to_mail", filters.attached === "true");
  }
  if (filters.status && filters.status !== "all") {
    query = filters.status === "pdf_success" ? query.eq("pdf_status", "success") : query.eq("pdf_status", filters.status);
  }
  if (filters.q) {
    const value = escapeFilterValue(filters.q);
    if (value) {
      query = query.or(`company_name.ilike.%${value}%,serial.ilike.%${value}%,engineer_name.ilike.%${value}%,pdf_error_summary.ilike.%${value}%`);
    }
  }
  return query;
}

async function runCount(query: ReturnType<typeof buildDocumentsQuery>) {
  const { count, error } = await query;
  if (error) {
    throw new Error(error.message);
  }
  return count ?? 0;
}

function normalizeLimit(value: string | null) {
  const parsed = Number(value ?? 100);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 100;
}

function normalizeQuery(value: string | null) {
  return (value ?? "").trim().toLowerCase();
}

function escapeFilterValue(value: string) {
  return value.replace(/[%,]/g, " ").trim();
}
