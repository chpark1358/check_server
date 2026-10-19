import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TABLES, SOURCE_URL, LIMITS, ExportError, exportApplicationData, parseLosslessJson, canonicalJson, safeFailure, validateOutputPath, main } from '../scripts/export-recovery-app-data.mjs';

const credential = 'fixture-service-key-never-print';
function fixture({ rows, mutate, responseOverride, inventoryOverride } = {}) {
  const data = Object.fromEntries(TABLES.map(({ name }) => [name, []]));
  Object.assign(data, rows ?? { audit_logs: Array.from({ length: 5 }, (_, index) => ({ id: String(index + 1), metadata: { private: 'fixture-personal-value' } })) });
  const metadata = {
    paths: Object.fromEntries(TABLES.map(({ name }) => [`/${name}`, { get: {} }])),
    definitions: Object.fromEntries(TABLES.map(({ name, primaryKey }) => [name, { properties: { [primaryKey]: { type: 'string', description: 'Note:\nThis is a Primary Key.<pk/>' } } }])),
  };
  inventoryOverride?.(metadata);
  const calls = [];
  const scans = {};
  const files = {};
  const manifests = [];
  let inflight = 0;
  let peak = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, redirect: options.redirect });
    assert.equal(options.headers.apikey, credential);
    assert.equal(options.headers.Authorization, `Bearer ${credential}`);
    assert.equal(options.headers['Accept-Profile'], 'public');
    assert.equal(options.headers.Prefer, 'count=exact');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.ok(url.startsWith(`${SOURCE_URL}/rest/v1/`));
    inflight++; peak = Math.max(peak, inflight);
    await Promise.resolve(); inflight--;
    const parsed = new URL(url);
    const name = parsed.pathname.split('/').at(-1);
    if (!name) return new Response(JSON.stringify(metadata), { status: 200 });
    const offset = Number(parsed.searchParams.get('offset'));
    const limit = Number(parsed.searchParams.get('limit'));
    assert.equal(parsed.searchParams.get('select'), '*');
    assert.equal(parsed.searchParams.get('order'), `${TABLES.find((table) => table.name === name).primaryKey}.asc`);
    assert.ok(limit <= 500);
    if (offset === 0) scans[name] = (scans[name] ?? 0) + 1;
    let current = structuredClone(data[name]);
    if (mutate) current = mutate(name, scans[name], current);
    const page = current.slice(offset, offset + limit);
    const headers = { 'content-range': current.length ? `${offset}-${offset + page.length - 1}/${current.length}` : '*/0' };
    return responseOverride?.({ name, scan: scans[name], offset, page, headers }) ?? new Response(JSON.stringify(page), { status: 200, headers });
  };
  const sink = {
    async begin(name) { files[name] = ''; },
    async row(name, line) { files[name] += line; },
    async finish() {},
    async metadata() {},
    async manifest(value) { manifests.push(structuredClone(value)); },
    async close() {},
  };
  return { fetchImpl, sink, files, calls, manifests, scans, peak: () => peak };
}
const run = (harness, extra = {}) => exportApplicationData({ serviceRoleKey: credential, fetchImpl: harness.fetchImpl, sink: harness.sink, limits: { ...LIMITS, pageSize: 2 }, ...extra });

test('paginated export verifies every table twice, preserves empty tables, and makes only sequential GETs', async () => {
  const harness = fixture();
  const manifest = await run(harness);
  assert.equal(manifest.status, 'completed');
  assert.equal(manifest.totalRows, 5);
  assert.equal(manifest.tables.length, 8);
  assert.equal(manifest.requests, 21); // metadata + (3 audit pages + 7 empty tables) * 2
  assert.equal(harness.peak(), 1);
  assert.ok(Object.values(harness.scans).every((value) => value === 2));
  const audit = manifest.tables.find((table) => table.name === 'audit_logs');
  assert.equal(audit.sha256, createHash('sha256').update(harness.files.audit_logs).digest('hex'));
  assert.ok(manifest.tables.every((table) => table.verification === 'two_pass_match'));
  assert.deepEqual(manifest.declaredButNotExposed, ['ticket_drafts']);
  assert.equal(manifest.atomicSnapshot, false);
  assert.equal(manifest.authCredentialsBackup, false);
  assert.equal(JSON.stringify(manifest).includes('fixture-personal-value'), false);
  assert.equal(JSON.stringify(manifest).includes(credential), false);
});

test('short pages are rejected rather than silently treated as full exports', async () => {
  const harness = fixture({ responseOverride: ({ name, page, headers }) => name === 'audit_logs' ? new Response(JSON.stringify(page.slice(0, 1)), { headers: { ...headers, 'content-range': '0-0/5' } }) : undefined });
  await assert.rejects(run(harness), { code: 'TRUNCATED_PAGE' });
  assert.equal(harness.manifests.at(-1).status, 'failed');
});

test('equal counts with changed private content fail the independent second pass', async () => {
  const harness = fixture({ mutate: (name, scan, rows) => {
    if (name === 'audit_logs' && scan === 2) rows[0].metadata.private = 'changed';
    return rows;
  } });
  await assert.rejects(run(harness), { code: 'UNSTABLE_DATA' });
  assert.equal(harness.manifests.at(-1).failureCode, 'UNSTABLE_DATA');
});

test('changing row counts between passes fails verification', async () => {
  const harness = fixture({ mutate: (name, scan, rows) => name === 'audit_logs' && scan === 2 ? rows.slice(1) : rows });
  await assert.rejects(run(harness), { code: 'UNSTABLE_DATA' });
});

test('duplicate primary keys across page boundaries fail closed', async () => {
  const harness = fixture({ rows: { profiles: [{ id: 'a' }, { id: 'b' }, { id: 'a' }] } });
  await assert.rejects(run(harness), { code: 'DUPLICATE_KEY' });
});

test('missing, unknown, or composite inventory keys stop before any row export', async () => {
  for (const inventoryOverride of [
    (doc) => { delete doc.paths['/profiles']; },
    (doc) => { doc.paths['/unexpected_table'] = { get: {} }; },
    (doc) => { doc.definitions.profiles.properties.other = { description: '<pk/>' }; },
  ]) {
    const harness = fixture({ inventoryOverride });
    await assert.rejects(run(harness), (error) => ['INVENTORY_MISMATCH', 'PRIMARY_KEY_MISMATCH'].includes(error.code));
    assert.equal(harness.calls.length, 1);
    assert.deepEqual(harness.files, {});
  }
});

test('wire byte and record budgets stop oversized exports', async () => {
  const byteHarness = fixture();
  await assert.rejects(run(byteHarness, { limits: { ...LIMITS, maxBytes: 10 } }), { code: 'BUDGET_EXCEEDED' });
  const rowHarness = fixture();
  await assert.rejects(run(rowHarness, { limits: { ...LIMITS, pageSize: 2, maxRows: 3 } }), { code: 'BUDGET_EXCEEDED' });
});

test('HTTP and transport errors never expose server bodies, credentials, or stack messages', async () => {
  const harness = fixture();
  const body = `secret=${credential}, user=fixture-personal-value`;
  for (const fetchImpl of [
    async () => new Response(body, { status: 500 }),
    async () => { throw new Error(body); },
  ]) {
    let failure;
    try { await exportApplicationData({ serviceRoleKey: credential, sink: harness.sink, fetchImpl }); } catch (error) { failure = safeFailure(error); }
    assert.ok(['HTTP_ERROR', 'NETWORK_ERROR'].includes(failure.code));
    assert.equal(JSON.stringify(failure).includes(credential), false);
    assert.equal(JSON.stringify(harness.manifests).includes(credential), false);
    assert.equal(JSON.stringify(harness.manifests).includes('fixture-personal-value'), false);
  }
  assert.deepEqual(safeFailure(new Error(body)), { status: 'failed', code: 'INTERNAL_ERROR' });
});

test('request timeouts abort without returning raw transport details', async () => {
  const harness = fixture();
  const fetchImpl = async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error(credential)), { once: true }));
  await assert.rejects(exportApplicationData({ serviceRoleKey: credential, sink: harness.sink, fetchImpl, limits: { ...LIMITS, timeoutMs: 10 } }), { code: 'TIMEOUT' });
  assert.equal(JSON.stringify(harness.manifests).includes(credential), false);
});

test('canonical serialization preserves arbitrary precision numeric tokens and rejects invalid JSON', () => {
  assert.equal(canonicalJson(parseLosslessJson('{"z":9007199254740993,"a":0.12345678901234567890123456789,"b":-0,"c":1e300}')), '{"a":0.12345678901234567890123456789,"b":-0,"c":1e300,"z":9007199254740993}');
  for (const text of ['{"a":1,"a":2}', '{"x":01}', '[1,]', '"bad\nstring"', '{"x":true}junk']) {
    assert.throws(() => parseLosslessJson(text), ExportError);
  }
});

test('CLI refuses missing secrets, alternate output paths, and unsafe options without exposing input', async () => {
  assert.throws(() => validateOutputPath('./relative'), { code: 'OUTPUT_PATH' });
  assert.throws(() => validateOutputPath(pathOutsideAllowed()), { code: 'OUTPUT_PATH' });
  assert.deepEqual(await main(['--url', credential], {}), { status: 'failed', code: 'CONFIGURATION' });
});
function pathOutsideAllowed() { return process.platform === 'win32' ? 'C:/Windows/fixture-export' : '/tmp/fixture-export'; }
