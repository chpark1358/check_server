// Explicit one-object Preview asset upload; does not change shared engineer metadata.
// Run: node --env-file=.env.local scripts/upload-preview-signature.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const bucket = "engineer-signatures";
const objectPath = "preview/lee-seokjin-generated-20261016.png";
const source = new URL("../src/signatures/preview/lee-seokjin-generated-20261016.png", import.meta.url);
const bytes = readFileSync(source);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes[25] !== 6 || bytes.length > 256 * 1024) {
  throw new Error("Expected a PNG with RGBA transparency, at most 256 KiB.");
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase server configuration is missing.");
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const storage = supabase.storage.from(bucket);
const existing = await storage.download(objectPath);
let action = "already_verified";
if (existing.data) {
  const stored = Buffer.from(await existing.data.arrayBuffer());
  if (sha256(stored) !== sha256(bytes)) throw new Error("An existing object differs; it was not overwritten.");
} else {
  const status = String(existing.error?.statusCode ?? "");
  if (!['400', '404'].includes(status) || !/not found|does not exist/i.test(existing.error?.message ?? "")) {
    throw new Error(`Storage preflight failed (${status || 'unknown'}); upload was not attempted.`);
  }
  const result = await storage.upload(objectPath, bytes, { contentType: "image/png", cacheControl: "3600", upsert: false });
  if (result.error) throw new Error(`Storage upload failed (${result.error.statusCode ?? 'unknown'}).`);
  action = "uploaded";
}
const verification = await storage.download(objectPath);
if (!verification.data) throw new Error("Uploaded object could not be read back.");
const downloaded = Buffer.from(await verification.data.arrayBuffer());
if (sha256(downloaded) !== sha256(bytes)) throw new Error("Read-back checksum mismatch.");
console.log(JSON.stringify({ action, bucket, objectPath, bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), sha256: sha256(bytes), verified: true, metadataChanged: false }));
