#!/usr/bin/env node
/**
 * Periksa konfigurasi Harmony untuk CasaOS SEBELUM menjalankan `docker compose up`.
 *
 * Ada satu jebakan yang mudah terlewat di compose: nilai `${LAVALINK_PASSWORD:?...}`
 * dibaca dari berkas `.env` di **direktori proyek compose**, bukan dari berkas yang
 * dicantumkan di `env_file:`. Dua-duanya punya nama yang sama, jadi mudah terkira satu
 * hal, padahal sumbernya berbeda:
 *
 *   - `env_file:`      → dibaca waktu container dijalankan, dari path yang kamu tulis
 *   - `${VAR:?...}`     → dibaca waktu compose di-parse, dari `<project-dir>/.env`
 *
 * Kalau compose dijalankan dari direktori lain, `env_file` tetap ketemu tapi
 * variabel untuk interpolasi tidak — dan gejalanya persis seperti yang pernah
 * terjadi: "required variable LAVALINK_PASSWORD is missing a value".
 *
 * Skrip ini tidak mengubah apa pun; ia hanya melaporkan penyebabnya.
 *
 * PORTABILITAS — kenapa berkas ini menghindari sintaks Node baru:
 * ia dijalankan DI NAS PENGGUNA, dan CasaOS/ZimaOS lazim membawa Node 12.
 * Versi pertama berkas ini memakai `??`, `.at(-1)`, dan impor `node:fs`; di
 * Node 12 semuanya berhenti di parse (`SyntaxError: Unexpected token '?'`,
 * terukur pada Node 12.22.12) sehingga alat diagnosisnya sendiri tidak bisa
 * jalan — dan pesannya bahkan tidak menyebut versi Node. Jangan tambahkan
 * kembali `??`, `?.`, `.at(`, `replaceAll`, atau impor berprefiks `node:` ke
 * berkas ini. Target: Node 12.17+ (ESM tanpa flag). Penjaganya ada di
 * tests/preflightPortability.test.ts, dan baris pertama keluaran mencetak
 * versi Node yang menjalankan skrip supaya laporan bug tidak perlu menebak.
 *
 * Pakai:
 *   node deploy/casaos/preflight.mjs [path/ke/.env]
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';

const DEFAULT_DATA = process.env.HARMONY_DATA || '/DATA/AppData/harmony-bot';

/**
 * Urutan pencarian berkas .env:
 *
 *   1. argumen baris perintah
 *   2. `.env` di direktori kerja — ini yang dipakai kalau skrip dijalankan
 *      dari folder yang sama dengan .env, yaitu cara paling wajar
 *   3. `$HARMONY_DATA/.env`
 *   4. lokasi bawaan CasaOS
 */
function locateEnv() {
  const candidates = [
    process.argv[2],
    resolve('.env'),
    process.env.HARMONY_DATA ? resolve(process.env.HARMONY_DATA, '.env') : undefined,
    resolve(DEFAULT_DATA, '.env'),
  ].filter(Boolean);

  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) return found;

  // Tanpa `??` dan `.at(-1)`: keduanya baru ada di Node 14/16, sedangkan
  // berkas ini harus jalan di Node 12 (lihat catatan portabilitas di atas).
  const last = candidates[candidates.length - 1];
  return resolve(last || '.env');
}

const envPath = locateEnv();
const composeDir = process.env.HARMONY_COMPOSE_DIR || process.cwd();

const problems = [];
const notes = [];

/** Kunci yang wajib ada dan tidak boleh kosong. */
const REQUIRED = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DATABASE_URL', 'LAVALINK_PASSWORD'];

/** Nilai yang masih berupa contoh bawaan .env.example. */
const PLACEHOLDER_PREFIXES = ['harmony_dev_password', 'test_', 'ganti', 'ISI_'];

function report(ok, message) {
  const line = `${ok ? '  OK  ' : '  GAGAL'} ${message}`;
  console.log(line);
  if (!ok) problems.push(message);
}

console.log(`Harmony preflight | Node ${process.versions.node}`);

// --- 1. Berkas .env ada? ---------------------------------------------------
console.log(`Memeriksa: ${envPath}`);
if (!existsSync(envPath)) {
  report(false, `Berkas .env tidak ada di ${envPath}`);

  console.log('\nBuat dulu:');
  console.log(
    `  mkdir -p ${DEFAULT_DATA}\n` +
      '  curl -fsSL https://raw.githubusercontent.com/29nls/musicbot/main/.env.example \\\n' +
      `    -o ${DEFAULT_DATA}/.env`,
  );
  console.log('\nLalu isi DISCORD_TOKEN, DISCORD_CLIENT_ID, DATABASE_URL, dan LAVALINK_PASSWORD.');
  process.exit(1);
}
report(true, 'berkas .env ada');

// --- 2. Parse isi .env -----------------------------------------------------
const parsed = new Map();
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) continue;
  const separator = trimmed.indexOf('=');
  if (separator === -1) continue;

  const key = trimmed.slice(0, separator).trim();
  let value = trimmed.slice(separator + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  parsed.set(key, value);
}

// --- 3. Kunci wajib ada dan tidak kosong ----------------------------------
for (const key of REQUIRED) {
  if (!parsed.has(key)) {
    report(false, `${key} tidak ada di .env`);
    continue;
  }

  const value = parsed.get(key) || '';
  // Compose menganggap nilai kosong sama dengan tidak ada — ini penyebab paling
  // sering, dan pesannya menyesatkan karena "~tidak ada~" padahal barisnya ada.
  if (value === '') {
    report(false, `${key} ada tapi KOSONG — compose akan tetap melaporkan "missing a value"`);
    continue;
  }

  const placeholder = PLACEHOLDER_PREFIXES.find((prefix) => value.startsWith(prefix));
  if (placeholder) {
    report(false, `${key} masih memakai nilai contoh dari .env.example ("${value}")`);
    continue;
  }

  report(true, `${key} terisi`);
}

// --- 4. Sumber interpolasi --------------------------------------------------
const projectEnv = resolve(composeDir, '.env');
console.log(`\nDirektori proyek compose: ${composeDir}`);
console.log(`Berkas .env untuk interpolasi: ${projectEnv}`);

if (projectEnv !== envPath) {
  if (existsSync(projectEnv)) {
    notes.push(
      `Compose akan membaca ${projectEnv} untuk interpolasi, bukan ${envPath}.\n` +
        `    Jalankan dari folder tempat .env berada:\n` +
        `      cd ${dirname(envPath)} && docker compose up -d\n` +
        '    atau teruskan berkas .env secara eksplisit:\n' +
        `      docker compose --env-file ${envPath} up -d`,
    );
    console.log(`\n  CATATAN  ${projectEnv} juga ada. Itu yang akan dipakai untuk interpolasi.`);
    console.log(`           Pastikan LAVALINK_PASSWORD terisi di ${projectEnv} juga.`);
  } else {
    report(
      false,
      `.env untuk interpolasi tidak ada di direktori proyek (${projectEnv}).\n` +
        '         Jalankan dari folder .env, atau pakai: docker compose --env-file <path/.env> up -d',
    );
  }
} else {
  report(true, 'direktori proyek sama dengan lokasi .env');
}

// --- Ringkasan -------------------------------------------------------------
if (notes.length > 0) {
  console.log('\nCatatan:');
  for (const note of notes) console.log(`  - ${note}`);
}

console.log('');
if (problems.length === 0) {
  console.log('Semua pemeriksaan lolos. Lanjut: docker compose up -d');
  process.exit(0);
}

console.log(`${problems.length} masalah ditemukan (lihat tanda GAGAL di atas).`);
process.exit(1);
