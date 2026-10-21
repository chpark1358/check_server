import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const OWNER = "11111111-1111-4111-8111-111111111111";
const DOC = "33333333-3333-4333-8333-333333333333";
const routeSource = ts.transpileModule(
  readFileSync(new URL("../src/app/api/zendesk/uploads/generated/route.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function harness({ attached = false, effectiveDryRuns = [true], uploadFailure = false, updateError = null } = {}) {
  const updates = [], uploads = [], audits = [], warnings = [];
  const row = {
    id: DOC, created_by: OWNER, company_name: "Fixture",
    docx_path: OWNER + "/" + DOC + "/document.docx", pdf_path: OWNER + "/" + DOC + "/document.pdf",
    attached_to_mail: attached, created_at: "2026-10-15T00:00:00.000Z", expires_at: "2099-01-01T00:00:00.000Z",
  };
  const supabase = {
    from(table) {
      assert.equal(table, "generated_documents");
      let update = null;
      const query = {
        select: () => query,
        update(values) { update = values; return query; },
        eq(key, value) {
          assert.equal(key, "id"); assert.equal(value, DOC);
          if (!update) return query;
          assert.deepEqual(Object.keys(update), ["attached_to_mail"]);
          updates.push({ ...update });
          if (!updateError) row.attached_to_mail = update.attached_to_mail;
          return Promise.resolve({ error: updateError });
        },
        maybeSingle: async () => ({ data: { ...row }, error: null }),
      };
      return query;
    },
  };
  const imports = {
    "@/lib/server/api": {
      ApiError,
      readJsonObject: request => request.json(),
      requireRole: async (_request, _id, minimum) => {
        assert.equal(minimum, "operator");
        return { supabase, role: "operator", user: { id: OWNER } };
      },
      apiOk: (requestId, data, status = 200) => Response.json({ ok: true, requestId, ...data }, { status }),
      withApiHandler: async (_request, action) => {
        try { return await action("fixture-request"); }
        catch (error) {
          if (!(error instanceof ApiError)) throw error;
          return Response.json({ ok: false, code: error.code }, { status: error.status });
        }
      },
    },
    "@/lib/server/audit": { writeAuditLog: async (...args) => { audits.push(args); } },
    "@/lib/server/rate-limit": { enforceRateLimit: async () => {} },
    "@/lib/server/document-storage": {
      assertDocumentStorageKey: (key, record, type) => assert.equal(key, record.created_by + "/" + record.id + "/document." + type),
      downloadDocumentObject: async (_client, key) => {
        assert.ok(key.startsWith(OWNER + "/" + DOC + "/"));
        return Buffer.from("synthetic document bytes");
      },
      buildDocumentDisplayFileName: (_company, _createdAt, type) => "fixture." + type,
      documentContentType: type => type === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
    "@/lib/server/zendesk": {
      uploadZendeskFile: async (file, options) => {
        const index = uploads.length;
        uploads.push({ name: file.name, requestedDryRun: options.dryRun });
        if (uploadFailure) throw new ApiError(502, "ZENDESK_UPLOAD_FAILED", "Synthetic upload failure");
        return {
          token: "fixture-upload-" + index, fileName: file.name, size: file.size,
          dryRun: effectiveDryRuns[index] ?? effectiveDryRuns[0],
        };
      },
    },
  };
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", "console", routeSource)(
    name => { assert.ok(Object.hasOwn(imports, name), "Unexpected dependency: " + name); return imports[name]; },
    compiledModule, compiledModule.exports, { error: value => warnings.push(value) },
  );
  return {
    updates, uploads, audits, warnings, row,
    invoke: (body = {}) => compiledModule.exports.POST({ json: async () => ({ documentId: DOC, types: ["pdf"], ...body }) }),
  };
}

test("explicit dry-run returns a test upload without setting the document flag", async () => {
  const h = harness(), response = await h.invoke({ dryRun: true });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).uploads[0].dryRun, true);
  assert.deepEqual(h.updates, []);
  assert.equal(h.row.attached_to_mail, false);
  assert.equal(h.audits[0][5].dryRun, true);
});

test("omitted dryRun remains safe and does not create an attachment record", async () => {
  const h = harness(), response = await h.invoke();
  assert.equal(response.status, 202);
  assert.equal(h.uploads[0].requestedDryRun, true);
  assert.deepEqual(h.updates, []);
});

test("an explicitly real request downgraded by the provider gate must not set the flag", async () => {
  const h = harness({ effectiveDryRuns: [true] }), response = await h.invoke({ dryRun: false });
  assert.equal(h.uploads[0].requestedDryRun, false);
  assert.equal(response.status, 202);
  assert.deepEqual(h.updates, []);
  assert.equal(h.row.attached_to_mail, false);
  assert.equal(h.audits[0][5].dryRun, true);
});

test("an actual provider upload records only attached_to_mail and retains the upload response", async () => {
  const h = harness({ effectiveDryRuns: [false] }), response = await h.invoke({ dryRun: false });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.documentId, DOC);
  assert.equal(body.uploads[0].dryRun, false);
  assert.deepEqual(body.uploadTokens, ["fixture-upload-0"]);
  assert.deepEqual(h.updates, [{ attached_to_mail: true }]);
  assert.equal(h.row.attached_to_mail, true);
  assert.equal(h.audits[0][5].dryRun, false);
});

for (const effectiveDryRun of [true, false]) {
  test("legacy true flag is preserved without rewrite for effective dryRun=" + effectiveDryRun, async () => {
    const h = harness({ attached: true, effectiveDryRuns: [effectiveDryRun] });
    const response = await h.invoke({ dryRun: false });
    assert.equal(response.status, effectiveDryRun ? 202 : 201);
    assert.equal(h.row.attached_to_mail, true);
    assert.deepEqual(h.updates, []);
  });
}

test("multiple test uploads do not record a flag; any confirmed real upload can record one", async () => {
  for (const modes of [[true, true], [true, false]]) {
    const h = harness({ effectiveDryRuns: modes });
    const response = await h.invoke({ types: ["docx", "pdf"], dryRun: false });
    const hasReal = modes.includes(false);
    assert.equal(response.status, hasReal ? 201 : 202);
    assert.equal(h.updates.length, hasReal ? 1 : 0);
    assert.equal(h.row.attached_to_mail, hasReal);
  }
});

test("upload failure leaves the existing false record unchanged", async () => {
  const h = harness({ uploadFailure: true }), response = await h.invoke({ dryRun: false });
  assert.equal(response.status, 502);
  assert.deepEqual(h.updates, []);
  assert.equal(h.row.attached_to_mail, false);
});

test("failed metadata update does not imply a recorded flag or a sent ticket", async () => {
  const h = harness({ effectiveDryRuns: [false], updateError: { message: "Synthetic metadata failure" } });
  const response = await h.invoke({ dryRun: false });
  assert.equal(response.status, 201);
  assert.equal(h.row.attached_to_mail, false);
  assert.equal(h.updates.length, 1);
  assert.equal(h.warnings.length, 1);
  const body = await response.json();
  assert.equal(Object.hasOwn(body, "ticketId"), false);
  assert.equal(body.uploads[0].dryRun, false);
});
