import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/server/api";

export const GENERATED_DOCUMENTS_BUCKET = "generated-documents";
export const ENGINEER_SIGNATURES_BUCKET = "engineer-signatures";
export const SIGNED_URL_TTL_SECONDS = 5 * 60;

export type DocumentObjectKind = "docx" | "pdf";

export function buildDocumentStorageKey(
  userId: string,
  documentId: string,
  fileName: string,
): string {
  return `${userId}/${documentId}/${fileName}`;
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
