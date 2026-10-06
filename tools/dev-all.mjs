// Menjalankan Lavalink dan bot (`npm run dev`) dari **satu** terminal.
//
// Kenapa file ini ada. Alur host di README memakai dua terminal:
//   npm run infra:lavalink   (terminal A)
//   npm run dev              (terminal B)
// Di NAS CasaOS/ZimaOS sering hanya ada satu shell — dan begitu shell itu
// ditutup, dua proses foreground itu ikut mati. Skrip ini menutup keduanya:
//
//   npm run dev:all                 satu terminal, log dua proses berselang-seling,
//                                   Ctrl+C mematikan keduanya
//   npm run dev:all -- --detach     lepas dari terminal; sesi SSH boleh ditutup
//   npm run dev:stop                hentikan yang sedang berjalan
//
// Kenapa bukan `nohup ... &` dua kali. Dua perintah terpisah tidak saling tahu:
// (a) urutan nyala tidak diatur, jadi bot menembak Lavalink yang belum siap dan
// mencetak beberapa kali gagal sambung, dan (b) mematikan bot tidak mematikan
// JVM-nya. `tools/start-lavalink.mjs` sudah menutup masalah (b) untuk dirinya
// sendiri; di sini hal yang sama dilakukan untuk dua proses sekaligus, dengan
// anak-anaknya diletakkan di process group sendiri supaya `tsx watch` yang
// menurunkan proses lagi tetap ikut mati.
//
// Batas yang jujur: ini fitur kenyamanan pengembangan, bukan supervisor
// produksi. Tidak ada restart otomatis, dan tidak ada yang menyalakannya lagi
// setelah NAS reboot — untuk itu pakai stack Docker (lihat
// deploy/casaos/README.md).

import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), '..');
const LAVALINK_DIR = path.join(ROOT, 'lavalink');
const JAR = path.join(LAVALINK_DIR, 'Lavalink.jar');

// `logs/` sudah ada di .gitignore (lihat entri "Log"), jadi pid file dan log
// di sini tidak pernah muncul sebagai berkas tak terlacak.
const LOG_DIR = path.join(ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'dev-all.log');
const PID_FILE = path.join(LOG_DIR, 'dev-all.pid');

const IS_WINDOWS = process.platform === 'win32';
const DEFAULT_PORT = 2333;
const DEFAULT_HEAP = '512m';
const READY_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 10_000;

const HELP = [
  'Pakai: npm run dev:all [-- --detach | --stop | --no-wait]',
  '',
  '  (tanpa flag)   Lavalink lalu bot di terminal ini. Ctrl+C menghentikan keduanya.',
  '  --detach, -d   Jalankan di latar belakang; sesi SSH boleh ditutup.',
  '                 Log: logs/dev-all.log',
  '  --stop         Hentikan yang sedang berjalan (foreground maupun --detach).',
  '  --no-wait      Jangan tunggu port Lavalink siap sebelum menjalankan bot.',
  '  --help, -h     Pesan ini.',
  '',
  'Dibaca dari .env (sama seperti `npm run infra:lavalink`):',
  '  LAVALINK_PASSWORD       WAJIB.',
  '  LAVALINK_PORT           default ' + DEFAULT_PORT + ' (dipakai untuk menunggu kesiapan).',
  '  LAVALINK_HEAP           default ' + DEFAULT_HEAP + ' (bisa juga lewat environment).',
  '  YOUTUBE_OAUTH_ENABLED, YOUTUBE_REFRESH_TOKEN, YTDLP_PATH',
  '',
  'Dari environment (env menang atas .env):',
  '  JAVA_HOME               dipakai kalau `java` tidak ada di PATH.',
  '  LAVALINK_JAVA           biner java tertentu, mengalahkan JAVA_HOME.',
].join('\n');

/* ── bagian murni: dipakai juga oleh tests/devAll.test.ts ─────────────────── */

/** Argumen CLI. Mengembalikan { error } alih-alih melempar supaya bisa diuji. */
export function parseArgs(argv) {
  const options = { help: false, detach: false, stop: false, wait: true };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--detach' || arg === '-d') options.detach = true;
    else if (arg === '--stop') options.stop = true;
    else if (arg === '--no-wait') options.wait = false;
    else return { error: 'argumen tidak dikenal: ' + arg };
  }
  if (options.stop && options.detach) {
    return { error: '--stop dan --detach tidak bisa digabung' };
  }
  return options;
}

/**
 * Parser .env seadanya: hanya `KEY=VALUE` polos, tanpa ekspansi variabel.
 * Sengaja tidak memakai parser lengkap supaya perilakunya sama dengan
 * `tools/start-lavalink.mjs` — dua-duanya membaca berkas yang sama.
 */
export function readDotEnv(text) {
  const result = {};
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

function parsePort(value) {
  const port = Number.parseInt(value ?? '', 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_PORT;
}

/**
 * Nilai yang dibutuhkan Lavalink. Environment proses menang atas `.env`, sama
 * seperti `tools/start-lavalink.mjs` — jadi `LAVALINK_HEAP=256m npm run dev:all`
 * tetap bekerja tanpa menyentuh berkas.
 */
export function resolveLavalinkEnv(dotEnv = {}, env = process.env) {
  return {
    password: env.LAVALINK_PASSWORD ?? dotEnv.LAVALINK_PASSWORD,
    heap: env.LAVALINK_HEAP ?? dotEnv.LAVALINK_HEAP ?? DEFAULT_HEAP,
    oauthEnabled: env.YOUTUBE_OAUTH_ENABLED ?? dotEnv.YOUTUBE_OAUTH_ENABLED ?? 'false',
    refreshToken: env.YOUTUBE_REFRESH_TOKEN ?? dotEnv.YOUTUBE_REFRESH_TOKEN ?? '',
    // `|| 'yt-dlp'` bukan hiasan: `.env.example` menulis `YTDLP_PATH=` kosong,
    // dan string kosong BUKAN nilai hilang bagi Spring — placeholder akan
    // resolve ke '' dan LavaSrc mencari biner tanpa nama.
    ytdlpPath: (env.YTDLP_PATH ?? dotEnv.YTDLP_PATH ?? 'yt-dlp').trim() || 'yt-dlp',
    port: parsePort(env.LAVALINK_PORT ?? dotEnv.LAVALINK_PORT),
  };
}

/** Argumen JVM. Bentuknya sama dengan yang dipakai `npm run infra:lavalink`. */
export function lavalinkArgs(resolved) {
  return ['-Xms64m', '-Xmx' + resolved.heap, '-jar', JAR];
}

/**
 * Perintah Java. `$JAVA_HOME/bin/java` dicoba sebelum `java` dari PATH karena
 * itu satu-satunya cara jalur "JRE diunduh ke $HOME" (lihat
 * deploy/casaos/README.md) bekerja tanpa mengedit `~/.profile`.
 */
export function javaCommand(env = process.env, windows = IS_WINDOWS) {
  const explicit = env.LAVALINK_JAVA?.trim();
  if (explicit) return explicit;
  const home = env.JAVA_HOME?.trim();
  if (home) return path.join(home, 'bin', windows ? 'java.exe' : 'java');
  return 'java';
}

/**
 * Perintah untuk bot. `npm_execpath` — di-set npm saat dijalankan lewat
 * `npm run` — menunjuk ke berkas JS-nya, jadi bisa dipanggil dengan `node`
 * tanpa shell perantara. Itu penting di Windows: `spawn('npm')` gagal dengan
 * ENOENT karena npm di sana berupa `npm.cmd`, dan `.cmd` hanya bisa dijalankan
 * lewat shell (terukur, sebelum perbaikan ini). Cadangannya `npm.cmd` lewat
 * shell; argumennya digabung ke dalam perintah karena Node memperingatkan
 * (DEP0190) kalau `shell: true` dipakai bersama daftar argumen terpisah.
 */
export function botCommand(env = process.env, execPath = process.execPath, windows = IS_WINDOWS) {
  const execpath = env.npm_execpath?.trim();
  if (execpath && /\.[mc]?js$/i.test(execpath)) {
    return { command: execPath, args: [execpath, 'run', 'dev'], shell: false };
  }
  return windows
    ? { command: 'npm.cmd run dev', args: [], shell: true }
    : { command: 'npm', args: ['run', 'dev'], shell: false };
}

/**
 * Environment untuk JVM. Empat nilai ini harus diteruskan eksplisit: placeholder
 * di `lavalink/application.yml` dibaca Spring dari environment proses, sedangkan
 * `.env` hanya dibaca skrip ini.
 */
export function lavalinkChildEnv(base, resolved) {
  return {
    ...base,
    LAVALINK_SERVER_PASSWORD: resolved.password,
    YOUTUBE_OAUTH_ENABLED: resolved.oauthEnabled,
    YOUTUBE_REFRESH_TOKEN: resolved.refreshToken,
    YTDLP_PATH: resolved.ytdlpPath,
  };
}

/** Isi pid file. Bentuknya sengaja datar supaya mudah dibaca manusia juga. */
export function pidFileText(state) {
  return JSON.stringify(state, null, 2) + '\n';
}

/** Baca balik pid file. Mengembalikan null kalau rusak, bukan melempar. */
export function parsePidFile(text) {
  try {
    const value = JSON.parse(text);
    if (typeof value?.pid !== 'number' || !Number.isInteger(value.pid)) return null;
    const children = Array.isArray(value.children)
      ? value.children.filter((pid) => Number.isInteger(pid))
      : [];
    return { ...value, children };
  } catch {
    return null;
  }
}

/* ── bagian efek samping ──────────────────────────────────────────────────── */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function fail(message) {
  console.error('\nGagal: ' + message + '\n');
  process.exit(1);
}

/** true kalau proses masih ada. EPERM berarti ada, tapi bukan milik kita. */
function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/**
 * Matikan anak beserta turunannya. Ini bagian yang paling mudah salah: `npm run
 * dev` menurunkan `node` (tsx) yang menurunkan proses bot lagi, jadi mematikan
 * proses `npm` saja meninggalkan JVM/Node yang masih memegang port.
 *
 * Di Linux/macOS anak diletakkan `detached: true` sehingga jadi pemimpin
 * process group-nya sendiri, lalu sinyal dikirim ke `-pid` (seluruh group). Di
 * Windows tidak ada process group POSIX, jadi `taskkill /T` yang dipakai.
 */
function signalChild(child, signal) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (IS_WINDOWS) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Sudah mati di antara dua panggilan: tidak ada yang perlu dilakukan.
    }
  }
}

function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function terminate(child, label) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  signalChild(child, 'SIGTERM');
  if (await waitForExit(child, STOP_TIMEOUT_MS)) return;
  console.warn(`${label} tidak berhenti dalam ${STOP_TIMEOUT_MS} ms — SIGKILL.`);
  signalChild(child, 'SIGKILL');
  await waitForExit(child, 2000);
}

/**
 * Satu baris log anak, diberi label. `useColor` hanya ketika stdout memang
 * terminal: di mode --detach keluarannya berkas log, dan kode ANSI di sana cuma
 * mengotori `grep`.
 */
function makePrefixer(useColor) {
  const width = '[lavalink]'.length;
  const colors = { lavalink: '\u001B[36m', bot: '\u001B[35m' };
  return (label, line) => {
    const tag = ('[' + label + ']').padEnd(width);
    return (useColor ? colors[label] + tag + '\u001B[39m' : tag) + ' ' + line + '\n';
  };
}

function pipeLines(stream, label, prefix) {
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  reader.on('line', (line) => process.stdout.write(prefix(label, line)));
}

function portOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/** Menunggu Lavalink menerima koneksi, tapi berhenti lebih awal kalau ia mati. */
async function waitForLavalink(port, isAlive) {
  const startedAt = Date.now();
  let lastReport = 0;
  while (Date.now() - startedAt < READY_TIMEOUT_MS) {
    if (!isAlive()) return 'dead';
    if (await portOpen(port)) return Math.round((Date.now() - startedAt) / 100) / 10;
    const elapsed = Date.now() - startedAt;
    if (elapsed - lastReport >= 5000) {
      lastReport = elapsed;
      console.log(`  menunggu 127.0.0.1:${port} … (${Math.round(elapsed / 1000)}s)`);
    }
    await sleep(500);
  }
  return 'timeout';
}

async function readPidFile() {
  try {
    return parsePidFile(await fs.readFile(PID_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function removePidFile() {
  try {
    await fs.unlink(PID_FILE);
  } catch {
    // Sudah tidak ada: tidak ada yang perlu dilakukan.
  }
}

async function tailLog(lines) {
  try {
    const text = await fs.readFile(LOG_FILE, 'utf8');
    const all = text.split('\n').filter((line) => line !== '');
    return all.slice(-lines);
  } catch {
    return [];
  }
}

/* ── mode ─────────────────────────────────────────────────────────────────── */

async function start(options) {
  const stale = await readPidFile();
  if (stale && isRunning(stale.pid)) {
    console.error(`\nGagal: sepertinya sudah berjalan (pid ${stale.pid}, sejak ${stale.startedAt}).`);
    console.error('  Hentikan dulu:  npm run dev:stop');
    console.error('  Lihat log    :  tail -f logs/dev-all.log\n');
    process.exit(1);
  }
  if (stale) await removePidFile(); // pid basi setelah reboot/kill -9

  if (!(await exists(JAR))) {
    fail(
      'lavalink/Lavalink.jar belum ada. Unduh sekali dengan:\n' +
        '    npm run infra:lavalink -- --download\n' +
        '  (unduhan selesai, lalu Ctrl+C — perintah itu memang menjalankan Lavalink)\n' +
        '  setelah itu baru: npm run dev:all',
    );
  }

  const dotEnv = await exists(path.join(ROOT, '.env'))
    ? readDotEnv(await fs.readFile(path.join(ROOT, '.env'), 'utf8'))
    : {};
  const resolved = resolveLavalinkEnv(dotEnv);
  if (!resolved.password) {
    fail(
      'LAVALINK_PASSWORD belum diisi di .env.\n' +
        '  Password yang sama dipakai bot untuk menyambung ke Lavalink.',
    );
  }

  // Dua Lavalink sekaligus adalah kekacauan klasik: yang satu memegang port,
  // yang lain gagal start dengan pesan yang tidak menyebut penyebabnya.
  if (await portOpen(resolved.port)) {
    fail(
      `port ${resolved.port} sudah menerima koneksi sebelum Lavalink di sini dijalankan.\n` +
        '  Ada Lavalink lain yang masih hidup — misalnya container app CasaOS.\n' +
        '  Hentikan dulu: docker compose down   (di folder app CasaOS)',
    );
  }

  // `LAVALINK_PORT` hanya dipakai bot untuk menyambung. Yang menentukan di mana
  // Lavalink benar-benar mendengarkan adalah `lavalink.server.port` di
  // application.yml, dan kunci itu **tidak di-set** di repo ini — jadi WebSocket
  // Lavalink selalu 2333. Menyetel LAVALINK_PORT ke nilai lain membuat bot
  // menembak port kosong, dan gejalanya "Lavalink belum terhubung" tanpa sebab
  // yang jelas. Lebih baik dikatakan di depan daripada ditebak 60 detik.
  if (resolved.port !== DEFAULT_PORT) {
    console.warn(
      `Catatan: LAVALINK_PORT=${resolved.port}, sedangkan lavalink/application.yml tidak ` +
        `menetapkan \`lavalink.server.port\` — WebSocket Lavalink tetap di ${DEFAULT_PORT}.`,
    );
    console.warn(
      `  Tambahkan \`lavalink.server.port: ${resolved.port}\` ke application.yml, atau kembali ke ` +
        `${DEFAULT_PORT}.`,
    );
  }

  await fs.mkdir(LOG_DIR, { recursive: true });
  const prefix = makePrefixer(Boolean(process.stdout.isTTY));
  const java = javaCommand();

  console.log(`Lavalink (heap -Xmx${resolved.heap}) → 127.0.0.1:${resolved.port}`);
  // Tanpa `shell`: shell Windows menyambung perintah dan argumen jadi satu baris,
  // dan jalur `LAVALINK_JAVA` yang memakai pemisah `/` langsung gagal
  // ("'logs' is not recognized..."). Jalur JRE juga tidak butuh shell.
  const lavalink = spawn(java, lavalinkArgs(resolved), {
    cwd: LAVALINK_DIR,
    env: lavalinkChildEnv(process.env, resolved),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  lavalink.on('error', (error) => {
    if (error.code === 'ENOENT') {
      fail(
        'Java tidak ditemukan. Lavalink butuh Java 17 atau lebih baru.\n' +
          '  Set JAVA_HOME ke direktori JRE, atau LAVALINK_JAVA ke biner java-nya.',
      );
    }
    fail('tidak bisa menjalankan Java: ' + error.message);
  });
  pipeLines(lavalink.stdout, 'lavalink', prefix);
  pipeLines(lavalink.stderr, 'lavalink', prefix);

  // Pid file ditulis dua kali: begitu Lavalink hidup (supaya `npm run dev:stop`
  // sudah bekerja selagi menunggu port), lalu ditimpa setelah bot ikut jalan.
  const writePidFile = (children) =>
    fs.writeFile(
      PID_FILE,
      pidFileText({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        detached: process.env.DEV_ALL_DETACHED === '1',
        port: resolved.port,
        heap: resolved.heap,
        children,
        logFile: LOG_FILE,
      }),
    );
  await writePidFile([lavalink.pid]);

  let stopping = false;
  let bot;

  const shutdown = async (reason, code) => {
    if (stopping) return;
    stopping = true;
    process.stdout.write(`\n${reason} — menghentikan bot dan Lavalink…\n`);
    await terminate(bot, 'bot');
    await terminate(lavalink, 'lavalink');
    await removePidFile();
    process.exit(code);
  };

  const onChildExit = (label) => (code, signal) => {
    if (stopping) return;
    void shutdown(`${label} berhenti (${signal ?? 'exit ' + code})`, code ?? 1);
  };
  lavalink.on('exit', onChildExit('Lavalink'));

  // Peran flag ini: bot boleh dicoba lebih dulu (shoukaku menyambung ulang
  // sendiri), tapi menunggu sesaat membuat log pertama tidak penuh kegagalan
  // sambung yang menyesatkan.
  if (options.wait) {
    const ready = await waitForLavalink(resolved.port, () => lavalink.exitCode === null && !stopping);
    if (ready === 'dead') return; // handler exit di atas yang mengakhiri proses
    if (ready === 'timeout') {
      console.warn(
        `Lavalink belum menerima koneksi setelah ${READY_TIMEOUT_MS / 1000}s — bot tetap dijalankan,`,
      );
      console.warn('ia akan mencoba menyambung ulang sendiri. Periksa log [lavalink] di atas.');
    } else {
      console.log(`Lavalink siap setelah ${ready}s.`);
    }
  }

  console.log('Bot (npm run dev)…');
  const npm = botCommand();
  bot = spawn(npm.command, npm.args, {
    cwd: ROOT,
    env: process.env,
    detached: true,
    shell: npm.shell,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bot.on('error', (error) => fail('tidak bisa menjalankan npm: ' + error.message));
  pipeLines(bot.stdout, 'bot', prefix);
  pipeLines(bot.stderr, 'bot', prefix);
  bot.on('exit', onChildExit('Bot'));

  await writePidFile([lavalink.pid, bot.pid]);

  console.log('');
  console.log(`Ctrl+C menghentikan keduanya. Pid file: ${path.relative(ROOT, PID_FILE)}`);
  console.log('');

  process.on('SIGINT', () => void shutdown('Ctrl+C', 0));
  process.on('SIGTERM', () => void shutdown('SIGTERM', 0));
  process.on('SIGHUP', () => void shutdown('SIGHUP (terminal ditutup)', 0));
}

async function runDetached(options) {
  await fs.mkdir(LOG_DIR, { recursive: true });
  const handle = await fs.open(LOG_FILE, 'a');
  const args = [SELF, ...(options.wait ? [] : ['--no-wait'])];
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', handle.fd, handle.fd],
    env: { ...process.env, DEV_ALL_DETACHED: '1' },
  });
  child.unref();
  await handle.close();

  // Memberi waktu untuk gagal cepat (mis. jar belum ada) sebelum kita bilang
  // "berjalan" — lebih baik melaporkan sebabnya daripada menyuruh user menebak
  // dari log kosong.
  await sleep(1500);
  if (!isRunning(child.pid)) {
    console.error('\nGagal: proses berhenti saat start. Isi log terakhir:\n');
    for (const line of await tailLog(20)) console.error('  ' + line);
    console.error('');
    process.exit(1);
  }

  // Pid file ditulis oleh proses yang dilepas itu sendiri — bukan di sini —
  // supaya isinya lengkap (termasuk daftar pid anak) dan tidak saling menimpa.
  console.log(`Jalan di latar belakang (pid ${child.pid}). Sesi SSH ini boleh ditutup.`);
  console.log('');
  console.log('  Ikuti log :  tail -f ' + path.relative(ROOT, LOG_FILE));
  console.log('  Hentikan  :  npm run dev:stop');
  console.log('');
  console.log('Catatan: NAS reboot tidak menyalakannya kembali.');
}

async function stopRunning() {
  const state = await readPidFile();
  if (!state) {
    console.log('Tidak ada ' + path.relative(ROOT, PID_FILE) + ' — tidak ada yang dihentikan.');
    return;
  }
  if (!isRunning(state.pid)) {
    console.log(`Pid ${state.pid} sudah tidak hidup — membuang pid file basi.`);
    await removePidFile();
    return;
  }

  console.log(`Menghentikan pid ${state.pid}…`);
  try {
    process.kill(state.pid, 'SIGTERM');
  } catch {
    // Balapan dengan proses yang baru saja mati: pemeriksaan di bawah yang benar.
  }

  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline && isRunning(state.pid)) await sleep(200);

  if (isRunning(state.pid)) {
    console.warn(`Tidak berhenti dalam ${STOP_TIMEOUT_MS} ms — SIGKILL.`);
    try {
      process.kill(state.pid, 'SIGKILL');
    } catch {
      // Sudah mati.
    }
    // Supervisor yang di-SIGKILL tidak sempat membersihkan anaknya, jadi anak
    // yang tercatat di pid file disapu dari sini.
    for (const pid of state.children ?? []) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Sudah mati.
      }
    }
    await sleep(200);
  }

  await removePidFile();
  console.log('Selesai.');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.error) fail(options.error + '\n\n' + HELP);
  if (options.help) {
    console.log(HELP);
    return;
  }
  if (options.stop) {
    await stopRunning();
    return;
  }
  if (options.detach) {
    await runDetached(options);
    return;
  }
  await start(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  await main();
}
