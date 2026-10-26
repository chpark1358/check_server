import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript"), exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/lib/cc-recipients.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });
const { parseCcEmails, getStoredCcRecipients, isPlainEmailAddress, MAX_CC_RECIPIENTS } = exports;
const plain = value => JSON.parse(JSON.stringify(value));

test("CC parser preserves old no-CC requests and accepts intentionally empty input", () => {
  for (const value of [undefined, "", " ; ,\r\n ", [], ["", "  "]]) assert.deepEqual(plain(parseCcEmails(value)), []);
});

test("CC parser handles supported delimiters, deduplicates case-insensitively and excludes requester", () => {
  const expected = ["first@example.test", "second+team@example.test", "third@example.test"];
  assert.deepEqual(plain(parseCcEmails(" First@Example.test ;second+team@example.test\r\nthird@example.test,FIRST@EXAMPLE.TEST, REQUESTER@EXAMPLE.TEST ", " requester@example.test ")), expected);
  assert.deepEqual(plain(parseCcEmails(["First@Example.test; second+team@example.test", "\nthird@example.test", "first@example.test"])), expected);
});

for (const [label, value] of [
  ["null", null], ["object", {}], ["number", 3], ["mixed array", ["ok@example.test", null]],
  ["display name", "Name <ok@example.test>"], ["space", "first last@example.test"],
  ["missing domain", "first@"], ["bare domain", "first@localhost"], ["missing local", "@example.test"],
  ["multiple at signs", "first@example@test.test"], ["leading dot", ".first@example.test"],
  ["double dot", "first..last@example.test"], ["trailing dot", "first.@example.test"],
  ["invalid domain", "first@-example.test"], ["null byte", "first@example.test\0"],
  ["header injection", "good@example.test\r\nBcc:other@example.test"],
]) {
  test(`CC parser rejects ${label} without silently dropping recipients`, () => {
    assert.throws(() => parseCcEmails(value), { name: "CcValidationError", code: "INVALID_CC_EMAILS" });
  });
}

test("CC count limit applies after deduplication and requester removal; excess is rejected", () => {
  const addresses = Array.from({ length: MAX_CC_RECIPIENTS }, (_, i) => `person${i}@example.test`);
  assert.equal(parseCcEmails([...addresses, ...addresses, "owner@example.test"], "OWNER@example.test").length, 48);
  assert.throws(() => parseCcEmails([...addresses, "one-more@example.test"]), { code: "TOO_MANY_CC_RECIPIENTS" });
});

test("raw CC input is capped at 16 KiB including repeated and multibyte text", () => {
  assert.deepEqual(plain(parseCcEmails(" ".repeat(16384))), []);
  for (const value of [" ".repeat(16385), [" ".repeat(8192), " ".repeat(8192)], "한".repeat(5462)]) {
    assert.throws(() => parseCcEmails(value), { code: "CC_INPUT_TOO_LARGE" });
  }
});

test("email length and domain label limits reject malformed addresses", () => {
  assert.equal(isPlainEmailAddress("a".repeat(64) + "@example.test"), true);
  assert.equal(isPlainEmailAddress("a".repeat(65) + "@example.test"), false);
  assert.equal(isPlainEmailAddress("a@" + "b".repeat(64) + ".test"), false);
});

test("stored CC distinguishes legacy unknown from recorded none and returns a snapshot copy", () => {
  for (const row of [{}, { cc_emails: null }, { cc_emails: "a@example.test" }, { cc_emails: [null] }]) {
    assert.deepEqual(plain(getStoredCcRecipients(row)), { ccEmails: null, ccEvidence: "legacy" });
  }
  assert.deepEqual(plain(getStoredCcRecipients({ cc_emails: [] })), { ccEmails: [], ccEvidence: "recorded" });
  const row = { cc_emails: ["one@example.test"] }, result = getStoredCcRecipients(row);
  assert.deepEqual(plain(result), { ccEmails: ["one@example.test"], ccEvidence: "recorded" });
  result.ccEmails.push("other@example.test");
  assert.deepEqual(row.cc_emails, ["one@example.test"]);
});
