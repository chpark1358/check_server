import assert from 'node:assert/strict';
import test from 'node:test';
import { BackupFailure, SOURCE_REF, PRIVATE_ROOT, PG_DUMP, PG_RESTORE, LIMITS, parseSourceConnection, minimalEnvironment, inspectToc, backupSourceDatabase, main, safeError } from '../scripts/backup-recovery-db.mjs';

const SECRET = 'synthetic-@%\\#$ 한글-password';
const SOURCE = `postgresql://postgres.${SOURCE_REF}:${encodeURIComponent(SECRET)}@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require`;
const PUBLIC = ['app_settings', 'audit_logs', 'customer_mail_mappings', 'engineer_signatures', 'generated_documents', 'profiles', 'ticket_sends', 'user_preferences'];
function toc(overrides = {}) {
  const tables = overrides.tables ?? [...PUBLIC.map((name) => ['public', name]), ['auth', 'users'], ['auth', 'identities'], ['storage', 'buckets'], ['storage', 'objects']];
  const entries = tables.map(([schema, name], i) => `${i + 1}; 0 123 TABLE DATA ${schema} ${name} postgres`);
  return `;\n; TOC Entries: ${entries.length + 3}\n; Dumped from database version: ${overrides.sourceVersion ?? '17.6'}\n; Dumped by pg_dump version: 17.9\n;\n${entries.join('\n')}\n`;
}
function harness(options = {}) {
  const commands = [], manifests = [], events = [];
  const store = {
    partial: `${PRIVATE_ROOT}/full-db-backup/source-database.dump.partial`,
    tocPartial: `${PRIVATE_ROOT}/full-db-backup/source-database.toc.txt.partial`,
    async initialize() { events.push('initialize'); if (options.exists) throw new BackupFailure('OUTPUT_EXISTS'); },
    async inspectArchive() { events.push('inspect'); if (options.archiveError) throw new BackupFailure(options.archiveError); return { bytes: 12345, sha256: 'a'.repeat(64) }; },
    async readToc() { events.push('readToc'); return Buffer.from(options.toc ?? toc()); },
    async promote() { events.push('promote'); },
    async saveManifest(value) { manifests.push(structuredClone(value)); },
  };
  const native = async (executable, args, config) => {
    commands.push({ executable, args, config });
    assert.ok(config.timeoutMs > 0 && config.timeoutMs <= LIMITS.durationMs);
    assert.equal(config.maxOutputBytes, LIMITS.outputBytes);
    if (options.commandErrorAt === commands.length) throw options.error ?? new Error(`provider error ${SECRET} ${SOURCE}`);
    if (args[0] === '--version') return `${executable === PG_DUMP ? 'pg_dump' : 'pg_restore'} (PostgreSQL) ${options.toolVersion ?? '17.9'}\n`;
    return '';
  };
  return { commands, manifests, events, store, native };
}
const run = (h, options = {}) => backupSourceDatabase({ sourceUrl: SOURCE, outputDir: `${PRIVATE_ROOT}/full-db-backup`, store: h.store, native: h.native, parentEnvironment: {}, ...options });

test('custom backup uses the fixed source, includes auth data, validates native TOC, then promotes', async () => {
  const h = harness();
  const result = await run(h);
  assert.equal(result.status, 'completed');
  assert.equal(h.commands.length, 4);
  const dump = h.commands[2];
  assert.equal(dump.executable, PG_DUMP);
  assert.deepEqual(dump.args, ['--no-password', '--format=custom', '--quote-all-identifiers', '--lock-wait-timeout=10s', '--file', h.store.partial]);
  assert.equal(dump.config.env.PGPASSWORD, SECRET);
  assert.equal(dump.config.env.PGUSER, `postgres.${SOURCE_REF}`);
  assert.match(dump.config.env.PGOPTIONS, /default_transaction_read_only=on/);
  assert.ok(!JSON.stringify(dump.args).includes(SECRET));
  assert.ok(!dump.args.some((arg) => /exclude|schema-only|data-only|dbname|host|username/.test(arg)));
  const list = h.commands[3];
  assert.equal(list.executable, PG_RESTORE);
  assert.deepEqual(list.args, ['--list', '--file', h.store.tocPartial, h.store.partial]);
  assert.equal(list.config.env.PGPASSWORD, undefined);
  assert.deepEqual(h.events, ['initialize', 'inspect', 'readToc', 'promote']);
  assert.deepEqual(result.toc.tableDataCountsBySchema, { public: 8, auth: 2, storage: 2, other: 0 });
  assert.equal(result.authDataExcluded, false);
  assert.equal(result.rolesIncluded, false);
  assert.equal(result.storageObjectBytesIncluded, false);
  assert.equal(result.restoreExecuted, false);
  assert.equal(result.targetAccessed, false);
  assert.ok(!JSON.stringify(h.manifests).includes(SECRET));
  assert.ok(!JSON.stringify(h.manifests).includes(SOURCE));
});

test('connection parsing preserves special characters and rejects target or injected options', () => {
  const connection = parseSourceConnection(SOURCE);
  assert.equal(connection.password, SECRET);
  for (const value of [SOURCE.replace(SOURCE_REF, 'svbxgzgdvrrsjzeyrfsc'), SOURCE.replace('aws-1-ap-southeast-1', 'other-host'), SOURCE + '&options=-c%20default_transaction_read_only=off', SOURCE + '&sslmode=require', SOURCE.replace(':5432/', ':6543/'), SOURCE + '#fragment']) assert.throws(() => parseSourceConnection(value), BackupFailure);
  assert.throws(() => parseSourceConnection(''), { code: 'SOURCE_URL_REQUIRED' });
});

test('child environments exclude inherited PG settings, target credentials, and app secrets', () => {
  const parent = { SystemRoot: 'C:/Windows', PGOPTIONS: 'unsafe', PGSERVICEFILE: 'unsafe', SUPABASE_SERVICE_ROLE_KEY: 'fixture-key', RECOVERY_SOURCE_DB_URL: SOURCE };
  Object.defineProperty(parent, 'RECOVERY_TARGET_DB_URL', { get() { throw new Error('target must not be read'); } });
  const env = minimalEnvironment(parent, parseSourceConnection(SOURCE));
  assert.equal(env.SystemRoot, 'C:/Windows');
  assert.equal(env.PGPASSWORD, SECRET);
  assert.equal(env.PGSERVICEFILE, undefined);
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(env.RECOVERY_SOURCE_DB_URL, undefined);
  assert.equal(env.RECOVERY_TARGET_DB_URL, undefined);
  assert.notEqual(env.PGOPTIONS, 'unsafe');
  assert.deepEqual(minimalEnvironment(parent), { SystemRoot: 'C:/Windows' });
});

test('an existing output or path outside the private directory stops before any tool', async () => {
  const existing = harness({ exists: true });
  await assert.rejects(run(existing), { code: 'OUTPUT_EXISTS' });
  assert.equal(existing.commands.length, 0);
  assert.equal(existing.manifests.length, 0);
  const outside = harness();
  await assert.rejects(run(outside, { outputDir: 'C:/Users/User/projects/check_server/check_server_site/public/backup' }), { code: 'OUTPUT_PATH_INVALID' });
  assert.equal(outside.commands.length, 0);
});

test('wrong native versions stop before dump and mark an incomplete manifest', async () => {
  const h = harness({ toolVersion: '18.0' });
  await assert.rejects(run(h), { code: 'TOOL_VERSION_MISMATCH' });
  assert.equal(h.commands.length, 1);
  assert.equal(h.manifests.at(-1).status, 'failed');
  assert.ok(!h.events.includes('promote'));
});

test('dump failure, restore-list failure, and invalid archives never promote partial data', async () => {
  for (const options of [{ commandErrorAt: 3 }, { commandErrorAt: 4 }, { archiveError: 'ARCHIVE_INVALID' }, { archiveError: 'ARCHIVE_LIMIT' }]) {
    const h = harness(options);
    await assert.rejects(run(h), BackupFailure);
    assert.equal(h.manifests.at(-1).status, 'failed');
    assert.ok(!h.events.includes('promote'));
    assert.ok(!JSON.stringify(h.manifests).includes(SECRET));
    assert.ok(!JSON.stringify(h.manifests).includes('provider error'));
  }
});

test('missing auth or business table data and malformed TOC fail closed', async () => {
  for (const body of [toc({ tables: PUBLIC.map((name) => ['public', name]) }), toc({ tables: [['auth', 'users'], ['auth', 'identities'], ['storage', 'buckets'], ['storage', 'objects']] }), '; broken archive listing', toc({ sourceVersion: '18.0' })]) {
    const h = harness({ toc: body });
    await assert.rejects(run(h), (error) => ['REQUIRED_CONTENT_MISSING', 'TOC_INVALID'].includes(error.code));
    assert.ok(!h.events.includes('promote'));
  }
  assert.equal(inspectToc(toc()).requiredAuthTableDataPresent, true);
});

test('overall deadline and native timeouts remain safe failures without promotion', async () => {
  const expired = harness();
  let ticks = 0;
  await assert.rejects(run(expired, { now: () => ticks++ === 0 ? 0 : LIMITS.durationMs }), { code: 'TIMEOUT' });
  assert.equal(expired.commands.length, 0);
  const nativeTimeout = harness({ commandErrorAt: 3, error: new BackupFailure('TIMEOUT') });
  await assert.rejects(run(nativeTimeout), { code: 'TIMEOUT' });
  assert.ok(!nativeTimeout.events.includes('promote'));
  assert.equal(safeError(new Error(SECRET)), 'BACKUP_FAILED');
});

test('CLI rejects arbitrary options and missing source credentials without touching target settings', async () => {
  const env = {};
  Object.defineProperty(env, 'RECOVERY_TARGET_DB_URL', { get() { throw new Error('must not read target'); } });
  assert.deepEqual(await main(['--restore', SECRET], env), { status: 'failed', code: 'CONFIGURATION', targetAccessed: false, restoreExecuted: false });
  assert.deepEqual(await main(['--out', `${PRIVATE_ROOT}/full-db-backup`], env), { status: 'failed', code: 'SOURCE_URL_REQUIRED', targetAccessed: false, restoreExecuted: false });
});
