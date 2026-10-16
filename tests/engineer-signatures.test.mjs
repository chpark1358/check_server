import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const ts = createRequire(import.meta.url)("typescript");
function loadTs(file, imports = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Buffer, Uint8Array, Date,
    console: { error() {} },
    require(name) { assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`); return imports[name]; },
    ...globals,
  });
  return exports;
}
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const roster = loadTs("../src/lib/engineer-roster.ts");
const generatedPath = "preview/lee-seokjin-generated-20261016.png";
const signatureRow = (name, storage_path) => ({ id: `real:${name}`, name, storage_path, created_at: "2026-10-16", updated_at: "2026-10-16" });
function harness({ environment, rows = [], readError = null, downloadError = null } = {}) {
  const downloads = [], lookups = [];
  const supabase = {
    from(table) {
      assert.equal(table, "engineer_signatures");
      let name;
      const query = {
        select() { return query; },
        order() { return query; },
        eq(field, value) { assert.equal(field, "name"); name = value; lookups.push(name); return query; },
        async returns() { return { data: rows, error: readError }; },
        async maybeSingle() { return { data: rows.find(row => row.name === name) ?? null, error: readError }; },
        upsert() { assert.fail("Signature reads must never mutate shared metadata"); },
        insert() { assert.fail("Signature reads must never insert shared metadata"); },
      };
      return query;
    },
    storage: { from(bucket) {
      assert.equal(bucket, "engineer-signatures");
      return { async download(path) {
        downloads.push(path);
        return { data: downloadError ? null : new Blob([`image:${path}`]), error: downloadError };
      } };
    } },
  };
  const signatures = loadTs("../src/lib/server/engineer-signatures.ts", {
    "server-only": {},
    "@/lib/server/api": { ApiError },
    "@/lib/server/document-storage": { ENGINEER_SIGNATURES_BUCKET: "engineer-signatures" },
    "@/lib/engineer-roster": roster,
  }, { process: { env: { VERCEL_ENV: environment } } });
  return { signatures, supabase, downloads, lookups };
}

test("only a Vercel Preview gets the generated signature, with no shared metadata write", async () => {
  const h = harness({ environment: "preview" });
  const options = roster.buildEngineerRoster(await h.signatures.listEngineerSignatures(h.supabase));
  const lee = options.find(row => row.name === "이석진");
  assert.equal(lee.hasSignature, true);
  assert.equal(Object.hasOwn(lee, "isGenerated"), false);
  assert.equal((await h.signatures.getEngineerSignatureByName(h.supabase, "이석진")).isGenerated, true);
  const buffer = await h.signatures.loadEngineerSignatureBuffer(h.supabase, " 이석진 ");
  assert.equal(buffer.toString(), `image:${generatedPath}`);
  assert.deepEqual(h.downloads, [generatedPath]);
});

test("production, local and unset environments never list or download the generated Preview image", async () => {
  for (const environment of ["production", "development", undefined, "Preview"]) {
    const h = harness({ environment });
    const options = roster.buildEngineerRoster(await h.signatures.listEngineerSignatures(h.supabase));
    const lee = options.find(row => row.name === "이석진");
    assert.equal(lee.hasSignature, false, environment);
    assert.equal(Object.hasOwn(lee, "isGenerated"), false, environment);
    assert.equal(await h.signatures.loadEngineerSignatureBuffer(h.supabase, "이석진"), null);
    assert.deepEqual(h.downloads, []);
  }
});

test("a real uploaded signature supersedes the generated Preview object in listing and documents", async () => {
  for (const environment of ["preview", "production"]) {
    const h = harness({ environment, rows: [signatureRow("이석진", "real-lee-signature.png")] });
    const options = roster.buildEngineerRoster(await h.signatures.listEngineerSignatures(h.supabase));
    assert.equal(options.filter(row => row.name === "이석진").length, 1);
    const lee = options.find(row => row.name === "이석진");
    assert.equal(lee.hasSignature, true);
    assert.equal(Object.hasOwn(lee, "isGenerated"), false);
    assert.equal((await h.signatures.loadEngineerSignatureBuffer(h.supabase, "이석진")).toString(), "image:real-lee-signature.png");
    assert.deepEqual(h.downloads, ["real-lee-signature.png"]);
  }
});

test("shared metadata cannot promote a reserved Preview path into production", async () => {
  const h = harness({ environment: "production", rows: [
    signatureRow("이석진", generatedPath), signatureRow("다른 점검자", "preview/other.png"),
  ] });
  const rows = await h.signatures.listEngineerSignatures(h.supabase);
  assert.equal(rows.length, 0);
  assert.equal(await h.signatures.loadEngineerSignatureBuffer(h.supabase, "이석진"), null);
  assert.equal(await h.signatures.loadEngineerSignatureBuffer(h.supabase, "다른 점검자"), null);
  assert.deepEqual(h.downloads, []);
});

test("generated resolution is restricted to the active requested engineer", async () => {
  const h = harness({ environment: "preview", rows: [signatureRow("박장현", "retired.png")] });
  for (const name of ["", "류은석", "박장현", "다른 점검자"]) {
    assert.equal(await h.signatures.loadEngineerSignatureBuffer(h.supabase, name), null);
  }
  assert.deepEqual(h.downloads, []);
  assert.deepEqual(h.lookups, ["다른 점검자"]);
});

test("a failed real signature download never silently substitutes a generated image", async () => {
  const h = harness({ environment: "preview", rows: [signatureRow("이석진", "real.png")], downloadError: { message: "missing image" } });
  assert.equal(await h.signatures.loadEngineerSignatureBuffer(h.supabase, "이석진"), null);
  assert.deepEqual(h.downloads, ["real.png"]);
});

test("metadata lookup failures are visible rather than falling back to a synthetic signature", async () => {
  const h = harness({ environment: "preview", readError: { message: "database unavailable" } });
  await assert.rejects(() => h.signatures.listEngineerSignatures(h.supabase), error => error.code === "ENGINEER_SIGNATURES_LIST_FAILED");
  await assert.rejects(() => h.signatures.loadEngineerSignatureBuffer(h.supabase, "이석진"), error => error.code === "ENGINEER_SIGNATURE_LOOKUP_FAILED");
  assert.deepEqual(h.downloads, []);
});
