import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/server/api";
import { ENGINEER_SIGNATURES_BUCKET } from "@/lib/server/document-storage";
import { isRetiredEngineerName } from "@/lib/engineer-roster";

type EngineerSignatureRow = {
  id: string;
  name: string;
  storage_path: string;
  created_at: string;
  updated_at: string;
  isGenerated?: boolean;
};

// This object is intentionally not registered in the shared engineer_signatures table.
// A real uploaded signature always takes precedence, and production never reads preview objects.
const GENERATED_PREVIEW_SIGNATURE: EngineerSignatureRow = {
  id: "preview:lee-seokjin-generated-20261016",
  name: "이석진",
  storage_path: "preview/lee-seokjin-generated-20261016.png",
  created_at: "2026-10-16T00:00:00+09:00",
  updated_at: "2026-10-16T00:00:00+09:00",
  isGenerated: true,
};

function generatedPreviewSignature(name: string) {
  return process.env.VERCEL_ENV === "preview" && name === GENERATED_PREVIEW_SIGNATURE.name
    ? { ...GENERATED_PREVIEW_SIGNATURE }
    : null;
}

function isPreviewStoragePath(path: string) {
  return path.startsWith("preview/");
}

export async function listEngineerSignatures(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("engineer_signatures")
    .select("id, name, storage_path, created_at, updated_at")
    .order("name", { ascending: true })
    .returns<EngineerSignatureRow[]>();
  if (error) {
    throw new ApiError(
      500,
      "ENGINEER_SIGNATURES_LIST_FAILED",
      `점검자 서명 목록을 조회할 수 없습니다: ${error.message}`,
    );
  }
  // Reserved preview paths must never be promoted by a row in the shared metadata table.
  const signatures = (data ?? []).filter((row) => !isPreviewStoragePath(row.storage_path));
  const generated = generatedPreviewSignature(GENERATED_PREVIEW_SIGNATURE.name);
  if (generated && !signatures.some((row) => row.name.trim() === generated.name && row.storage_path)) {
    return [...signatures.filter((row) => row.name.trim() !== generated.name), generated];
  }
  return signatures;
}

export async function getEngineerSignatureByName(supabase: SupabaseClient, name: string) {
  const safeName = name.trim();
  if (!safeName || isRetiredEngineerName(safeName)) {
    return null;
  }
  const { data, error } = await supabase
    .from("engineer_signatures")
    .select("id, name, storage_path")
    .eq("name", safeName)
    .maybeSingle<{ id: string; name: string; storage_path: string }>();
  if (error) {
    throw new ApiError(
      500,
      "ENGINEER_SIGNATURE_LOOKUP_FAILED",
      `점검자 서명을 조회할 수 없습니다: ${error.message}`,
    );
  }
  if (data?.storage_path && !isPreviewStoragePath(data.storage_path)) {
    return data;
  }
  return generatedPreviewSignature(safeName);
}

export async function loadEngineerSignatureBuffer(
  supabase: SupabaseClient,
  name: string,
): Promise<Buffer | null> {
  const row = await getEngineerSignatureByName(supabase, name);
  if (!row) {
    return null;
  }
  const { data, error } = await supabase.storage
    .from(ENGINEER_SIGNATURES_BUCKET)
    .download(row.storage_path);
  if (error || !data) {
    console.error(
      JSON.stringify({
        level: "warn",
        message: "engineer_signature_download_failed",
        name,
        path: row.storage_path,
        error: error?.message,
      }),
    );
    return null;
  }
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function uploadEngineerSignature(
  supabase: SupabaseClient,
  name: string,
  buffer: Buffer,
  actorUserId: string | null,
) {
  const safeName = name.trim();
  if (!safeName || /[\\/:*?"<>|]/.test(safeName)) {
    throw new ApiError(400, "INVALID_SIGNATURE_NAME", "점검자 이름 형식이 올바르지 않습니다.");
  }
  // Storage 키는 ASCII-only가 안전. 한글 이름을 그대로 저장 X — UTF-8 hex로 인코딩.
  const storagePath = `${Buffer.from(safeName, "utf-8").toString("hex")}.png`;

  const { error: uploadError } = await supabase.storage
    .from(ENGINEER_SIGNATURES_BUCKET)
    .upload(storagePath, new Uint8Array(buffer), {
      contentType: "image/png",
      upsert: true,
    });
  if (uploadError) {
    throw new ApiError(
      500,
      "ENGINEER_SIGNATURE_UPLOAD_FAILED",
      `서명 이미지 업로드에 실패했습니다: ${uploadError.message}`,
    );
  }

  const { data, error: dbError } = await supabase
    .from("engineer_signatures")
    .upsert(
      {
        name: safeName,
        storage_path: storagePath,
        updated_by: actorUserId,
        updated_at: new Date().toISOString(),
        ...(actorUserId ? { created_by: actorUserId } : {}),
      },
      { onConflict: "name" },
    )
    .select("id, name, storage_path, created_at, updated_at")
    .single<EngineerSignatureRow>();
  if (dbError || !data) {
    throw new ApiError(
      500,
      "ENGINEER_SIGNATURE_DB_FAILED",
      `서명 메타 저장에 실패했습니다: ${dbError?.message ?? "unknown"}`,
    );
  }
  return data;
}

export async function deleteEngineerSignature(supabase: SupabaseClient, id: string) {
  const { data: row, error: lookupError } = await supabase
    .from("engineer_signatures")
    .select("id, storage_path")
    .eq("id", id)
    .maybeSingle<{ id: string; storage_path: string }>();
  if (lookupError) {
    throw new ApiError(
      500,
      "ENGINEER_SIGNATURE_LOOKUP_FAILED",
      `서명 정보를 조회할 수 없습니다: ${lookupError.message}`,
    );
  }
  if (!row) {
    throw new ApiError(404, "ENGINEER_SIGNATURE_NOT_FOUND", "해당 서명을 찾을 수 없습니다.");
  }

  const { error: removeError } = await supabase.storage
    .from(ENGINEER_SIGNATURES_BUCKET)
    .remove([row.storage_path]);
  if (removeError) {
    console.error(
      JSON.stringify({
        level: "warn",
        message: "engineer_signature_storage_remove_failed",
        path: row.storage_path,
        error: removeError.message,
      }),
    );
  }

  const { error: deleteError } = await supabase
    .from("engineer_signatures")
    .delete()
    .eq("id", id);
  if (deleteError) {
    throw new ApiError(
      500,
      "ENGINEER_SIGNATURE_DELETE_FAILED",
      `서명 삭제에 실패했습니다: ${deleteError.message}`,
    );
  }
}
