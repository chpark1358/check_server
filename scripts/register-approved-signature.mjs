// One approved asset only. Default is read-only; --apply inserts without overwriting.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const approved = {
  name: "이석진",
  path: "ec9db4ec849deca784.png",
  bytes: 157433,
  sha256: "c474964a1066740fa924dd40f4af0047ed4b7d040db216dca61cdb2c7e68696f",
};
const bucket = "engineer-signatures";
const [source, mode] = process.argv.slice(2);
if (!source || (mode && mode !== "--apply")) throw new Error("Usage: node --env-file=.env.local scripts/register-approved-signature.mjs <approved.png> [--apply]");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (url !== "https://ypszaogebsbynwzbatse.supabase.co" || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Expected project credentials are unavailable.");
const hash = (data) => createHash("sha256").update(data).digest("hex");
const bytes = readFileSync(source);
if (bytes.length !== approved.bytes || hash(bytes) !== approved.sha256) throw new Error("Asset is not the approved signature.");
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const columns = "id,name,storage_path,created_at,updated_at";
function checked(result, phase) {
  if (result.error) throw new Error(`${phase} failed (${result.error.code ?? result.error.statusCode ?? "service error"}).`);
  return result.data;
}
async function metadata() {
  return checked(await db.from("engineer_signatures").select(columns).order("name"), "metadata read") ?? [];
}
async function preflight() {
  const rows = await metadata();
  const named = rows.filter((r) => r.name.trim() === approved.name);
  if (named.length > 1 || named.some((r) => r.name !== approved.name || r.storage_path !== approved.path)) throw new Error("Existing signature metadata conflicts; nothing overwritten.");
  if (rows.some((r) => r.storage_path === approved.path && r.name !== approved.name)) throw new Error("Storage path belongs to another signature.");
  const objects = checked(await db.storage.from(bucket).list("", { search: approved.path, limit: 100 }), "storage listing");
  if (!objects || objects.length === 100) throw new Error("Storage absence could not be established.");
  const exists = objects.some((o) => o.name === approved.path);
  if (exists) {
    const blob = checked(await db.storage.from(bucket).download(approved.path), "signature read");
    if (!blob || hash(Buffer.from(await blob.arrayBuffer())) !== approved.sha256) throw new Error("Existing object differs; nothing overwritten.");
  }
  if (named.length && !exists) throw new Error("Existing metadata has a missing object; manual repair required.");
  return { rows, row: named[0] ?? null, exists };
}
const before = await preflight();
const report = {
  mode: mode === "--apply" ? "apply" : "inspect",
  approvedAsset: approved, existingMetadataRows: before.rows.length,
  namedMetadataPresent: !!before.row, normalObjectPresent: before.exists,
  conflict: false, sharedProductionMetadata: true,
};
if (mode === "--apply" && !before.row) {
  // Unique object key and unique name constraint prevent a race from overwriting data.
  if (!before.exists) checked(await db.storage.from(bucket).upload(approved.path, bytes, { contentType: "image/png", upsert: false }), "insert signature object");
  const blob = checked(await db.storage.from(bucket).download(approved.path), "uploaded signature read");
  if (!blob || hash(Buffer.from(await blob.arrayBuffer())) !== approved.sha256) throw new Error("Read-back hash mismatch; metadata not inserted.");
  checked(await db.from("engineer_signatures").insert({ name: approved.name, storage_path: approved.path }).select("id").single(), "insert signature metadata");
  report.inserted = true;
} else report.inserted = false;
const after = mode === "--apply" ? await preflight() : before;
report.registered = !!after.row && after.exists;
report.registeredId = after.row?.id ?? null;
report.finalMetadataRows = after.rows.length;
report.existingRowsUnchanged = before.rows.every((r) => JSON.stringify(after.rows.find((a) => a.id === r.id)) === JSON.stringify(r));
report.firstSignatureUnchanged = before.rows[0]?.id === after.rows[0]?.id;
console.log(JSON.stringify(report, null, 2));
if (!report.existingRowsUnchanged || !report.firstSignatureUnchanged) process.exitCode = 2;
