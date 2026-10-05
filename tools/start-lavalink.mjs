// Menjalankan Lavalink v4 langsung dari folder `lavalink/`, tanpa Docker.
//
// Kenapa file ini ada: docker-compose.yml menjalankan mesin audio sebagai
// container, dan container itu mahal untuk laptop kecil (Virtualization + image
// + networking). Lavalink sebenarnya cuma butuh JVM, jadi skrip ini menjalankan
// proses yang sama persis dari host dengan heap yang bisa diturunkan.
//
// Yang ditangani di sini, supaya tidak ada langkah manual yang mudah salah:
//   - `Lavalink.jar` diambil dari GitHub Releases kalau belum ada (--download).
//   - Password Lavalink dibaca dari LAVALINK_PASSWORD di .env, jadi tidak perlu
//     menyalin rahasia ke baris perintah atau menuliskannya ke log.
//   - Setelan OAuth YouTube (YOUTUBE_OAUTH_ENABLED/YOUTUBE_REFRESH_TOKEN) ikut
//     diteruskan dari .env ke JVM. `.env` tidak masuk environment dengan
//     sendirinya, jadi tanpa langkah ini flag di .env tidak berpengaruh di jalur
//     ini — beda dari Docker, yang meneruskannya lewat docker-compose.
//   - Plugin (youtube-source, LavaSrc) tetap diunduh sendiri oleh Lavalink ke
//     folder `lavalink/plugins/`, persis seperti di dalam container.
//
// Pakai: `npm run infra:lavalink` (tambah `-- --download` saat jar belum ada).

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'lavalink');
const JAR = path.join(DIR, 'Lavalink.jar');

// Seri 4.x, sama dengan image `ghcr.io/lavalink-devs/lavalink:4-alpine` di
// docker-compose.yml. application.yml di folder ini ditulis untuk v4; naik ke
// v5 mengubah bentuk konfigurasinya, jadi jangan diganti diam-diam.
const VERSION = '4.2.2';
const DOWNLOAD_URL = `https://github.com/lavalink-devs/lavalink/releases/download/${VERSION}/Lavalink.jar`;

// 512m sudah cukup untuk satu guild. Turunkan lagi (256m) kalau hanya ingin
// menguji perintah non-musik, atau naikkan ke 1G saat memutar lagu panjang di
// banyak guild.
const DEFAULT_HEAP = '512m';

const HELP = [
  'Pakai: npm run infra:lavalink [-- --download]',
  '',
  '  --download   unduh Lavalink.jar dulu kalau belum ada di lavalink/',
  '',
  'Opsi lain (dibaca dari .env atau environment):',
  '  LAVALINK_PASSWORD  WAJIB. Harus sama dengan nilai di .env milik bot.',
  '  LAVALINK_HEAP     heap JVM untuk Lavalink (default ' + DEFAULT_HEAP + ').',
  '  YOUTUBE_OAUTH_ENABLED  true untuk menyalakan login YouTube. Dibaca dari .env',
  '                     juga, karena placeholder di application.yml dibaca JVM dari',
  '                     environment, bukan dari berkas .env.',
  '  YOUTUBE_REFRESH_TOKEN  token hasil alur OAuth; isi setelah sekali jalan supaya',
  '                     alurnya tidak diulang tiap start.',
].join('\n');

function fail(message) {
  console.error('\nGagal: ' + message + '\n');
  process.exit(1);
}

/**
 * Baca file .env secukupnya untuk dua variabel yang dibutuhkan di sini.
 * Tidak memakai parser lengkap: yang dipakai hanya `KEY=VALUE` polos.
 */
async function readDotEnv() {
  let text;
  try {
    text = await fs.readFile(path.join(ROOT, '.env'), 'utf8');
  } catch {
    return {};
  }

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

async function fileSize(filePath) {
  try {
    return (await fs.stat(filePath)).size;
  } catch {
    return 0;
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function downloadJar() {
  console.log('Mengunduh ' + DOWNLOAD_URL);
  const response = await fetch(DOWNLOAD_URL, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    fail('unduhan gagal (HTTP ' + response.status + '). Coba manual dari ' + DOWNLOAD_URL);
  }

  // Unduh ke file sementara dulu supaya file setengah jadi tidak pernah dipakai
  // Lavalink pada start berikutnya.
  const temporary = JAR + '.unduhan';
  await pipeline(response.body, createWriteStream(temporary));
  await fs.rename(temporary, JAR);

  const megabytes = ((await fileSize(JAR)) / 1048576).toFixed(1);
  console.log('Selesai: lavalink/Lavalink.jar (' + megabytes + ' MB)');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    return;
  }

  if (!(await exists(JAR))) {
    if (!args.includes('--download')) {
      fail(
        'lavalink/Lavalink.jar belum ada. Jalankan sekali:\n' +
          '    npm run infra:lavalink -- --download\n' +
          'atau unduh manual dari ' + DOWNLOAD_URL,
      );
    }
    await downloadJar();
  }

  if (!(await exists(path.join(DIR, 'application.yml')))) {
    fail('lavalink/application.yml hilang. Ambil dari git: git checkout -- lavalink/application.yml');
  }

  const dotEnv = await readDotEnv();
  const password = process.env.LAVALINK_PASSWORD ?? dotEnv.LAVALINK_PASSWORD;
  if (!password) {
    fail(
      'LAVALINK_PASSWORD belum diisi. Salin .env.example menjadi .env lalu isi nilainya,\n' +
        'karena password yang sama dipakai bot untuk menyambung ke Lavalink.',
    );
  }

  const heap = process.env.LAVALINK_HEAP ?? dotEnv.LAVALINK_HEAP ?? DEFAULT_HEAP;

  // Dua variabel ini harus diteruskan ke JVM secara eksplisit. Placeholder
  // `${YOUTUBE_OAUTH_ENABLED:false}` di application.yml dibaca Spring dari
  // environment proses, sedangkan `.env` hanya dibaca skrip ini (Docker aman
  // karena compose meneruskan nilai .env-nya sendiri). Tanpa baris di bawah,
  // mengisi .env tampak berhasil tapi tidak berpengaruh apa pun di jalur ini.
  // Nilai dari environment proses tetap menang, sama seperti LAVALINK_PASSWORD.
  const oauthEnabled = process.env.YOUTUBE_OAUTH_ENABLED ?? dotEnv.YOUTUBE_OAUTH_ENABLED ?? 'false';
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN ?? dotEnv.YOUTUBE_REFRESH_TOKEN ?? '';

  console.log('Lavalink ' + VERSION + ' | heap -Xmx' + heap + ' | konfigurasi lavalink/application.yml');
  console.log(
    'OAuth YouTube: ' +
      (oauthEnabled === 'true'
        ? refreshToken
          ? 'menyala, refresh token tersedia'
          : 'menyala, refresh token belum ada — kode device akan tercetak sebentar lagi'
        : 'mati'),
  );
  console.log('Tutup dengan Ctrl+C. Prefix http://localhost:2333 harus ada di .env milik bot.');
  console.log('');

  const child = spawn('java', ['-Xms64m', '-Xmx' + heap, '-jar', JAR], {
    cwd: DIR,
    env: {
      ...process.env,
      LAVALINK_SERVER_PASSWORD: password,
      YOUTUBE_OAUTH_ENABLED: oauthEnabled,
      YOUTUBE_REFRESH_TOKEN: refreshToken,
    },
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    if (error.code === 'ENOENT') {
      fail(
        'Java tidak ditemukan di PATH. Lavalink butuh Java 17 atau lebih baru\n' +
          '(diuji juga di Java 21). Pasang Temurin lalu jalankan ulang:\n' +
          '    winget install EclipseAdoptium.Temurin.21.JRE',
      );
    }
    fail('tidak bisa menjalankan Java: ' + error.message);
  });

  // Ctrl+C harus mematikan JVM-nya juga, kalau tidak prosesnya tetap tertinggal
  // dan port 2333 tetap dipakai setelah skrip ini ditutup.
  const stop = () => child.kill();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  // Jalur keluar terakhir: kalau skrip ini berakhir dengan cara apa pun, JVM
  // tidak boleh dibiarkan hidup di belakang.
  process.on('exit', stop);

  child.on('exit', (code, signal) => {
    if (signal) {
      process.exit(0);
    }
    process.exit(code ?? 0);
  });
}

await main();