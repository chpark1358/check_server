import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/ui-preview/page.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;

function loadPreviewPage(vercelEnvironment) {
  const calls = { notFound: 0, jsx: 0, mailConsole: 0 };
  const notFoundError = new Error("NEXT_NOT_FOUND_TEST");
  const compiledModule = { exports: {} };
  function MailConsole(props) {
    calls.mailConsole++;
    return { component: "MailConsole", preview: props.preview };
  }
  const mocks = {
    "next/navigation": {
      notFound() {
        calls.notFound++;
        throw notFoundError;
      },
    },
    "@/components/mail-console": { MailConsole },
    "react/jsx-runtime": {
      jsx(component, props) {
        calls.jsx++;
        assert.equal(component, MailConsole);
        return component(props);
      },
    },
  };
  runInNewContext(compiled, {
    module: compiledModule,
    exports: compiledModule.exports,
    process: { env: { VERCEL_ENV: vercelEnvironment } },
    require(name) {
      assert.ok(Object.hasOwn(mocks, name), "Unexpected preview-page dependency: " + name);
      return mocks[name];
    },
  }, { filename: "ui-preview/page.tsx", timeout: 1000 });
  return { page: compiledModule.exports.default, calls, notFoundError };
}

test("production /ui-preview stops at notFound before creating or rendering MailConsole", () => {
  const { page, calls, notFoundError } = loadPreviewPage("production");
  assert.throws(() => page(), (error) => error === notFoundError);
  assert.deepEqual(calls, { notFound: 1, jsx: 0, mailConsole: 0 });
});

for (const environment of ["preview", "development"]) {
  test(environment + " /ui-preview renders MailConsole with preview=true", () => {
    const { page, calls } = loadPreviewPage(environment);
    const result = page();
    assert.deepEqual(result, { component: "MailConsole", preview: true });
    assert.deepEqual(calls, { notFound: 0, jsx: 1, mailConsole: 1 });
  });
}
