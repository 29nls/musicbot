// Uji sekali pakai: bisakah plugin LavaSrc mencari di Spotify DAN memutar audionya
// tanpa YouTube?
//
// Kenapa perlu diukur, bukan disimpulkan dari dokumentasi: `spsearch:` jelas bisa
// mencari di Spotify, tapi Spotify tidak menyediakan audio. Yang menentukan adalah
// ke mana plugin memantulkan (mirror) track Spotify saat diputar. Bytecode-nya
// menyebut `ytsearch:`; alat ini membuktikan perilakunya sungguhan pada Lavalink
// yang benar-benar jalan.
//
// Pakai: node tools/spotify-mirror-probe.mjs
// Keluaran: satu baris "VERDIKT: ..." plus log anak proses di
// lavalink/logs/spotify-probe.log (folder logs di-gitignore).

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
const LOG = path.join(ROOT, 'lavalink', 'logs', 'spotify-probe.log');
const PASSWORD = 'youshallnotpass';
const QUERY = process.argv[2] ?? 'cherrybelle dilema';

function fail(message) {
  console.error('gagal: ' + message);
  process.exit(2);
}

function readDotEnv() {
  const values = {};
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf('=');
    if (at < 1) continue;
    values[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim().replace(/^["']|["']$/g, '');
  }
  return values;
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
  const matches = text.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'));
  if (!matches || matches.length !== 1) {
    fail(`pola "${label}" cocok ${matches ? matches.length : 0} kali, harus tepat 1`);
  }
  return text.replace(pattern, replacement);
}

function buildConfig(port, env) {
  let text = fs.readFileSync(REPO_CONFIG, 'utf8');

  text = replaceOnce(text, /^  lavasrc:$/m, '  lavasrc:\n    providers:\n      - spsearch', 'blok lavasrc');
  text = replaceOnce(text, /^      spotify: false$/m, '      spotify: true', 'lavasrc.sources.spotify');
  text = replaceOnce(
    text,
    /^      countryCode: "ID"$/m,
    `      countryCode: "ID"\n      clientId: "${env.SPOTIFY_CLIENT_ID}"\n      clientSecret: "${env.SPOTIFY_CLIENT_SECRET}"`,
    'lavasrc.spotify.countryCode',
  );
  text = replaceOnce(text, /^([ \t]*port:\s*)\$\{SERVER_PORT:\d+\}/m, `$1${port}`, 'server.port');
  text = replaceOnce(text, /(  server:\n)(    password:)/, `$1    port: ${port}\n$2`, 'lavalink.server.port');

  if (!text.includes('spsearch')) fail('provider spsearch tidak tertulis di config sementara');
  if (!text.includes('clientId:')) fail('kredensial Spotify tidak tertulis di config sementara');
  return text;
}

/** Satu percobaan konek; menolak kalau gagal, tanpa mencoba ulang. */
function tryConnect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v4/websocket`, {
      headers: { Authorization: PASSWORD, 'User-Id': '1000', 'Client-Name': 'spotify-mirror-probe' },
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

/**
 * Tunggu Lavalink hidup. JVM butuh belasan detik untuk boot; koneksi pertama
 * hampir selalu ditolak, dan itu normal — bukan kegagalan uji.
 */
async function connect(child, port) {
  const deadline = Date.now() + 120000;
  let lastError = 'belum dicoba';

  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Lavalink mati (exit ${child.exitCode})`);
    try {
      return await tryConnect(port);
    } catch (error) {
      lastError = error.message;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error(`gagal konek ke Lavalink: ${lastError}`);
}

const env = readDotEnv();
if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) fail('SPOTIFY_CLIENT_ID/SECRET kosong di .env');
if (!fs.existsSync(JAR)) fail('Lavalink.jar tidak ada');

const port = await freePort();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotify-probe-'));
fs.writeFileSync(path.join(dir, 'application.yml'), buildConfig(port, env), 'utf8');

const child = spawn('java', ['-Xmx512m', '-jar', JAR], {
  cwd: dir,
  env: { ...process.env, JAVA_TOOL_OPTIONS: '', LAVALINK_SERVER_PASSWORD: PASSWORD, SERVER_PORT: String(port) },
  windowsHide: true,
});

let out = '';
child.stdout.on('data', (d) => (out += d.toString()));
child.stderr.on('data', (d) => (out += d.toString()));

let ok = false;
let verdict = 'belum diukur';

try {
  const { ws, ready } = await connect(child, port);
  const sessionId = ready?.sessionId ?? '';
  if (!sessionId) fail('READY tanpa sessionId');

  const headers = { Authorization: PASSWORD, 'content-type': 'application/json' };
  const search = await fetch(
    `http://127.0.0.1:${port}/v4/loadtracks?identifier=${encodeURIComponent(`spsearch:${QUERY}`)}`,
    { headers },
  ).then((r) => r.json());

  const tracks = search.loadType === 'search' ? search.data : search.data?.tracks ?? [];
  const first = tracks[0];
  console.log(`PENCARIAN spsearch: loadType=${search.loadType} hasil=${tracks.length}`);
  if (first) {
    console.log(
      `  pertama: "${first.info.title}" | sumber=${first.info.sourceName} | uri=${String(first.info.uri).slice(0, 60)}`,
    );
  }

  if (!first) {
    verdict = `spsearch tidak mengembalikan hasil (${search.loadType})`;
  } else {
    // Putar di pemutar sementara: mirror Spotify terjadi saat pemutaran, bukan
    // saat pencarian, jadi tanpa langkah ini pertanyaan "audionya dari mana"
    // belum terjawab.
    const events = [];
    ws.on('message', (data) => {
      try {
        const payload = JSON.parse(data.toString());
        if (payload.op === 'event') events.push(payload);
      } catch {
        /* pesan non-JSON diabaikan */
      }
    });

    await fetch(`http://127.0.0.1:${port}/v4/sessions/${sessionId}/players/1000`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ track: { encoded: first.encoded }, position: 0 }),
    });

    await new Promise((r) => setTimeout(r, 25000));

    const types = events.map((e) => e.type);
    console.log(`PERISTIWA: ${types.join(', ') || '(tidak ada)'}`);
    for (const event of events) {
      if (event.type === 'TrackExceptionEvent') {
        console.log('  exception: ' + JSON.stringify(event.exception).slice(0, 300));
      }
      if (event.type === 'TrackStartEvent') {
        console.log('  trackStart: ' + (event.track?.info?.title ?? ''));
      }
    }

    const started = types.includes('TrackStartEvent');
    const mirrored = /ytsearch|youtube|sign in|requires login|All clients failed/i.test(out);
    ok = started;
    verdict = started
      ? 'LavaSrc BISA memutar track Spotify (lihat log: mirror lewat sumber apa)'
      : mirrored
        ? 'GAGAL: mirror Spotify berakhir di jalur YouTube yang menuntut login'
        : 'GAGAL: track Spotify tidak bisa diputar (lihat log untuk sebabnya)';
  }

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
