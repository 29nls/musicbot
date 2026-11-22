// Backup Postgres untuk stack Docker Harmony.
//
// Kenapa `pg_dump` dijalankan di dalam container: host tidak harus punya
// PostgreSQL client, dan versi `pg_dump` selalu sama dengan versi server.
// Koneksi lewat Unix socket container memakai autentikasi lokal bawaan image,
// jadi skrip ini tidak perlu membaca password database dari `.env`.
//
// Pakai:
//   npm run db:backup            dump baru + retensi
//   npm run db:backup:verify     uji restore dump terbaru
//
// `--verify` membuat database sementara bernama `<POSTGRES_DB>_restore_check`,
// memulihkan dump ke sana, membandingkan jumlah migrasi Prisma yang selesai,
// lalu menghapus database itu lagi. Database asli tidak pernah ditulis.

import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGunzip, createGzip } from 'node:zlib';

import {
  backupFileName,
  parseBackupDate,
  planRetention,
  scratchDatabaseName,
} from './db-backup-lib.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION_COUNT_SQL =
  'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL';

const HELP = [
  'Pakai: npm run db:backup [-- --verify]',
  '',
  '  (tanpa flag)  dump database ke BACKUP_DIR, lalu terapkan retensi',
  '  --verify      restore dump terbaru ke database sementara, bandingkan',
  '                jumlah migrasi, lalu hapus database sementara itu',
  '',
  'Dibaca dari .env (environment menang):',
  '  POSTGRES_CONTAINER  default harmony-postgres',
  '  POSTGRES_USER       default harmony',
  '  POSTGRES_DB         default harmony',
  '  BACKUP_DIR          default ./backups',
].join('\n');

interface Config {
  root: string;
  container: string;
  user: string;
  database: string;
  directory: string;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function readDotEnv(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^["']/, '')
      .replace(/["']$/, '');
    result[key] = value;
  }
  return result;
}

async function readEnvFile(): Promise<Record<string, string>> {
  try {
    return readDotEnv(await fs.readFile(path.join(ROOT, '.env'), 'utf8'));
  } catch {
    return {};
  }
}

function resolveConfig(dotEnv: Record<string, string>, env: NodeJS.ProcessEnv): Config {
  const container = (env.POSTGRES_CONTAINER ?? dotEnv.POSTGRES_CONTAINER ?? 'harmony-postgres').trim();
  const user = (env.POSTGRES_USER ?? dotEnv.POSTGRES_USER ?? 'harmony').trim();
  const database = (env.POSTGRES_DB ?? dotEnv.POSTGRES_DB ?? 'harmony').trim();
  const directory = (env.BACKUP_DIR ?? dotEnv.BACKUP_DIR ?? 'backups').trim() || 'backups';

  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(container)) {
    fail(`POSTGRES_CONTAINER tidak valid: ${container}`);
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(user)) {
    fail(`POSTGRES_USER tidak valid: ${user}`);
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(database)) {
    fail(`POSTGRES_DB tidak valid: ${database}`);
  }

  return {
    root: ROOT,
    container,
    user,
    database,
    directory: path.resolve(ROOT, directory),
  };
}

function runDocker(args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function psql(config: Config, database: string, sql: string): Promise<string> {
  const result = await runDocker([
    'exec',
    config.container,
    'psql',
    '-U',
    config.user,
    '-d',
    database,
    '-v',
    'ON_ERROR_STOP=1',
    '-tAc',
    sql,
  ]);
  if (result.code !== 0) {
    fail(`psql gagal (exit ${result.code}): ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

async function createBackup(config: Config): Promise<{ file: string; bytes: number }> {
  await fs.mkdir(config.directory, { recursive: true });
  const file = path.join(config.directory, backupFileName(new Date()));
  const temporary = `${file}.partial`;

  const child = spawn(
    'docker',
    [
      'exec',
      config.container,
      'pg_dump',
      '-U',
      config.user,
      '-d',
      config.database,
      '--no-owner',
      '--no-privileges',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  const exit = new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });

  try {
    await pipeline(child.stdout, createGzip({ level: 9 }), createWriteStream(temporary));
    const code = await exit;
    if (code !== 0) {
      fail(`pg_dump keluar dengan status ${code}${stderr.trim() === '' ? '' : `: ${stderr.trim()}`}`);
    }
    await fs.rename(temporary, file);
  } catch (error) {
    child.kill('SIGKILL');
    await exit.catch(() => 1);
    await fs.rm(temporary, { force: true });
    throw error;
  }

  const stat = await fs.stat(file);
  return { file, bytes: stat.size };
}

async function restoreInto(config: Config, file: string, database: string): Promise<void> {
  const child = spawn(
    'docker',
    [
      'exec',
      '-i',
      config.container,
      'psql',
      '-U',
      config.user,
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] },
  );

  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  const exit = new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });

  try {
    await pipeline(createReadStream(file), createGunzip(), child.stdin);
    const code = await exit;
    if (code !== 0) {
      fail(`restore gagal (exit ${code}): ${stderr.trim()}`);
    }
  } catch (error) {
    child.kill('SIGKILL');
    await exit.catch(() => 1);
    throw error;
  }
}

async function verifyBackup(
  config: Config,
  file: string,
): Promise<{ migrations: number; tables: number }> {
  const scratch = scratchDatabaseName(config.database);
  await psql(config, 'postgres', `DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`);
  await psql(config, 'postgres', `CREATE DATABASE "${scratch}"`);

  try {
    await restoreInto(config, file, scratch);

    const expected = await psql(config, config.database, MIGRATION_COUNT_SQL);
    const actual = await psql(config, scratch, MIGRATION_COUNT_SQL);
    if (expected !== actual) {
      fail(`jumlah migrasi tidak sama: asli ${expected}, hasil restore ${actual}`);
    }

    const tables = await psql(
      config,
      scratch,
      "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'",
    );
    return { migrations: Number(actual), tables: Number(tables) };
  } finally {
    await psql(config, 'postgres', `DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`).catch(
      (error: unknown) => {
        console.warn(`Peringatan: gagal menghapus database uji ${scratch}: ${String(error)}`);
      },
    );
  }
}

async function latestBackup(directory: string): Promise<string> {
  const names = await fs.readdir(directory).catch(() => [] as string[]);
  const candidates = names
    .map((name) => ({ name, date: parseBackupDate(name) }))
    .filter((entry): entry is { name: string; date: Date } => entry.date !== null)
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  const latest = candidates[0];
  if (latest === undefined) {
    fail(`Tidak ada backup di ${directory}. Jalankan npm run db:backup dulu.`);
  }
  return path.join(directory, latest.name);
}

async function applyRetention(directory: string): Promise<{
  kept: number;
  removed: number;
  unknown: number;
}> {
  const names = await fs.readdir(directory).catch(() => [] as string[]);
  const plan = planRetention(names);
  for (const name of plan.remove) {
    await fs.rm(path.join(directory, name), { force: true });
  }
  return { kept: plan.keep.length, removed: plan.remove.length, unknown: plan.unknown.length };
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    return;
  }

  const unknown = args.filter((arg) => arg !== '--verify');
  if (unknown.length > 0) {
    fail(`argumen tidak dikenal: ${unknown.join(' ')}. Lihat --help.`);
  }

  const config = resolveConfig(await readEnvFile(), process.env);

  if (args.includes('--verify')) {
    const file = await latestBackup(config.directory);
    const result = await verifyBackup(config, file);
    console.log(
      `Uji restore lulus: ${path.basename(file)} (${result.migrations} migrasi, ${result.tables} tabel)`,
    );
    return;
  }

  const backup = await createBackup(config);
  console.log(
    `Backup selesai: ${path.relative(config.root, backup.file)} (${formatBytes(backup.bytes)})`,
  );

  const retention = await applyRetention(config.directory);
  const skipped = retention.unknown === 0 ? '' : `, ${retention.unknown} berkas tak dikenal dibiarkan`;
  console.log(`Retensi: ${retention.kept} dump disimpan, ${retention.removed} dihapus${skipped}`);
}

main().catch((error: unknown) => {
  console.error(`Gagal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
