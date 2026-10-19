import { createHash } from 'node:crypto';
import { lstat, mkdir, open, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// This is a read-only, partial application-data export, not pg_dump or a restore.
export const SOURCE_URL = 'https://ypszaogebsbynwzbatse.supabase.co';
export const ALLOWED_OUTPUT_ROOT = 'C:/Users/User/.codex/visualizations/2026/10/13/01a135ac-fd9b-72c2-af1c-eb4bb9c7b4ff/followup-validation-2026-10-16/main-readiness/app-data-backup-2026-10-19';
export const TABLES = Object.freeze([
  { name: 'app_settings', primaryKey: 'key' },
  { name: 'audit_logs', primaryKey: 'id' },
  { name: 'customer_mail_mappings', primaryKey: 'id' },
  { name: 'engineer_signatures', primaryKey: 'id' },
  { name: 'generated_documents', primaryKey: 'id' },
  { name: 'profiles', primaryKey: 'id' },
  { name: 'ticket_sends', primaryKey: 'id' },
  { name: 'user_preferences', primaryKey: 'user_id' },
].map(Object.freeze));
export const LIMITS = Object.freeze({ pageSize: 500, maxRows: 50_000, maxBytes: 100 * 1024 * 1024, pageBytes: 8 * 1024 * 1024, timeoutMs: 20_000, durationMs: 600_000 });

const SAFE_CODES = new Set(['CONFIGURATION', 'OUTPUT_EXISTS', 'OUTPUT_PATH', 'IO_ERROR', 'NETWORK_ERROR', 'HTTP_ERROR', 'TIMEOUT', 'BUDGET_EXCEEDED', 'INVALID_JSON', 'INVENTORY_MISMATCH', 'PRIMARY_KEY_MISMATCH', 'INVALID_RANGE', 'TRUNCATED_PAGE', 'INVALID_ROW', 'DUPLICATE_KEY', 'UNSTABLE_DATA', 'INTERNAL_ERROR']);
export class ExportError extends Error {
  constructor(code) { super(SAFE_CODES.has(code) ? code : 'INTERNAL_ERROR'); this.name = 'ExportError'; this.code = this.message; }
}
const fail = (code) => { throw new ExportError(code); };
export const safeFailure = (error) => ({ status: 'failed', code: error instanceof ExportError ? error.code : 'INTERNAL_ERROR' });
const digest = (value) => createHash('sha256').update(value).digest('hex');

// Preserve JSON number tokens rather than rounding PostgreSQL numeric/JSONB
// values through JavaScript Number. Object keys are sorted for stable hashing.
const NUMBER = Symbol('json-number');
export function parseLosslessJson(text) {
  let i = 0;
  const whitespace = () => { while (/[ \r\n\t]/.test(text[i] ?? '') && i < text.length) i++; };
  function value(depth = 0) {
    if (depth > 100) fail('INVALID_JSON');
    whitespace();
    const ch = text[i];
    if (ch === '"') {
      const start = i++;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i++] === '"') {
          try { return JSON.parse(text.slice(start, i)); } catch { fail('INVALID_JSON'); }
        }
      }
      fail('INVALID_JSON');
    }
    if (ch === '[' || ch === '{') {
      const array = ch === '[';
      const end = array ? ']' : '}';
      const result = array ? [] : Object.create(null);
      i++; whitespace();
      if (text[i] === end) { i++; return result; }
      while (i < text.length) {
        if (array) result.push(value(depth + 1));
        else {
          const key = value(depth + 1);
          if (typeof key !== 'string' || Object.hasOwn(result, key)) fail('INVALID_JSON');
          whitespace(); if (text[i++] !== ':') fail('INVALID_JSON');
          result[key] = value(depth + 1);
        }
        whitespace();
        if (text[i] === end) { i++; return result; }
        if (text[i++] !== ',') fail('INVALID_JSON');
      }
      fail('INVALID_JSON');
    }
    for (const [token, result] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(token, i)) { i += token.length; return result; }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
    if (!match) fail('INVALID_JSON');
    i += match[0].length;
    return { [NUMBER]: match[0] };
  }
  const result = value(); whitespace();
  if (i !== text.length) fail('INVALID_JSON');
  return result;
}
export function canonicalJson(value) {
  if (value && typeof value === 'object' && NUMBER in value) return value[NUMBER];
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function verifyInventory(document) {
  const names = Object.keys(document?.paths ?? {}).filter((key) => /^\/[a-z][a-z0-9_]*$/.test(key)).map((key) => key.slice(1)).sort();
  if (JSON.stringify(names) !== JSON.stringify(TABLES.map((table) => table.name))) fail('INVENTORY_MISMATCH');
  for (const table of TABLES) {
    const definition = document.definitions?.[table.name];
    const keys = Object.entries(definition?.properties ?? {}).filter(([, spec]) => typeof spec.description === 'string' && spec.description.includes('<pk/>')).map(([name]) => name);
    if (keys.length !== 1 || keys[0] !== table.primaryKey || !document.paths[`/${table.name}`]?.get) fail('PRIMARY_KEY_MISMATCH');
  }
}

function validateLimits(limits) {
  for (const [name, hardLimit] of Object.entries(LIMITS)) {
    if (!Number.isSafeInteger(limits[name]) || limits[name] <= 0 || limits[name] > hardLimit) fail('CONFIGURATION');
  }
}
async function readBounded(response, budget, limits) {
  const chunks = [];
  let size = 0;
  const reader = response.body?.getReader();
  if (!reader) fail('INVALID_JSON');
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      budget.bytes += value.byteLength;
      if (size > limits.pageBytes || budget.bytes > limits.maxBytes) fail('BUDGET_EXCEEDED');
      chunks.push(value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof ExportError) throw error;
    fail('INVALID_JSON');
  } finally { reader.releaseLock(); }
}
function parseRange(value, offset, rows, limit) {
  if (rows === 0 && value === '*/0' && offset === 0) return 0;
  const match = /^(\d+)-(\d+)\/(\d+)$/.exec(value ?? '');
  if (!match) fail('INVALID_RANGE');
  const [start, end, total] = match.slice(1).map(Number);
  if (![start, end, total].every(Number.isSafeInteger) || start !== offset || end !== offset + rows - 1 || end >= total || rows > limit) fail('INVALID_RANGE');
  if (rows !== Math.min(limit, total - offset)) fail('TRUNCATED_PAGE');
  return total;
}

// Testable core uses a sink so fixtures never need credentials or real files.
// Requests are sequential GETs to the fixed source; redirects are rejected.
export async function exportApplicationData({ serviceRoleKey, fetchImpl = fetch, sink, limits = LIMITS, now = Date.now }) {
  validateLimits(limits);
  if (typeof serviceRoleKey !== 'string' || serviceRoleKey.length < 20 || /\s/.test(serviceRoleKey)) fail('CONFIGURATION');
  const started = now();
  const budget = { bytes: 0, rows: 0, firstPassRows: 0, requests: 0 };
  const manifest = {
    format: 'check-server-rest-app-data-v1', status: 'in_progress', source: SOURCE_URL,
    startedAt: new Date(started).toISOString(), schema: 'public', readOnly: true,
    scope: 'partial_application_data_only', atomicSnapshot: false,
    schemaBackup: false, authCredentialsBackup: false, storageObjectsIncluded: false,
    declaredButNotExposed: ['ticket_drafts'],
    limitations: [
      'Two sequential read passes check equal counts and content; this is not a transactionally consistent snapshot across tables.',
      'Only the eight currently REST-exposed application tables are included. ticket_drafts is declared in local migrations but not exposed by the source API; its physical existence was not established.',
      'No PostgreSQL schema, functions, grants, policies, extensions, auth credentials, managed schemas, or Storage object contents are included.',
      'Auth user ID references are preserved but cannot independently restore login users. No restore has been executed.',
      'Records are private local NDJSON. Object keys are sorted; JSON number token precision is preserved; SQL types are not reconstructed.',
    ], tables: [],
  };
  await sink.manifest(manifest);
  async function get(resource) {
    if (now() - started >= limits.durationMs) fail('BUDGET_EXCEEDED');
    budget.requests++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(limits.timeoutMs, limits.durationMs - (now() - started)));
    try {
      const response = await fetchImpl(`${SOURCE_URL}/rest/v1/${resource}`, {
        method: 'GET', redirect: 'error', signal: controller.signal,
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Accept-Profile': 'public', Prefer: 'count=exact', Accept: resource === '' ? 'application/openapi+json' : 'application/json' },
      });
      if (![200, 206].includes(response.status)) {
        await response.body?.cancel().catch(() => {}); fail('HTTP_ERROR');
      }
      const text = await readBounded(response, budget, limits);
      return { text, contentRange: response.headers.get('content-range') };
    } catch (error) {
      if (controller.signal.aborted) fail('TIMEOUT');
      if (error instanceof ExportError) throw error;
      fail('NETWORK_ERROR');
    } finally { clearTimeout(timer); }
  }
  try {
    const metadata = await get('');
    let document;
    try { document = JSON.parse(metadata.text); } catch { fail('INVALID_JSON'); }
    verifyInventory(document);
    await sink.metadata(metadata.text);
    manifest.apiMetadataSha256 = digest(metadata.text);
    async function pass(table, save) {
      let expected = null;
      let count = 0;
      let bytes = 0;
      const keys = new Set();
      const hash = createHash('sha256');
      while (expected === null || count < expected) {
        const query = new URLSearchParams({ select: '*', order: `${table.primaryKey}.asc`, offset: String(count), limit: String(limits.pageSize) });
        const response = await get(`${table.name}?${query}`);
        const rows = parseLosslessJson(response.text);
        if (!Array.isArray(rows)) fail('INVALID_ROW');
        const total = parseRange(response.contentRange, count, rows.length, limits.pageSize);
        if (expected !== null && expected !== total) fail('UNSTABLE_DATA');
        expected = total;
        if (total > limits.maxRows || budget.rows + rows.length > limits.maxRows * 2) fail('BUDGET_EXCEEDED');
        if (save && budget.firstPassRows + rows.length > limits.maxRows) fail('BUDGET_EXCEEDED');
        budget.rows += rows.length;
        if (save) budget.firstPassRows += rows.length;
        for (const row of rows) {
          if (!row || Array.isArray(row) || typeof row[table.primaryKey] !== 'string' || !row[table.primaryKey]) fail('INVALID_ROW');
          const key = row[table.primaryKey];
          if (keys.has(key)) fail('DUPLICATE_KEY');
          keys.add(key);
          const line = `${canonicalJson(row)}\n`;
          bytes += Buffer.byteLength(line);
          hash.update(line);
          if (save) await sink.row(table.name, line);
        }
        count += rows.length;
      }
      return { name: table.name, primaryKey: table.primaryKey, count, bytes, sha256: hash.digest('hex') };
    }
    // Finish all first-pass files before starting the independent second scan.
    let firstPassRows = 0;
    for (const table of TABLES) {
      await sink.begin(table.name);
      const result = await pass(table, true);
      firstPassRows += result.count;
      if (firstPassRows > limits.maxRows) fail('BUDGET_EXCEEDED');
      await sink.finish(table.name);
      manifest.tables.push({ ...result, file: `${table.name}.ndjson`, verification: 'pending' });
      await sink.manifest(manifest);
    }
    for (const table of TABLES) {
      const second = await pass(table, false);
      const first = manifest.tables.find((item) => item.name === table.name);
      if (first.count !== second.count || first.bytes !== second.bytes || first.sha256 !== second.sha256) fail('UNSTABLE_DATA');
      first.verification = 'two_pass_match';
      await sink.manifest(manifest);
    }
    manifest.status = 'completed';
    manifest.completedAt = new Date(now()).toISOString();
    manifest.totalRows = firstPassRows;
    manifest.totalDataBytes = manifest.tables.reduce((sum, table) => sum + table.bytes, 0);
    manifest.requests = budget.requests;
    manifest.receivedBytes = budget.bytes;
    await sink.manifest(manifest);
    return manifest;
  } catch (error) {
    manifest.status = 'failed';
    manifest.failureCode = safeFailure(error).code;
    await sink.manifest(manifest).catch(() => {});
    throw new ExportError(manifest.failureCode);
  } finally { await sink.close?.(); }
}

export function validateOutputPath(output) {
  if (typeof output !== 'string' || !path.isAbsolute(output)) fail('OUTPUT_PATH');
  const root = path.resolve(ALLOWED_OUTPUT_ROOT);
  const resolved = path.resolve(output);
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('OUTPUT_PATH');
  return resolved;
}
async function createFileSink(output) {
  // Reject symlink/junction ancestors rather than following an output redirect.
  let current = output;
  while (true) {
    try { if ((await lstat(current)).isSymbolicLink()) fail('OUTPUT_PATH'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  try { await mkdir(output, { mode: 0o700 }); } catch (error) {
    if (error.code === 'EEXIST') fail('OUTPUT_EXISTS');
    fail('IO_ERROR');
  }
  let handle;
  return {
    async metadata(text) { await writeFile(path.join(output, 'rest-api-metadata.json'), text, { flag: 'wx', mode: 0o600 }); },
    async begin(name) { handle = await open(path.join(output, `${name}.ndjson.partial`), 'wx', 0o600); },
    async row(_name, line) { await handle.writeFile(line, 'utf8'); },
    async finish(name) { await handle.sync(); await handle.close(); handle = null; await rename(path.join(output, `${name}.ndjson.partial`), path.join(output, `${name}.ndjson`)); },
    async manifest(value) {
      await writeFile(path.join(output, 'manifest.json.tmp'), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
      await rename(path.join(output, 'manifest.json.tmp'), path.join(output, 'manifest.json'));
    },
    async close() { if (handle) await handle.close(); },
  };
}
export async function main(args, env = process.env) {
  try {
    if (args.length !== 2 || args[0] !== '--out') fail('CONFIGURATION');
    const output = validateOutputPath(args[1]);
    const key = env.RECOVERY_SOURCE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
    if (typeof key !== 'string' || key.length < 20 || /\s/.test(key)) fail('CONFIGURATION');
    const sink = await createFileSink(output);
    const manifest = await exportApplicationData({ serviceRoleKey: key, sink });
    return { status: manifest.status, scope: manifest.scope, tables: manifest.tables.map(({ name, count, bytes, sha256, verification }) => ({ name, count, bytes, sha256, verification })), totalRows: manifest.totalRows, totalDataBytes: manifest.totalDataBytes, atomicSnapshot: false, restoreExecuted: false };
  } catch (error) { return safeFailure(error); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const summary = await main(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (summary.status !== 'completed') process.exitCode = 1;
}
