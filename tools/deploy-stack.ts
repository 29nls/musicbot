// Deploy bot Harmony yang reproducible.
//
// Kenapa skrip ini ada: `docker compose up -d` tidak membangun ulang image,
// jadi container bisa tetap menjalankan kode lama sementara migration dan slash
// command di host sudah dari source baru. Kejadian nyata di mesin ini: giveaway
// sudah terdaftar sebagai perintah, tetapi image bot masih 14 jam lebih tua dan
// tidak memuat modulnya.
//
// Urutan yang dilakukan:
//   1. build image `migrate` dan `bot` dari source saat ini
//   2. terapkan migrasi lewat image `migrate` yang baru (bukan dari host)
//   3. recreate container `bot` dengan image baru
//   4. tunggu GET /ready menjawab 200, lalu laporkan status health
//
// Yang tidak dilakukan: build dashboard, restart Lavalink/Redis/Postgres,
// push, atau tag. Working tree yang belum bersih ditolak secara bawaan, karena
// image dari kode yang tidak bisa dilacak ke commit tidak bisa direproduksi.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = ['compose', '-f', 'docker-compose.yml'] as const;
const READY_TIMEOUT_MS = 120_000;
const HEALTH_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 3_000;

const READY_SCRIPT = [
  "fetch('http://127.0.0.1:8080/ready',{signal:AbortSignal.timeout(3000)})",
  '.then(async(r)=>{process.stdout.write(await r.text());process.exit(r.ok?0:1)})',
  '.catch(()=>process.exit(1))',
].join('');

const HELP = [
  'Pakai: npm run deploy:stack [-- --dry-run | --allow-dirty]',
  '',
  '  (tanpa flag)  build migrate+bot, terapkan migrasi, recreate bot,',
  '                lalu tunggu GET /ready menjawab 200',
  '  --dry-run     cetak perintahnya tanpa menjalankan apa pun',
  '  --allow-dirty izinkan deploy dari working tree yang belum di-commit',
].join('\n');

interface Options {
  dryRun: boolean;
  allowDirty: boolean;
  help: boolean;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function parseArgs(argv: string[]): Options | string {
  const options: Options = { dryRun: false, allowDirty: false, help: false };
  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--allow-dirty') options.allowDirty = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else return `argumen tidak dikenal: ${arg}`;
  }
  return options;
}

function run(
  command: string,
  args: string[],
  capture = false,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: capture ? (['ignore', 'pipe', 'pipe'] as const) : 'inherit',
    });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function composeStep(
  label: string,
  args: string[],
  options: Options,
): Promise<void> {
  console.log(`\n${label}`);
  console.log(`  docker ${COMPOSE.join(' ')} ${args.join(' ')}`);
  if (options.dryRun) return;

  const result = await run('docker', [...COMPOSE, ...args]);
  if (result.code !== 0) {
    throw new Error(`${label} gagal (exit ${result.code})`);
  }
}

async function waitForReady(): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last = 'belum ada jawaban';

  while (Date.now() < deadline) {
    const result = await run(
      'docker',
      ['exec', 'harmony-bot', 'node', '-e', READY_SCRIPT],
      true,
    );
    last = result.stdout.trim() || result.stderr.trim() || `exit ${result.code}`;

    if (result.code === 0) {
      console.log(`\n/ready menjawab 200: ${last}`);
      return;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `/ready tidak menjawab 200 dalam ${READY_TIMEOUT_MS / 1000} detik. Jawaban terakhir: ${last}`,
  );
}

async function reportHealth(): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let status = 'tidak diketahui';

  while (Date.now() < deadline) {
    const result = await run(
      'docker',
      ['inspect', '-f', '{{.State.Health.Status}}', 'harmony-bot'],
      true,
    );
    status = result.stdout.trim() || status;
    if (status === 'healthy') break;
    await sleep(POLL_INTERVAL_MS);
  }

  if (status === 'healthy') {
    console.log('Health bot: healthy');
  } else {
    console.warn(
      `Peringatan: health bot masih "${status}" setelah ${HEALTH_TIMEOUT_MS / 1000} detik, ` +
        'walaupun /ready sudah menjawab 200.',
    );
  }

  const image = await run(
    'docker',
    ['inspect', '-f', '{{.Image}}', 'harmony-bot'],
    true,
  );
  console.log(`Image bot: ${image.stdout.trim()}`);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (typeof parsed === 'string') {
    console.error(parsed);
    process.exitCode = 1;
    return;
  }
  if (parsed.help) {
    console.log(HELP);
    return;
  }

  const commit = await run('git', ['rev-parse', '--short', 'HEAD'], true);
  const status = await run('git', ['status', '--porcelain'], true);
  const dirty = status.stdout.trim() !== '';
  const sha = commit.stdout.trim() || 'tidak diketahui';

  console.log(`Deploy Harmony dari commit ${sha}${dirty ? ' (working tree berubah)' : ' (bersih)'}`);

  if (dirty && !parsed.allowDirty && !parsed.dryRun) {
    throw new Error(
      'Working tree belum bersih. Commit dulu, atau jalankan dengan --allow-dirty ' +
        'kalau memang ingin men-deploy kode yang belum tercatat di Git.',
    );
  }

  await composeStep('1/3 Build image migrate + bot', ['build', 'migrate', 'bot'], parsed);
  await composeStep('2/3 Terapkan migrasi database', ['run', '--rm', 'migrate'], parsed);
  await composeStep('3/3 Recreate container bot', ['up', '-d', '--no-deps', 'bot'], parsed);

  if (parsed.dryRun) {
    console.log('\nDry run selesai; tidak ada image atau container yang disentuh.');
    return;
  }

  await waitForReady();
  await reportHealth();
}

main().catch((error: unknown) => {
  console.error(`\nDeploy gagal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
