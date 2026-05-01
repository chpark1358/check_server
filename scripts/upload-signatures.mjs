#!/usr/bin/env node
// 일회성 업로드 스크립트: 로컬 PNG → Supabase Storage(`engineer-signatures` bucket) + `engineer_signatures` 테이블 upsert.
//
// 사용:
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/upload-signatures.mjs [SOURCE_DIR]
//
// SOURCE_DIR 미지정 시 ./src/signatures/split 사용.
// 파일 이름이 점검자 이름이 됩니다 (예: 김기홍.png → name="김기홍").
//
// 마이그레이션 202604290005_engineer_signatures.sql을 먼저 적용하세요.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.");
  process.exit(1);
}

const sourceDir = process.argv[2] || path.resolve("src/signatures/split");
console.log(`source: ${sourceDir}`);

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const files = readdirSync(sourceDir).filter((file) => file.toLowerCase().endsWith(".png"));
if (files.length === 0) {
  console.warn("PNG 파일이 없습니다.");
  process.exit(0);
}

let success = 0;
let failed = 0;
for (const file of files) {
  const name = path.basename(file, path.extname(file));
  const buffer = readFileSync(path.join(sourceDir, file));
  // Supabase Storage는 한글 키를 허용하지 않으므로 UTF-8 hex로 변환해 ASCII path만 사용.
  const storagePath = `${Buffer.from(name, "utf-8").toString("hex")}.png`;

  const { error: uploadError } = await supabase.storage
    .from("engineer-signatures")
    .upload(storagePath, buffer, {
      contentType: "image/png",
      upsert: true,
    });
  if (uploadError) {
    console.error(`× ${name}: upload failed (${uploadError.message})`);
    failed += 1;
    continue;
  }

  const { error: dbError } = await supabase
    .from("engineer_signatures")
    .upsert(
      {
        name,
        storage_path: storagePath,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "name" },
    );
  if (dbError) {
    console.error(`× ${name}: db upsert failed (${dbError.message})`);
    failed += 1;
    continue;
  }
  console.log(`✓ ${name}`);
  success += 1;
}

console.log(`\nresult: ${success} success, ${failed} failed (total ${files.length})`);
process.exit(failed > 0 ? 1 : 0);
