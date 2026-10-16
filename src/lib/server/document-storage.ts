import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/server/api";

export const GENERATED_DOCUMENTS_BUCKET = "generated-documents";
export const ENGINEER_SIGNATURES_BUCKET = "engineer-signatures";
export const SIGNED_URL_TTL_SECONDS = 5 * 60;

export type DocumentObjectKind = "docx" | "pdf";

// Storage 키는 ASCII-only (한글 파일명은 키로 못 씀). 사용자에게 보이는 한글 파일명은
// 다운로드 시점에 buildDocumentDisplayFileName으로 별도 생성합니다.
export function buildDocumentStorageKey(
  userId: string,
  documentId: string,
  kind: DocumentObjectKind,
): string {
  return `${userId}/${documentId}/document.${kind}`;
}

// DB metadata is not an authority to read an arbitrary service-role Storage key.
// Keep the original filename format (including Korean names) and retry subfolders,
// but require every object to remain inside its owner's document namespace.
export function assertDocumentStorageKey(
  storageKey: string,
  document: { id: string; created_by: string },
  kind: DocumentObjectKind,
): void {
  const prefix = `${document.created_by}/${document.id}/`;
  const relative = storageKey.startsWith(prefix) ? storageKey.slice(prefix.length) : "";
  const unsafeSegment = relative.split("/").some((segment) => !segment || segment === "." || segment === "..");
  // Encoded separators/dots and encoded percent can be decoded by an HTTP hop.
  // A literal percent in a legacy customer filename is otherwise still allowed.
  if (!relative || unsafeSegment || /[\\?#\x00-\x1f\x7f]/.test(storageKey)
    || /%(?:2e|2f|5c|25|00|3f|23)/i.test(storageKey)
    || !relative.toLowerCase().endsWith(`.${kind}`)) {
    throw new ApiError(409, "DOCUMENT_STORAGE_PATH_INVALID", "문서 저장 경로를 확인할 수 없습니다. 관리자에게 문의해 주세요.");
  }
}

export function buildDocumentDisplayFileName(
  companyName: string,
  createdAt: Date | string,
  kind: DocumentObjectKind,
): string {
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const ref = Number.isNaN(date.getTime()) ? new Date() : date;
  const safeCompany = (companyName || "").replace(/[\\/:*?"<>|]/g, "").trim() || "고객사";
  const yy = String(ref.getFullYear()).slice(-2);
  const mm = String(ref.getMonth() + 1).padStart(2, "0");
  const dd = String(ref.getDate()).padStart(2, "0");
  return `정기점검확인서_${safeCompany}_${yy}${mm}${dd}.${kind}`;
}

export async function uploadDocumentObject(
  supabase: SupabaseClient,
  storageKey: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await supabase.storage
    .from(GENERATED_DOCUMENTS_BUCKET)
    .upload(storageKey, new Uint8Array(buffer), {
      contentType,
      upsert: false,
    });
  if (error) {
    throw new ApiError(
      500,
      "DOCUMENT_STORAGE_UPLOAD_FAILED",
      `생성 문서 저장에 실패했습니다: ${error.message}`,
    );
  }
}

export async function createSignedDocumentUrl(
  supabase: SupabaseClient,
  storageKey: string,
  fileName: string,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(GENERATED_DOCUMENTS_BUCKET)
    .createSignedUrl(storageKey, SIGNED_URL_TTL_SECONDS, {
      download: fileName,
    });
  if (error || !data?.signedUrl) {
    throw new ApiError(
      500,
      "DOCUMENT_STORAGE_SIGN_FAILED",
      `다운로드 URL 발급에 실패했습니다: ${error?.message ?? "unknown error"}`,
    );
  }
  return data.signedUrl;
}

export async function downloadDocumentObject(
  supabase: SupabaseClient,
  storageKey: string,
): Promise<Buffer> {
  const { data, error } = await supabase.storage
    .from(GENERATED_DOCUMENTS_BUCKET)
    .download(storageKey);
  if (error || !data) {
    throw new ApiError(
      500,
      "DOCUMENT_STORAGE_DOWNLOAD_FAILED",
      `생성 문서를 읽을 수 없습니다: ${error?.message ?? "unknown error"}`,
    );
  }
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function deleteDocumentObjects(
  supabase: SupabaseClient,
  storageKeys: string[],
): Promise<void> {
  if (storageKeys.length === 0) {
    return;
  }
  const { error } = await supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).remove(storageKeys);
  if (error) {
    throw new ApiError(
      500,
      "DOCUMENT_STORAGE_DELETE_FAILED",
      `생성 문서 삭제에 실패했습니다: ${error.message}`,
    );
  }
}

export function documentContentType(kind: DocumentObjectKind): string {
  return kind === "docx"
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : "application/pdf";
}
