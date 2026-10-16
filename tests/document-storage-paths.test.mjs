import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const source = readFileSync(new URL("../src/lib/server/document-storage.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiledModule = { exports: {} };
new Function("require", "module", "exports", output)(name => {
  if (name === "server-only") return {};
  if (name === "@/lib/server/api") return { ApiError };
  throw new Error(`Unexpected dependency ${name}`);
}, compiledModule, compiledModule.exports);
const { assertDocumentStorageKey } = compiledModule.exports;
const document = { created_by: "22222222-2222-4222-8222-222222222222", id: "11111111-1111-4111-8111-111111111111" };
const prefix = `${document.created_by}/${document.id}/`;
const denied = error => error instanceof ApiError && error.status === 409 && error.code === "DOCUMENT_STORAGE_PATH_INVALID";

test("Storage path guard preserves current DOCX/PDF, retry PDFs and historical Korean filenames", () => {
  for (const [relative, kind] of [
    ["document.docx", "docx"], ["document.pdf", "pdf"],
    ["pdf-retries/11111111-1111-4111-8111-111111111111.pdf", "pdf"],
    ["정기점검확인서_기존 고객사_260429.docx", "docx"],
    ["정기점검확인서_50%고객사_260429.pdf", "pdf"],
  ]) assert.doesNotThrow(() => assertDocumentStorageKey(prefix + relative, document, kind));
});

test("Storage path guard denies another owner or document even if the filename is valid", () => {
  for (const key of [
    `other-owner/${document.id}/document.pdf`,
    `${document.created_by}/other-document/document.pdf`,
    `${document.created_by}/${document.id}-suffix/document.pdf`,
    `/${prefix}document.pdf`,
    `https://storage.example/${prefix}document.pdf`,
  ]) assert.throws(() => assertDocumentStorageKey(key, document, "pdf"), denied);
});

test("Storage path guard rejects traversal, encoded separators, URI suffixes and the wrong file type", () => {
  for (const relative of [
    "../document.pdf", "folder/../../document.pdf", "./document.pdf", "folder//document.pdf",
    "..\\document.pdf", "%2e%2e/document.pdf", "%252e%252e/document.pdf", "folder%2f..%2fdocument.pdf",
    "folder%5cdocument.pdf", "folder%00document.pdf", "document.pdf?download=1", "document.pdf#fragment",
    "document.pdf\u0000", "document.docx", "", "document.pdf/",
  ]) assert.throws(() => assertDocumentStorageKey(prefix + relative, document, "pdf"), denied);
});
