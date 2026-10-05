// Probe youtube-source: menjalankan Lavalink sungguhan lalu menguji, per client,
// apakah video YouTube benar-benar bisa di-stream dari mesin ini.
//
// Kenapa file ini ada: error "All clients failed to load the item" tidak bisa
// dipastikan dari dokumentasi saja -- arti yang sama bisa datang dari klien
// yang salah, IP yang ditolak, atau video yang memang menuntut login. Ukuran di
// repo ini (lihat README bagian "Musik tidak bisa dimuat"): video kontrol tetap
// dapat URL audio dari IP yang sama, jadi blokirnya per-video, bukan per-IP.
// Semua kandidat perbaikan harus diukur, bukan diperkirakan.
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

/**
 * Baca versi plugin dan daftar klien dari config repo.
 *
 * Kenapa tidak ditulis sebagai default angka di baris ini: nilai yang ditulis
 * tangan akan basi begitu application.yml berubah, dan probe lalu melaporkan
 * keadaan yang sudah tidak ada -- pernah kejadian, `yts=1.18.1` tercetak
 * padahal disk sudah berisi 1.18.2.
 */
function repoDefaults() {
  const source = fs.readFileSync(REPO_CONFIG, 'utf8');
  const version = /dependency:\s*"dev\.lavalink\.youtube:youtube-plugin:([^"]+)"/.exec(source)?.[1];
  if (!version) {
    throw new Error('versi youtube-plugin tidak ditemukan di lavalink/application.yml');
  }

  // Daftar klien di repo memuat baris komentar di tengah (TV dijelaskan di
  // sana), jadi tidak bisa dibaca dengan satu regex daftar yang berurutan:
  // komentar dan baris kosong harus dilewati, dan blok berakhir di baris
  // pertama yang bukan keduanya.
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => /^    clients:\s*$/.test(line));
  if (start === -1) throw new Error('daftar clients: tidak ditemukan di lavalink/application.yml');

  const clients = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    const item = /^\s+-\s+([A-Z_0-9]+)\s*$/.exec(line);
    if (item) {
      clients.push(item[1]);
      continue;
    }
    break;
  }
  if (clients.length === 0) throw new Error('daftar clients: kosong di lavalink/application.yml');
  return { version, clients };
}

const REPO = repoDefaults();
const VERSION = arg('version', REPO.version);
const CLIENTS = (arg('clients', '') ? arg('clients').split(',') : REPO.clients)
  .map((c) => c.trim())
  .filter(Boolean);
if (CLIENTS.length === 0) {
  throw new Error(
    'daftar klien kosong: isi --clients dengan nama yang sah, atau hilangkan flag-nya supaya memakai daftar di lavalink/application.yml',
  );
}

// Nama yang dipakai plugin saat melaporkan klien, untuk yang berbeda dari nama
// config-nya. Hanya berisi pemetaan yang sudah terbukti lewat pengukuran.
const REPORTED_NAME = { TV: 'TVHTML5' };
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
  const lines = source.split(/\r?\n/);

  // Blok `clients:` diganti baris demi baris, bukan dengan satu regex daftar.
  // Alasannya konkret: di config repo ada baris komentar di tengah daftar (TV
  // dijelaskan di situ), dan regex yang menuntut baris berurutan berhenti di
  // komentar itu -- TV tertinggal sebagai entri kedua, sehingga plugin
  // melaporkan "TVHTML5, TVHTML5" dan yang diukur bukan lagi daftar yang
  // diminta.
  const start = lines.findIndex((line) => /^    clients:\s*$/.test(line));
  if (start === -1) throw new Error('daftar clients: tidak ditemukan di lavalink/application.yml');

  let lastItem = -1;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    if (/^\s+-\s+[A-Z_0-9]+\s*$/.test(line)) {
      lastItem = i;
      continue;
    }
    break;
  }
  if (lastItem === -1) throw new Error('daftar clients: tidak berisi satu pun nama');

  const withClients = [
    ...lines.slice(0, start),
    '    clients:',
    ...CLIENTS.map((c) => `      - ${c}`),
    ...lines.slice(lastItem + 1),
  ].join('\n');

  const replaced = withClients
    .replace(/(dependency:\s*"dev\.lavalink\.youtube:youtube-plugin:)[^"]+/, `$1${VERSION}`)
    .replace(/^([ \t]*port:\s*)\$\{SERVER_PORT:\d+\}/m, `$1${port}`)
    // `lavalink.server.port` tidak ada di config repo, jadi WebSocket Lavalink
    // selalu tertaut di 2333. Kalau ada Lavalink lain yang sedang hidup --
    // misalnya milik pengguna yang sedang menjalankan botnya -- probe akan
    // tersambung ke instance itu dan mengukur yang salah.
    .replace(/(  server:\n)(    password:)/, `$1    port: ${port}\n$2`);

  // Asersi, bukan harapan: kalau salah satu penggantian tidak kena, probe akan
  // menjalankan konfigurasi yang bukan maksud pemanggilnya.
  if (!replaced.includes(`youtube-plugin:${VERSION}`)) {
    throw new Error(`versi plugin ${VERSION} tidak berhasil ditulis ke konfigurasi sementara`);
  }
  for (const client of CLIENTS) {
    if (!replaced.includes(`      - ${client}\n`)) {
      throw new Error(`klien ${client} tidak berhasil ditulis ke konfigurasi sementara`);
    }
  }
  if ((replaced.match(new RegExp(`port: ${port}\\b`, 'g')) ?? []).length < 2) {
    throw new Error(`port ${port} tidak tertulis di kedua tempat (server dan lavalink.server)`);
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
  if (ids.length < count) throw new Error(`pencarian hanya menghasilkan ${ids.length} videoId`);
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

    // Penjaga: plugin diam-diam mengganti nama klien yang tidak dikenali
    // (MUSIC, WEB_REMIX, dan WEBEMBEDDED semuanya pernah ditelan tanpa suara).
    // Kalau itu terjadi di sini, angka di bawah bukan tentang config yang
    // diminta -- lebih baik gagal keras daripada melaporkan hasil yang
    // menyesatkan.
    const reported = initialised
      ? initialised[1]
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean)
      : [];
    const wanted = CLIENTS.map((c) => REPORTED_NAME[c] ?? c);
    const diverged =
      reported.length === 0 ||
      wanted.length !== reported.length ||
      wanted.some((c) => !reported.includes(c));
    if (diverged) {
      throw new Error(
        'plugin memakai klien yang berbeda dari yang diminta, jadi hasilnya tidak bisa dipakai:\n' +
          `    diminta: ${wanted.join(', ') || '(kosong)'}\n` +
          `    dipakai: ${reported.join(', ') || '(tidak terbaca)'}`,
      );
    }

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
