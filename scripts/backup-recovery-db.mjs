// Source-only custom-format PostgreSQL backup. No restore or database writes.
// Supply RECOVERY_SOURCE_DB_URL through the parent environment / node --env-file.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SOURCE_REF = 'ypszaogebsbynwzbatse';
export const PRIVATE_ROOT = 'C:/Users/User/.codex/visualizations/2026/10/13/01a135ac-fd9b-72c2-af1c-eb4bb9c7b4ff/private-recovery-2026-10-19';
export const PG_DUMP = 'C:/Program Files/PostgreSQL/17/bin/pg_dump.exe';
export const PG_RESTORE = 'C:/Program Files/PostgreSQL/17/bin/pg_restore.exe';
export const LIMITS = Object.freeze({ durationMs: 300_000, archiveBytes: 1024 * 1024 * 1024, outputBytes: 8 * 1024 * 1024 });
const CODES = new Set(['SOURCE_URL_REQUIRED', 'SOURCE_URL_INVALID', 'SOURCE_ENDPOINT_MISMATCH', 'SOURCE_OPTIONS_INVALID', 'SOURCE_PASSWORD_INVALID', 'OUTPUT_PATH_INVALID', 'OUTPUT_EXISTS', 'TOOL_VERSION_MISMATCH', 'TOOL_START_FAILED', 'TOOL_FAILED', 'TIMEOUT', 'OUTPUT_LIMIT', 'ARCHIVE_INVALID', 'ARCHIVE_LIMIT', 'TOC_INVALID', 'REQUIRED_CONTENT_MISSING', 'IO_FAILED', 'CONFIGURATION', 'BACKUP_FAILED']);
export class BackupFailure extends Error {
  constructor(code) { super(CODES.has(code) ? code : 'BACKUP_FAILED'); this.name = 'BackupFailure'; this.code = this.message; }
}
const fail = (code) => { throw new BackupFailure(code); };
export const safeError = (error) => error instanceof BackupFailure ? error.code : 'BACKUP_FAILED';

export function parseSourceConnection(value) {
  if (typeof value !== 'string' || !value.trim()) fail('SOURCE_URL_REQUIRED');
  let url, user, password;
  try {
    url = new URL(value);
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch { fail('SOURCE_URL_INVALID'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hash || url.pathname !== '/postgres' || (url.port && url.port !== '5432')) fail('SOURCE_URL_INVALID');
  const direct = url.hostname === `db.${SOURCE_REF}.supabase.co` && user === 'postgres';
  const sessionPooler = url.hostname === 'aws-1-ap-southeast-1.pooler.supabase.com' && user === `postgres.${SOURCE_REF}`;
  if (!direct && !sessionPooler) fail('SOURCE_ENDPOINT_MISMATCH');
  if (!password || /[\u0000-\u001f\u007f]/.test(password)) fail('SOURCE_PASSWORD_INVALID');
  const options = [...url.searchParams];
  if (options.length > 1 || options.some(([key, val]) => key !== 'sslmode' || !['require', 'verify-full'].includes(val))) fail('SOURCE_OPTIONS_INVALID');
  return { host: url.hostname, port: '5432', user, password, database: 'postgres', sslMode: url.searchParams.get('sslmode') ?? 'require' };
}
export function minimalEnvironment(parent = process.env, connection) {
  const env = {};
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP']) if (typeof parent[key] === 'string') env[key] = parent[key];
  if (!connection) return env;
  return { ...env, PGHOST: connection.host, PGPORT: connection.port, PGUSER: connection.user, PGPASSWORD: connection.password, PGDATABASE: connection.database, PGSSLMODE: connection.sslMode, PGCONNECT_TIMEOUT: '10', PGAPPNAME: 'check-server-source-backup', PGOPTIONS: '-c default_transaction_read_only=on -c lock_timeout=10000', PGCLIENTENCODING: 'UTF8', LC_ALL: 'C' };
}
export function validateOutputDirectory(output) {
  if (typeof output !== 'string' || !path.isAbsolute(output)) fail('OUTPUT_PATH_INVALID');
  const resolved = path.resolve(output);
  const relative = path.relative(path.resolve(PRIVATE_ROOT), resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('OUTPUT_PATH_INVALID');
  return resolved;
}

export function toolVersion(stdout, command) {
  const pattern = command === 'pg_dump' ? /^pg_dump \(PostgreSQL\) (17\.9)(?:\s.*)?$/ : /^pg_restore \(PostgreSQL\) (17\.9)(?:\s.*)?$/;
  const match = pattern.exec(stdout.trim());
  if (!match) fail('TOOL_VERSION_MISMATCH');
  return match[1];
}
const TYPES = ['MATERIALIZED VIEW DATA', 'FOREIGN DATA WRAPPER', 'PUBLICATION TABLE', 'DATABASE PROPERTIES', 'SEQUENCE OWNED BY', 'DEFAULT ACL', 'FK CONSTRAINT', 'TABLE ATTACH', 'INDEX ATTACH', 'TABLE DATA', 'SEQUENCE SET', 'ROW SECURITY', 'BLOB COMMENTS', 'BLOB METADATA', 'SHELL TYPE', 'ACCESS METHOD', 'EVENT TRIGGER', 'FOREIGN TABLE', 'TEXT SEARCH CONFIGURATION', 'TEXT SEARCH DICTIONARY', 'TEXT SEARCH PARSER', 'TEXT SEARCH TEMPLATE', 'MATERIALIZED VIEW', 'PROCEDURAL LANGUAGE', 'PUBLICATION', 'SUBSCRIPTION', 'EXTENSION', 'SCHEMA', 'DATABASE', 'TABLE', 'VIEW', 'SEQUENCE', 'FUNCTION', 'PROCEDURE', 'AGGREGATE', 'TYPE', 'DOMAIN', 'COLLATION', 'OPERATOR', 'OPERATOR CLASS', 'OPERATOR FAMILY', 'CAST', 'TRANSFORM', 'CONVERSION', 'CONSTRAINT', 'INDEX', 'TRIGGER', 'RULE', 'POLICY', 'ACL', 'COMMENT', 'BLOBS', 'BLOB', 'STATISTICS', 'SERVER', 'USER MAPPING', 'ENCODING', 'STDSTRINGS', 'SEARCHPATH'].sort((a, b) => b.length - a.length);
const PUBLIC_TABLES = ['app_settings', 'audit_logs', 'customer_mail_mappings', 'engineer_signatures', 'generated_documents', 'profiles', 'ticket_sends', 'user_preferences'];
export function inspectToc(toc) {
  if (typeof toc !== 'string' || !toc.startsWith(';')) fail('TOC_INVALID');
  const sourceVersion = /^;\s*Dumped from database version:\s*(17\.\d+)(?:\s.*)?$/m.exec(toc)?.[1];
  const dumpVersion = /^;\s*Dumped by pg_dump version:\s*(17\.9)(?:\s.*)?$/m.exec(toc)?.[1];
  const declaredCount = /^;\s*TOC Entries:\s*(\d+)\s*$/m.exec(toc)?.[1];
  if (!sourceVersion || !dumpVersion || !declaredCount) fail('TOC_INVALID');
  const types = {};
  const dataTables = new Set();
  const schemaDataCounts = { public: 0, auth: 0, storage: 0, other: 0 };
  let entryCount = 0;
  for (const line of toc.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith(';')) continue;
    const match = /^\d+;\s+\d+\s+\d+\s+(.+)$/.exec(line);
    if (!match) fail('TOC_INVALID');
    entryCount++;
    const descriptor = TYPES.find((type) => match[1].startsWith(`${type} `)) ?? 'OTHER';
    types[descriptor] = (types[descriptor] ?? 0) + 1;
    if (descriptor === 'TABLE DATA') {
      const tableMatch = /^TABLE DATA ([a-z_][a-z0-9_]*) ([a-z_][a-z0-9_]*) /.exec(match[1]);
      if (tableMatch) {
        dataTables.add(`${tableMatch[1]}.${tableMatch[2]}`);
        schemaDataCounts[Object.hasOwn(schemaDataCounts, tableMatch[1]) ? tableMatch[1] : 'other']++;
      } else schemaDataCounts.other++;
    }
  }
  if (!entryCount || Number(declaredCount) < entryCount) fail('TOC_INVALID');
  const required = [...PUBLIC_TABLES.map((table) => `public.${table}`), 'auth.users', 'auth.identities', 'storage.buckets', 'storage.objects'];
  if (required.some((name) => !dataTables.has(name))) fail('REQUIRED_CONTENT_MISSING');
  return { sourceVersion, dumpVersion, listedEntries: entryCount, archiveDeclaredEntries: Number(declaredCount), objectTypeCounts: types, tableDataCountsBySchema: schemaDataCounts, requiredPublicTableDataEntries: PUBLIC_TABLES.length, requiredAuthTableDataPresent: true, requiredStorageMetadataPresent: true };
}

export async function runNative(executable, args, { env, timeoutMs, maxOutputBytes = LIMITS.outputBytes }) {
  return new Promise((resolve, reject) => {
    let child, bytes = 0, stopped = false, timer;
    const stdout = [];
    const stop = (code) => {
      if (stopped) return;
      stopped = true; clearTimeout(timer);
      child?.kill();
      reject(new BackupFailure(code));
    };
    try { child = spawn(executable, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { reject(new BackupFailure('TOOL_START_FAILED')); return; }
    timer = setTimeout(() => stop('TIMEOUT'), timeoutMs);
    // stderr is counted but never stored, returned, or printed; native messages
    // may contain sensitive connection or object information.
    for (const [name, stream] of [['stdout', child.stdout], ['stderr', child.stderr]]) stream.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) { stop('OUTPUT_LIMIT'); return; }
      if (name === 'stdout' && !stopped) stdout.push(chunk);
    });
    child.on('error', () => stop('TOOL_START_FAILED'));
    child.on('close', (code) => {
      if (stopped) return;
      stopped = true; clearTimeout(timer);
      if (code !== 0) reject(new BackupFailure('TOOL_FAILED'));
      else resolve(Buffer.concat(stdout).toString('utf8'));
    });
  });
}

function fileStore(output) {
  const partial = path.join(output, 'source-database.dump.partial');
  const archive = path.join(output, 'source-database.dump');
  const tocPartial = path.join(output, 'source-database.toc.txt.partial');
  return {
    partial,
    tocPartial,
    async initialize() {
      let current = output;
      while (true) {
        try { if ((await lstat(current)).isSymbolicLink()) fail('OUTPUT_PATH_INVALID'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        const parent = path.dirname(current); if (parent === current) break; current = parent;
      }
      try { await mkdir(output, { mode: 0o700 }); }
      catch (error) { if (error.code === 'EEXIST') fail('OUTPUT_EXISTS'); fail('IO_FAILED'); }
    },
    async inspectArchive() {
      const info = await stat(partial);
      if (!info.isFile() || info.size < 5) fail('ARCHIVE_INVALID');
      if (info.size > LIMITS.archiveBytes) fail('ARCHIVE_LIMIT');
      const handle = await open(partial, 'r');
      try { const header = Buffer.alloc(5); await handle.read(header, 0, 5, 0); if (header.toString('ascii') !== 'PGDMP') fail('ARCHIVE_INVALID'); }
      finally { await handle.close(); }
      const hash = createHash('sha256');
      let bytes = 0;
      for await (const chunk of createReadStream(partial)) { bytes += chunk.length; if (bytes > LIMITS.archiveBytes) fail('ARCHIVE_LIMIT'); hash.update(chunk); }
      if (bytes !== info.size) fail('ARCHIVE_INVALID');
      return { bytes, sha256: hash.digest('hex') };
    },
    async readToc() {
      const info = await stat(tocPartial);
      if (!info.isFile() || !info.size || info.size > LIMITS.outputBytes) fail('TOC_INVALID');
      return readFile(tocPartial);
    },
    async promote() {
      await rename(tocPartial, path.join(output, 'source-database.toc.txt'));
      await rename(partial, archive);
    },
    async saveManifest(manifest) {
      await writeFile(path.join(output, 'manifest.json.tmp'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
      await rename(path.join(output, 'manifest.json.tmp'), path.join(output, 'manifest.json'));
    },
  };
}

export async function backupSourceDatabase({ sourceUrl, outputDir, parentEnvironment = process.env, native = runNative, store, now = Date.now }) {
  const connection = parseSourceConnection(sourceUrl);
  const output = validateOutputDirectory(outputDir);
  const storage = store ?? fileStore(output);
  const started = now();
  let initialized = false;
  const manifest = {
    format: 'check-server-custom-pg-dump-v1', status: 'in_progress', sourceProject: SOURCE_REF,
    startedAt: new Date(started).toISOString(), operation: 'source_only_database_backup',
    targetAccessed: false, restoreExecuted: false, sourceWritesRequested: false,
    pgOptionsReadOnlyRequested: true, database: 'postgres', archiveFormat: 'custom',
    scope: 'standard_pg_dump_database_scope', authDataExcluded: false, schemaFilters: [], tableFilters: [],
    rolesIncluded: false, storageObjectBytesIncluded: false,
    limitations: [
      'Standard pg_dump database scope includes application and dumpable managed-schema objects; this is not a physical server backup. Cluster-global role definitions and role passwords are excluded and require a separate recovery plan.',
      'Auth data entries are included. Credentials and database rows remain only in the private local archive; none are displayed in this manifest.',
      'Storage database metadata is included; external Storage file bytes require their separate backup.',
      'pg_restore --list validates the archive table of contents, not every compressed data block or a working restored database.',
      'No target connection, restore, production deployment, or source write is performed. Restore compatibility, roles, RLS, and application operation still need separate validation.',
      'PGOPTIONS requests read-only operation; a pooler may ignore startup options. pg_dump is a read-only backup operation. No SQL mutation command is used.',
    ],
  };
  const command = async (executable, args, includeConnection = false) => {
    const remaining = LIMITS.durationMs - (now() - started);
    if (remaining <= 0) fail('TIMEOUT');
    return native(executable, args, { env: minimalEnvironment(parentEnvironment, includeConnection ? connection : undefined), timeoutMs: remaining, maxOutputBytes: LIMITS.outputBytes });
  };
  try {
    await storage.initialize(); initialized = true;
    await storage.saveManifest(manifest);
    const dumpVersion = toolVersion(await command(PG_DUMP, ['--version']), 'pg_dump');
    const restoreVersion = toolVersion(await command(PG_RESTORE, ['--version']), 'pg_restore');
    await command(PG_DUMP, ['--no-password', '--format=custom', '--quote-all-identifiers', '--lock-wait-timeout=10s', '--file', storage.partial], true);
    const archive = await storage.inspectArchive();
    await command(PG_RESTORE, ['--list', '--file', storage.tocPartial, storage.partial]);
    const tocBytes = await storage.readToc();
    let toc;
    try { toc = new TextDecoder('utf-8', { fatal: true }).decode(tocBytes); } catch { fail('TOC_INVALID'); }
    const structure = inspectToc(toc);
    if (now() - started >= LIMITS.durationMs) fail('TIMEOUT');
    await storage.promote();
    manifest.status = 'completed';
    manifest.completedAt = new Date(now()).toISOString();
    manifest.nativeVersions = { pgDump: dumpVersion, pgRestore: restoreVersion };
    manifest.archive = { file: 'source-database.dump', ...archive };
    manifest.toc = { file: 'source-database.toc.txt', bytes: tocBytes.length, sha256: createHash('sha256').update(tocBytes).digest('hex'), ...structure };
    await storage.saveManifest(manifest);
    return manifest;
  } catch (error) {
    manifest.status = 'failed'; manifest.failureCode = safeError(error);
    if (initialized) await storage.saveManifest(manifest).catch(() => {});
    throw new BackupFailure(manifest.failureCode);
  } finally { connection.password = ''; }
}

export async function main(args, env = process.env) {
  try {
    if (args.length !== 2 || args[0] !== '--out') fail('CONFIGURATION');
    const result = await backupSourceDatabase({ sourceUrl: env.RECOVERY_SOURCE_DB_URL, outputDir: args[1], parentEnvironment: env });
    return { status: result.status, sourceProject: SOURCE_REF, archiveBytes: result.archive.bytes, archiveSha256: result.archive.sha256, nativeVersions: result.nativeVersions, sourceVersion: result.toc.sourceVersion, listedEntries: result.toc.listedEntries, objectTypeCounts: result.toc.objectTypeCounts, tableDataCountsBySchema: result.toc.tableDataCountsBySchema, requiredAuthTableDataPresent: result.toc.requiredAuthTableDataPresent, authDataExcluded: false, targetAccessed: false, restoreExecuted: false, rolesIncluded: false, storageObjectBytesIncluded: false };
  } catch (error) { return { status: 'failed', code: safeError(error), targetAccessed: false, restoreExecuted: false }; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const summary = await main(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (summary.status !== 'completed') process.exitCode = 1;
}
