// Uji jalur audio `ytdlp`: apakah sumber ytdlp milik LavaSrc benar-benar bisa
// memutar lagu YouTube yang gagal di youtube-plugin, tanpa mengubah kode bot?
//
// Kenapa diukur begini: sumber ytdlp mendaftarkan `ytsearch:` sendiri, jadi
// pertanyaannya ada dua — (1) apakah ia yang melayani `ytsearch:` di rantai
// pencarian Lavalink, (2) apakah track hasilnya benar-benar mengalir. Playback
// diukur lewat pemutar sementara (PATCH player), dan SoundCloud dipakai sebagai
// kontrol untuk membuktikan cara ukur ini memang bisa melihat trackStart.
//
// Pakai: node tools/ytdlp-probe.mjs [path-yt-dlp]
//   Jalur biner dibaca berurutan dari: argumen, YTDLP_PATH (environment), .env,
//   lalu `yt-dlp` dari PATH. Config yang diukur diambil dari
//   lavalink/application.yml apa adanya — hanya port dan jalur ytdlp yang
//   di-override — jadi probe berhenti kalau sumber ytdlp di config repo
//   ternyata dimatikan, alih-alih mengukur config yang berbeda dari bot.
// Keluaran diakhiri satu baris "VERDIKT: ..." dan log anak di
// lavalink/logs/ytdlp-probe.log.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_CONFIG = path.join(ROOT, 'lavalink', 'application.yml');
const JAR = path.join(ROOT, 'lavalink', 'Lavalink.jar');
const LOG = path.join(ROOT, 'lavalink', 'logs', 'ytdlp-probe.log');
const PASSWORD = 'youshallnotpass';
const YOUTUBE_QUERY = 'cherrybelle dilema';
const CONTROL_QUERY = 'cherrybelle dilema';

function fail(message) {
  console.error('gagal: ' + message);
  process.exit(2);
}

/** Baca satu nilai dari .env, seadanya — pendekatan yang sama dengan tools/start-lavalink.mjs. */
function dotEnvValue(key) {
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator < 1) continue;
      if (trimmed.slice(0, separator).trim() !== key) continue;
      return trimmed.slice(separator + 1).trim().replace(/^["']/, '').replace(/["']$/, '');
    }
  } catch {
    /* .env memang tidak wajib ada */
  }
  return undefined;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function replaceOnce(text, pattern, replacement, label) {
  const count = [...text.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))].length;
  if (count !== 1) fail(`pola "${label}" cocok ${count} kali, harus tepat 1`);
  return text.replace(pattern, replacement);
}

function buildConfig(port, ytdlpPath) {
  let text = fs.readFileSync(REPO_CONFIG, 'utf8');

  // Sumber ytdlp sudah menyala di config repo sejak jalur ini dijadikan baku,
  // jadi probe tidak lagi menyalakannya sendiri: yang diukur harus config yang
  // sama dengan yang dipakai bot. Kalau suatu saat dimatikan, pengukuran di
  // sini tidak lagi mewakili apa pun — lebih baik berhenti dengan jelas.
  if (!/^      ytdlp: true$/m.test(text)) {
    fail('sources.ytdlp di lavalink/application.yml tidak menyala; probe ini hanya mengukur jalur ytdlp');
  }
  text = replaceOnce(
    text,
    /^      path: ".*"$/m,
    `      path: "${ytdlpPath.replace(/\\/g, '/')}"`,
    'plugins.lavasrc.ytdlp.path',
  );
  text = replaceOnce(text, /^([ \t]*port:\s*)\$\{SERVER_PORT:\d+\}/m, `$1${port}`, 'server.port');
  text = replaceOnce(text, /(  server:\n)(    password:)/, `$1    port: ${port}\n$2`, 'lavalink.server.port');

  if (!text.includes('ytdlp: true')) fail('sumber ytdlp tidak menyala di config sementara');
  if (!text.includes('path:')) fail('path yt-dlp tidak tertulis');
  return text;
}

function tryConnect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v4/websocket`, {
      headers: { Authorization: PASSWORD, 'User-Id': '1000', 'Client-Name': 'ytdlp-probe' },
    });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('timeout menunggu READY'));
    }, 10000);
    ws.on('message', (data) => {
      clearTimeout(timer);
      resolve({ ws, ready: JSON.parse(data.toString()) });
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function connect(child, port) {
  const deadline = Date.now() + 150000;
  let last = 'belum dicoba';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Lavalink mati (exit ${child.exitCode})`);
    try {
      return await tryConnect(port);
    } catch (error) {
      last = error.message;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error(`gagal konek: ${last}`);
}

const ytdlpPath = (process.argv[2] ?? process.env.YTDLP_PATH ?? dotEnvValue('YTDLP_PATH') ?? 'yt-dlp').trim() || 'yt-dlp';
// Nama polos (tanpa pemisah jalur) sengaja tidak dicek ke filesystem: Java
// mencarinya lewat PATH proses. Yang dicek hanya jalur eksplisit, supaya salah
// ketik jalur gagal di sini dengan pesan yang jelas, bukan di log LavaSrc.
if (/[\\/]/.test(ytdlpPath) && !fs.existsSync(ytdlpPath)) {
  fail(`yt-dlp tidak ada di ${ytdlpPath} (berikan jalur lengkap sebagai argumen, atau isi YTDLP_PATH di .env)`);
}
if (!fs.existsSync(JAR)) fail('Lavalink.jar tidak ada');
console.log(`yt-dlp      : ${ytdlpPath}`);

const port = await freePort();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-probe-'));
fs.writeFileSync(path.join(dir, 'application.yml'), buildConfig(port, ytdlpPath), 'utf8');

const child = spawn('java', ['-Xmx512m', '-jar', JAR], {
  cwd: dir,
  env: { ...process.env, JAVA_TOOL_OPTIONS: '', LAVALINK_SERVER_PASSWORD: PASSWORD, SERVER_PORT: String(port) },
  windowsHide: true,
});

let out = '';
child.stdout.on('data', (d) => (out += d.toString()));
child.stderr.on('data', (d) => (out += d.toString()));

/** Muat identifier, lalu coba putar track pertama; kembalikan peristiwanya. */
async function loadAndPlay(ws, headers, sessionId, identifier) {
  const loaded = await fetch(
    `http://127.0.0.1:${port}/v4/loadtracks?identifier=${encodeURIComponent(identifier)}`,
    { headers },
  ).then((r) => r.json());

  const tracks = loaded.loadType === 'search' ? loaded.data : loaded.data?.tracks ?? [];
  const first = tracks[0];
  console.log(
    `MUAT ${identifier}: loadType=${loaded.loadType} hasil=${tracks.length}` +
      (first ? ` | pertama="${first.info.title}" sumber=${first.info.sourceName} uri=${String(first.info.uri).slice(0, 70)}` : ''),
  );
  if (!first) return { loaded, events: [] };

  const events = [];
  const onMessage = (data) => {
    try {
      const payload = JSON.parse(data.toString());
      if (payload.op === 'event') events.push(payload);
    } catch {
      /* abaikan pesan non-JSON */
    }
  };
  ws.on('message', onMessage);

  await fetch(`http://127.0.0.1:${port}/v4/sessions/${sessionId}/players/1000`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ track: { encoded: first.encoded }, position: 0 }),
  });
  await new Promise((r) => setTimeout(r, 25000));
  ws.off('message', onMessage);

  const types = events.map((e) => e.type).join(', ') || '(tidak ada)';
  console.log(`  peristiwa: ${types}`);
  for (const event of events) {
    if (event.type === 'TrackExceptionEvent') {
      console.log(`  exception: ${JSON.stringify(event.exception).slice(0, 260)}`);
    }
  }
  return { loaded, events };
}

let verdict = 'belum diukur';
let ok = false;

try {
  const { ws, ready } = await connect(child, port);
  const sessionId = ready?.sessionId ?? '';
  if (!sessionId) fail('READY tanpa sessionId');
  const headers = { Authorization: PASSWORD, 'content-type': 'application/json' };

  const control = await loadAndPlay(ws, headers, sessionId, `scsearch:${CONTROL_QUERY}`);
  const controlStarted = control.events.some((e) => e.type === 'TrackStartEvent');

  const test = await loadAndPlay(ws, headers, sessionId, `ytsearch:${YOUTUBE_QUERY}`);
  const testStarted = test.events.some((e) => e.type === 'TrackStartEvent');

  const ytdlpUsed = /yt-dlp|ytdlp/i.test(out);
  console.log(`JEJAK yt-dlp di log: ${ytdlpUsed ? 'ada' : '(tidak terlihat)'}`);

  ok = testStarted;
  verdict = !controlStarted
    ? 'cara ukur ini tidak bisa melihat trackStart — tidak bisa menyimpulkan apa pun (kontrol SoundCloud pun tidak mulai)'
    : testStarted
      ? 'ytsearch sekarang benar-benar mengalir — kemungkinan besar dilayani sumber ytdlp'
      : 'ytsearch masih gagal diputar walau sumber ytdlp menyala';

  ws.terminate();
} finally {
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.writeFileSync(LOG, out, 'utf8');
  child.kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 500));
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
  } catch {
    /* sisa di %TEMP% tidak berbahaya */
  }
}

console.log(`VERDIKT: ${verdict} | log: ${LOG}`);
process.exit(ok ? 0 : 1);
