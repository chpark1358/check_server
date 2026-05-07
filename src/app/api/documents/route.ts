import type { NextRequest } from "next/server";
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

type ProfileRow = {
  id: string;
  email: string | null;
};

export function GET(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "operator");
    const params = request.nextUrl.searchParams;
    const limit = normalizeLimit(params.get("limit"));
    const q = (params.get("q") ?? "").trim().toLowerCase();
    const attached = params.get("attached");
    const status = params.get("status");

    let query = auth.supabase
      .from("generated_documents")
      .select(
        "id,created_by,company_name,serial,engineer_name,docx_path,pdf_path,pdf_status,pdf_error_summary,attached_to_mail,created_at,expires_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (auth.role !== "admin") {
      query = query.eq("created_by", auth.user.id);
    }
    if (attached === "true" || attached === "false") {
      query = query.eq("attached_to_mail", attached === "true");
    }
    if (status && status !== "all") {
      query = status === "pdf_success" ? query.eq("pdf_status", "success") : query.eq("pdf_status", status);
    }

    const [documentsResult, profilesResult] = await Promise.all([
      query,
      auth.supabase.from("profiles").select("id,email"),
    ]);

    if (documentsResult.error) {
      throw new Error(documentsResult.error.message);
    }
    if (profilesResult.error) {
      throw new Error(profilesResult.error.message);
    }

    const profiles = (profilesResult.data ?? []) as ProfileRow[];
    const emailById = new Map(profiles.map((profile) => [profile.id, profile.email]));
    const documents = ((documentsResult.data ?? []) as GeneratedDocumentRow[])
      .filter((row) => matchesQuery(q, row))
      .map((row) => ({
        id: row.id,
        createdBy: row.created_by,
        actorEmail: emailById.get(row.created_by) ?? null,
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

    return apiOk(requestId, { documents });
  });
}

function normalizeLimit(value: string | null) {
  const parsed = Number(value ?? 100);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 100;
}

function matchesQuery(query: string, value: unknown) {
  if (!query) {
    return true;
  }
  return JSON.stringify(value).toLowerCase().includes(query);
}
