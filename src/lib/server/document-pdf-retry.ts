import "server-only";

import { ApiError, type AuthContext } from "@/lib/server/api";
import { writeAuditLog } from "@/lib/server/audit";
import {
  convertDocxToPdf,
  isPdfConverterEnabled,
  PdfConverterError,
  PdfConverterUnavailable,
} from "@/lib/server/document-converter";
import {
  assertDocumentStorageKey,
  buildDocumentDisplayFileName,
  deleteDocumentObjects,
  documentContentType,
  downloadDocumentObject,
  GENERATED_DOCUMENTS_BUCKET,
  uploadDocumentObject,
} from "@/lib/server/document-storage";

// Longer than the route's 300-second maximum execution time. No background retries.
export const PDF_RETRY_LEASE_MS = 15 * 60_000;
const COLUMNS = "id,created_by,company_name,serial,docx_path,pdf_path,pdf_status,pdf_error_summary,created_at,expires_at,pdf_retry_token,pdf_retry_started_at";
type DocumentRow = {
  id: string;
  created_by: string;
  company_name: string;
  serial: string;
  docx_path: string;
  pdf_path: string | null;
  pdf_status: "success" | "failed" | "unavailable" | "not_requested";
  pdf_error_summary: string | null;
  created_at: string;
  expires_at: string;
  pdf_retry_token: string | null;
  pdf_retry_started_at: string | null;
};
type PdfStatus = { ok: true } | { ok: false; code: string; message: string };

export async function retryDocumentPdf(auth: AuthContext, id: string) {
  let document = await loadDocument(auth, id);
  assertAccess(auth, document);
  if (document.pdf_path && document.pdf_status === "success") {
    return readyResponse(auth, document);
  }
  if (document.pdf_path || document.pdf_status === "success") {
    throw new ApiError(409, "PDF_DOCUMENT_STATE_CONFLICT", "PDF 저장 상태를 확인해야 합니다. 기존 파일을 덮어쓰지 않았습니다.");
  }

  const token = crypto.randomUUID();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - PDF_RETRY_LEASE_MS).toISOString();
  const { data: claimed, error: claimError } = await auth.supabase
    .from("generated_documents")
    .update({ pdf_retry_token: token, pdf_retry_started_at: now.toISOString() })
    .eq("id", id).eq("created_by", document.created_by)
    .is("pdf_path", null).neq("pdf_status", "success")
    .gt("expires_at", now.toISOString())
    .or(`pdf_retry_token.is.null,pdf_retry_started_at.lt.${staleBefore}`)
    .select(COLUMNS).maybeSingle<DocumentRow>();
  if (claimError) throw databaseError(claimError, "PDF_RETRY_CLAIM_FAILED", "PDF 재시도를 시작할 수 없습니다.");
  if (!claimed) {
    document = await loadDocument(auth, id);
    assertAccess(auth, document);
    if (document.pdf_path && document.pdf_status === "success") return readyResponse(auth, document);
    await audit(auth, document, "in_progress");
    throw new ApiError(409, "PDF_RETRY_IN_PROGRESS", "이 문서의 PDF 변환이 이미 진행 중입니다. 완료 후 새로고침해 주세요. 중단된 작업은 시작 15분 후 다시 시도할 수 있습니다.");
  }
  await audit(auth, document, document.pdf_retry_token ? "stale_reclaimed" : "started");
  document = claimed;
  let uploadedPath: string | null = null;
  let uploadOutcomeUncertain = false;
  let commitOutcomeUncertain = false;
  let docxSize = 0;
  let failurePersisted = false;

  try {
    assertAccess(auth, document);
    const docx = await downloadDocumentObject(auth.supabase, document.docx_path);
    docxSize = docx.byteLength;
    assertAccess(auth, document);
    let pdf: Buffer;
    try {
      pdf = await convertDocxToPdf(docx, buildDocumentDisplayFileName(document.company_name, document.created_at, "docx"));
      if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
        throw new PdfConverterError("PDF_CONVERTER_INVALID_RESPONSE", "변환 서비스가 올바른 PDF 파일을 반환하지 않았습니다.");
      }
    } catch (error) {
      const status = describeConverterError(error);
      const released = await releaseClaim(auth, document, token, {
        pdf_status: error instanceof PdfConverterUnavailable ? "unavailable" : "failed",
        pdf_error_summary: status.message,
      });
      if (!released) throw new ApiError(409, "PDF_RETRY_CLAIM_LOST", "다른 PDF 재시도 결과가 반영되었습니다. 새로고침으로 문서 상태를 확인해 주세요.");
      failurePersisted = true;
      await audit(auth, document, "failed", { code: status.code, phase: "conversion" });
      return response(document, docxSize, null, status, false);
    }

    assertAccess(auth, document);
    // Unique attempt key: a slow stale worker cannot overwrite a newer worker's PDF.
    const candidatePath = `${document.created_by}/${document.id}/pdf-retries/${token}.pdf`;
    uploadedPath = candidatePath;
    uploadOutcomeUncertain = true;
    await uploadDocumentObject(auth.supabase, candidatePath, pdf, documentContentType("pdf"));
    uploadOutcomeUncertain = false;
    commitOutcomeUncertain = true;
    const { data: saved, error: saveError } = await auth.supabase.from("generated_documents")
      .update({ pdf_path: candidatePath, pdf_status: "success", pdf_error_summary: null,
        pdf_retry_token: null, pdf_retry_started_at: null })
      .eq("id", document.id).eq("pdf_retry_token", token).is("pdf_path", null)
      .gt("expires_at", new Date().toISOString())
      .select(COLUMNS).maybeSingle<DocumentRow>();
    if (saveError) throw databaseError(saveError, "PDF_RETRY_SAVE_FAILED", "PDF 변환 결과의 저장을 확인할 수 없습니다. 새로고침으로 문서 상태를 확인해 주세요.");
    commitOutcomeUncertain = false;
    if (!saved) throw new ApiError(409, "PDF_RETRY_CLAIM_LOST", "문서가 만료되었거나 다른 재시도가 진행 중입니다. 새로고침으로 문서 상태를 확인해 주세요.");
    await audit(auth, saved, "success");
    return response(saved, docxSize, pdf.byteLength, { ok: true }, false);
  } catch (error) {
    // An interrupted UPDATE may still commit after a read-back. Keep the object
    // when the commit outcome is uncertain; explicit reconciliation can remove it.
    if (uploadedPath && (commitOutcomeUncertain || uploadOutcomeUncertain)) {
      await audit(auth, document, "recovery_needed", { phase: commitOutcomeUncertain ? "commit_reconciliation" : "upload_reconciliation", storageKey: uploadedPath });
    } else if (uploadedPath) {
      try {
        const current = await loadDocument(auth, id);
        if (current.pdf_path !== uploadedPath) await deleteDocumentObjects(auth.supabase, [uploadedPath]);
      } catch {
        await audit(auth, document, "recovery_needed", { phase: "storage_reconciliation" });
      }
    }
    if (!failurePersisted) {
      try { await releaseClaim(auth, document, token); }
      catch { await audit(auth, document, "recovery_needed", { phase: "claim_release" }); }
    }
    await audit(auth, document, "failed", { code: error instanceof ApiError ? error.code : "PDF_RETRY_FAILED", phase: "storage_or_commit" });
    throw error;
  }
}

async function loadDocument(auth: AuthContext, id: string): Promise<DocumentRow> {
  const { data, error } = await auth.supabase.from("generated_documents").select(COLUMNS).eq("id", id).maybeSingle<DocumentRow>();
  if (error) throw databaseError(error, "GENERATED_DOCUMENT_LOOKUP_FAILED", "생성 문서를 조회할 수 없습니다.");
  if (!data) throw new ApiError(404, "GENERATED_DOCUMENT_NOT_FOUND", "해당 문서를 찾을 수 없습니다.");
  return data;
}

function assertAccess(auth: AuthContext, document: DocumentRow) {
  if (auth.role !== "admin" && (auth.role !== "operator" || document.created_by !== auth.user.id)) {
    throw new ApiError(403, "FORBIDDEN", "이 문서의 PDF를 다시 생성할 권한이 없습니다.");
  }
  if (!Number.isFinite(Date.parse(document.expires_at)) || Date.parse(document.expires_at) <= Date.now()) {
    throw new ApiError(410, "GENERATED_DOCUMENT_EXPIRED", "이 문서는 만료되었습니다. PDF 재시도는 보관 기간을 연장하지 않습니다.");
  }
  assertDocumentStorageKey(document.docx_path, document, "docx");
  if (document.pdf_path) assertDocumentStorageKey(document.pdf_path, document, "pdf");
}

async function releaseClaim(auth: AuthContext, document: DocumentRow, token: string, values: Record<string, unknown> = {}) {
  const { data, error } = await auth.supabase.from("generated_documents")
    .update({ ...values, pdf_retry_token: null, pdf_retry_started_at: null })
    .eq("id", document.id).eq("pdf_retry_token", token).is("pdf_path", null).select("id").maybeSingle<{ id: string }>();
  if (error) throw databaseError(error, "PDF_RETRY_RELEASE_FAILED", "PDF 재시도 상태 저장을 확인할 수 없습니다. 잠시 후 문서 상태를 확인해 주세요.");
  return Boolean(data);
}

async function readyResponse(auth: AuthContext, document: DocumentRow) {
  const [docxSize, pdfSize] = await Promise.all([objectSize(auth, document.docx_path), objectSize(auth, document.pdf_path!)]);
  await audit(auth, document, "already_ready");
  return response(document, docxSize, pdfSize, { ok: true }, true);
}

async function objectSize(auth: AuthContext, key: string) {
  const { data, error } = await auth.supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).info(key);
  if (error || !data || !Number.isFinite(data.size)) {
    throw new ApiError(502, "DOCUMENT_STORAGE_METADATA_FAILED", "기존 PDF/DOCX 파일 정보를 확인할 수 없습니다. 자동으로 다시 변환하지 않았습니다.");
  }
  return data.size!;
}

function response(document: DocumentRow, docxSize: number, pdfSize: number | null, pdfStatus: PdfStatus, reusedExistingPdf: boolean) {
  const meta = (kind: "docx" | "pdf", size: number) => ({
    fileName: buildDocumentDisplayFileName(document.company_name, document.created_at, kind),
    size, downloadUrl: `/api/documents/${document.id}/download?type=${kind}`,
  });
  return {
    document: { id: document.id, companyName: document.company_name, serial: document.serial,
      createdAt: document.created_at, expiresAt: document.expires_at,
      docx: meta("docx", docxSize), pdf: pdfSize === null ? null : { ...meta("pdf", pdfSize), status: "success" as const }, pdfStatus },
    pdfConverterEnabled: isPdfConverterEnabled(), reusedExistingPdf,
  };
}

function describeConverterError(error: unknown): { ok: false; code: string; message: string } {
  return error instanceof PdfConverterError
    ? { ok: false, code: error.code, message: error.publicMessage }
    : { ok: false, code: "PDF_CONVERSION_UNKNOWN_ERROR", message: "PDF 변환 중 오류가 발생했습니다. DOCX는 그대로 보관됩니다." };
}

function databaseError(error: { code?: string }, code: string, message: string) {
  if (error.code === "42703" || error.code === "PGRST204") {
    return new ApiError(503, "PDF_RETRY_SCHEMA_REQUIRED", "PDF 재시도용 데이터베이스 설정이 필요합니다. 관리자에게 문의해 주세요.");
  }
  return new ApiError(500, code, message);
}

async function audit(auth: AuthContext, document: DocumentRow, outcome: string, details: Record<string, unknown> = {}) {
  await writeAuditLog(auth.supabase, auth.user, `document.check_report.pdf_retry.${outcome}`, "document", document.id,
    { requestId: auth.requestId, companyName: document.company_name, serial: document.serial, ...details });
}
