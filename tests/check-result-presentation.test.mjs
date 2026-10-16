import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const ts = createRequire(import.meta.url)("typescript");
function load(file, imports = {}) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require(name) { assert.ok(Object.hasOwn(imports, name), `Unexpected import ${name}`); return imports[name]; } });
  return exports;
}
const quality = load("../src/lib/check-result-quality.ts");
const presentation = load("../src/lib/check-result-presentation.ts", { "@/lib/check-result-quality": quality });
function collectedResult() {
  return {
    quality: { version: 1, missingFields: [], invalidFields: [] },
    flags: { agent: true, mail: false, web: true, httpd: true, mysqld: true, ntp: true, iptables: true, firewall: false, backup: true },
    warnings: [], license: { total: 100, used: 0, unverified: 0 },
    system: { cpuUsagePercent: 0, memUsagePercent: 0, memTotalGb: 32, load1: 0, load5: 0, load15: 0 },
    disks: { root: { usedPercent: 0 }, home: { usedPercent: 0 }, storage: { usedPercent: 0 } },
  };
}

test("presentation preserves real zero metrics and false service evidence", () => {
  const result = collectedResult();
  result.flags.agent = false;
  assert.equal(presentation.collectedNumberText(result, "system.cpuUsagePercent", 0, "%"), "0%");
  assert.equal(presentation.collectedNumberText(result, "system.load1", 0, "", 2), "0.00");
  assert.equal(presentation.collectedServiceText(result, "agent", false), "이상");
});

test("missing and invalid placeholders never appear as measured zero or failed service", () => {
  const result = collectedResult();
  result.quality.missingFields = ["system.cpuUsagePercent", "flags.agent"];
  result.quality.invalidFields = ["system.memUsagePercent", "flags.web"];
  assert.equal(presentation.collectedNumberText(result, "system.cpuUsagePercent", 0, "%"), "미수집");
  assert.equal(presentation.collectedNumberText(result, "system.memUsagePercent", 0, "%"), "확인불가");
  assert.equal(presentation.collectedServiceText(result, "agent", false), "미수집");
  assert.equal(presentation.collectedServiceText(result, "web", true), "확인불가");
});

test("batch automatic selection keeps known agent and high disk policy exceptions", () => {
  const result = collectedResult();
  result.flags.agent = false;
  result.disks.storage.usedPercent = 95;
  result.license.unverified = 3;
  result.warnings = ["에이전트 연결 확인", "메일 서버 미사용"];
  assert.ok(presentation.getBatchCheckReviewReasons(result).length > 0);
  assert.equal(presentation.getBatchCheckReviewReasons(result, { ignoreAgent: true, ignoreDiskUsage: true }).length, 0);
});

test("unknown required fields block automatic selection even where known failures have policy exceptions", () => {
  for (const key of presentation.REQUIRED_CHECK_FIELDS) {
    for (const bucket of ["missingFields", "invalidFields"]) {
      const result = collectedResult();
      result.quality[bucket] = [key];
      const reasons = presentation.getBatchCheckReviewReasons(result, { ignoreAgent: true, ignoreDiskUsage: true });
      assert.ok(reasons.some(reason => reason.startsWith("수집 확인 필요:")), `${bucket} ${key} must block automatic selection`);
    }
  }
});

test("optional metadata gaps remain visible but do not block batch selection", () => {
  const result = collectedResult();
  result.quality.missingFields = ["versions.agentMac", "system.osInfo", "system.load5", "flags.mail", "flags.firewall"];
  assert.equal(presentation.getBatchCheckReviewReasons(result).length, 0);
  assert.ok(presentation.getUnknownCheckFields(result).includes("versions.agentMac"));
  assert.equal(presentation.getUnknownCheckFields(result).includes("flags.mail"), false);
});

test("saved document defaults cannot convert missing collected services into an implicit normal override", () => {
  const result = collectedResult();
  result.quality.missingFields = ["flags.agent"];
  assert.equal(Object.keys(presentation.resolveDefaultDocumentFlagOverride(result, "agent", "Y")).length, 0);
  assert.equal(Object.keys(presentation.resolveDefaultDocumentFlagOverride(result, "iptables", "auto")).length, 0);
  assert.equal(presentation.resolveDefaultDocumentFlagOverride(result, "iptables", "Y").iptables, true);
  assert.equal(presentation.resolveDefaultDocumentFlagOverride(result, "iptables", "N").iptables, false);
  assert.equal(result.flags.agent, true, "raw normalized flags are not mutated");
});
