// Probe youtube-source: menjalankan Lavalink sungguhan lalu menguji, per client,
// apakah video YouTube benar-benar bisa di-stream dari mesin ini.
//
// Kenapa file ini ada: error "All clients failed to load the item" tidak bisa
// dipastikan hanya dari dokumentasi. Neither global (versi 1.18.2 pun masih
// punya issue #240 yang terbuka) maupun per-video (sebagian video bisa, sebagian
// tidak). Jadi kandidat perbaikan harus diukur, bukan diperkirakan.
//
// Yang diukur memakai endpoint milik plugin sendiri,
// `GET /youtube/stream/{videoId}?withClient=X`, yang memanggil jalur pemuatan
// format yang sama dengan pemutaran. Lavalink sendiri tidak punya endpoint
// pemuatan tanpa player di v4 ini, dan op WebSocket ditolak ("Lavalink v4 does
// not support websocket messages").
//
// Cara pakai:
//   node tools/yts-probe.mjs --version 1.18.2 --clients WEB,ANDROID_VR,IOS
//
// Keluarannya satu baris "HASIL: ..." supaya bisa dibandingkan antar-kasus.

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
const LOG = path.join(ROOT, 'lavalink', 'logs', 'probe.log');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const VERSION = arg('version', '1.18.1');
const CLIENTS = arg('clients', 'WEB,ANDROID_VR,WEBEMBEDDED')
  .split(',')
  .map((c) => c.trim())
  .filter(Boolean);
const QUERY = arg('query', 'sama saja rhoma irama');
const PASSWORD = 'youshallnotpass';

/** Cari port bebas supaya probe tidak menabrak Lavalink yang sudah berjalan. */
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

/**
 * Susun application.yml dari file repo apa adanya, hanya mengganti versi plugin
 * dan daftar client. Jadi yang diuji benar-benar konfigurasi repo ini, bukan
 * salinan longgar yang bisa menyimpang dari kenyataan.
 */
function buildConfig(port) {
  const source = fs.readFileSync(REPO_CONFIG, 'utf8');
  const clients = CLIENTS.map((c) => `      - ${c}`).join('\n');

  const replaced = source
    .replace(/(dependency:\s*"dev\.lavalink\.youtube:youtube-plugin:)[^"]+/, `$1${VERSION}`)
    .replace(/^([ \t]*port:\s*)\$\{SERVER_PORT:\d+\}/m, `$1${port}`)
    // `lavalink.server.port` tidak ada di config repo, jadi WebSocket Lavalink
    // selalu tertaut di 2333. Kalau ada Lavalink lain yang sedang hidup --
    // misalnya milik pengguna yang sedang menjalankan botnya -- probe akan
    // tersambung ke instance itu dan mengukur yang salah.
    .replace(/(  server:\n)(    password:)/, `$1    port: ${port}\n$2`)
    .replace(/(    clients:\n)(?:[ \t]*-[ \t]*[A-Z_]+\n)+/, `$1${clients}\n`);

  if (replaced === source) {
    throw new Error('tidak ada satu pun pola yang diganti -- konfigurasi repo berubah bentuk');
  }

  return replaced;
}

/**
 * Tunggu sampai soket WebSocket Lavalink menerima koneksi.
 *
 * Lavalink v4.2 mengautentikasi lewat HEADER, bukan query param seperti
 * versi 4.0/4.1: `Authorization` dibandingkan apa adanya dengan password, dan
 * `User-Id` harus angka. Query `?identifier=&password=` diabaikan tanpa pesan
 * yang membantu -- jawabannya selalu 401.
 */
function connect(port, password, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v4/websocket`, {
      headers: { Authorization: password, 'User-Id': '1000', 'Client-Name': 'yts-probe' },
    });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`timeout ${timeoutMs} ms menunggu Lavalink`));
    }, timeoutMs);

    ws.on('message', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Ambil videoId hasil pencarian, supaya yang diuji video yang benar-benar
 * gagal dimuat -- bukan video_fixture yang kebetulan selalu bisa diputar.
 */
async function searchIds(query, count) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'id-ID,id;q=0.9' },
  });
  const html = await res.text();
  const ids = [...new Set([...html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)].map((m) => m[1]))];
  if (ids.length < count) throw new Error(`penarian hanya menghasilkan ${ids.length} videoId`);
  return ids.slice(0, count);
}

/** Satu video, satu client: 200 berarti format audio benar-benar bisa diambil. */
async function tryStream(port, id, client) {
  const res = await fetch(
    `http://127.0.0.1:${port}/youtube/stream/${id}?withClient=${encodeURIComponent(client)}`,
    { headers: { Authorization: PASSWORD } },
  );
  // Body harus benar-benar dibaca: stream yang langsung di-'cancel' belum
  // berarti format-nya bisa dibaca plugin.
  const bytes = res.ok ? (await res.arrayBuffer()).byteLength : 0;
  return { ok: res.ok && bytes > 0, status: res.status, bytes };
}

async function main() {
  if (!fs.existsSync(JAR)) throw new Error(`Lavalink.jar tidak ada di ${JAR}`);

  const ids = arg('ids', '') ? arg('ids').split(',') : await searchIds(QUERY, 3);
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yts-probe-'));
  fs.writeFileSync(path.join(dir, 'application.yml'), buildConfig(port), 'utf8');

  const child = spawn('java', ['-Xmx512m', '-jar', JAR], {
    cwd: dir,
    // Env anak dipaksa eksplisit supaya tidak ada ketidakpastian soal placeholder
    // `${LAVALINK_SERVER_PASSWORD:...}` yang diinterpolasi Spring.
    env: {
      ...process.env,
      JAVA_TOOL_OPTIONS: '',
      LAVALINK_SERVER_PASSWORD: PASSWORD,
      SERVER_PORT: String(port),
    },
    windowsHide: true,
  });

  let out = '';
  child.stdout.on('data', (d) => (out += d.toString()));
  child.stderr.on('data', (d) => (out += d.toString()));

  const result = { ok: false, detail: '' };

  try {
    let ws;
    const deadline = Date.now() + 180000;
    let lastError = 'belum coba';
    while (Date.now() < deadline && !ws) {
      if (child.exitCode !== null) throw new Error(`Lavalink mati (${child.exitCode})`);
      try {
        ws = await connect(port, PASSWORD, 5000);
      } catch (err) {
        lastError = err.message;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (!ws) throw new Error(`gagal konek: ${lastError}`);

    // Wait: nama client yang benar-benar dipakai plugin, bukan yang ditulis di
    // config. Nama client yang tidak dikenali akan diam-diam diganti default.
    const initialised = /initialised with clients: ([^\r\n]*)/i.exec(out);
    if (initialised) result.detail += `dipakai=${initialised[1].trim()} | `;

    const perClient = [];
    for (const client of CLIENTS) {
      const hits = [];
      for (const id of ids) {
        hits.push(await tryStream(port, id, client));
      }
      const good = hits.filter((h) => h.ok).length;
      perClient.push(`${client}=${good}/${hits.length}`);
      if (good > 0) result.ok = true;
    }
    result.detail += perClient.join(' ');

    ws.terminate();
  } finally {
    // Log selalu ditulis: tanpa isi log, verdict "GAGAL" tidak bisa
    // ditelusuri ke penyebabnya.
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.writeFileSync(LOG, out, 'utf8');
    child.kill('SIGKILL');
    // Di Windows JVM masih memegang berkas log beberapa saat setelah dimatikan,
    // jadi kegagalan membersihkan folder tidak boleh menutupi hasil probe.
    await new Promise((r) => setTimeout(r, 500));
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
    } catch {
      /* sisa di %TEMP% tidak berbahaya */
    }
  }

  console.log(
    `HASIL: ${result.ok ? 'BISA' : 'GAGAL'} | yts=${VERSION} | request=${CLIENTS.join(',')} | ${result.detail}`,
  );
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`probe gagal: ${err.message} | log: ${LOG}`);
  process.exit(2);
});
