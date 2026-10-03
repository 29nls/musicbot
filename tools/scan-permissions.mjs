// Laporan izin Discord yang dipanggil di src/ vs yang diminta saat undangan.
//
// Bedanya dengan tests/invitePermissions.test.ts: tes ituREWAK (hijau atau
// merah), skrip ini MELAPORKAN. Yang satu dipakai di CI, yang ini dipakai
// sebelum,/invite` dijalankan supaya kelihatan izin mana yang belum masuk.
//
// Pakai: npm run perms:scan

import { PermissionFlagsBits } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const INVITE = path.join(ROOT, 'tools', 'invite.mjs');

const RULE = '='.repeat(72);
const THIN = '-'.repeat(72);

/**
 * Buang komentar tanpa mengubah jumlah baris.
 *
 * Baris kosong sebagai pengganti komentar biasa memendekkan sumbernya, lalu
 * nomor baris yang dilaporkan ikut bergeser -- dan laporan yang salah nomor
 * baris lebih buruk daripada tidak ada laporan sama sekali.
 */
function stripCommentsKeepLines(source) {
  const out = [];
  let inBlock = false;

  for (const line of source.split('\n')) {
    let kept = '';
    let quote = null;

    for (let i = 0; i < line.length; i += 1) {
      const two = line.slice(i, i + 2);

      if (inBlock) {
        if (two === '*/') {
          inBlock = false;
          i += 1;
        }
        continue;
      }
      if (quote) {
        if (line[i] === quote) quote = null;
        kept += line[i];
        continue;
      }
      if (two === '//') break;
      if (two === '/*') {
        inBlock = true;
        i += 1;
        continue;
      }
      if (line[i] === "'" || line[i] === '"' || line[i] === '`') quote = line[i];
      kept += line[i];
    }

    out.push(kept);
  }

  return out;
}

/** Semua berkas .ts yang perlu dipindai (lihat catatan soal `_` di bawah). */
function sourceFiles() {
  const files = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Prisma Client hasil generate: bukan kode repo ini, danPermissionFlagsBits
        // tidak pernah muncul di sana.
        if (entry.name === 'generated') continue;
        walk(full);
      } else if (entry.name.endsWith('.ts')) {
        files.push(full);
      }
    }
  };

  walk(SRC);
  return files.sort();
}

const relative = (file) => path.relative(ROOT, file).split(path.sep).join('/');

/** Nama izin yang diminta saat undangan, beserta alasannya. */
function declaredPermissions() {
  const source = fs.readFileSync(INVITE, 'utf8');
  const block = /const REQUIRED_PERMISSIONS = \[([\s\S]*?)\n\];/.exec(source);
  if (!block) {
    console.error('Gagal: daftar REQUIRED_PERMISSIONS tidak ditemukan di tools/invite.mjs');
    process.exit(1);
  }

  const declared = new Map();
  for (const line of block[1].split('\n')) {
    const match = /^\s*\[\s*'([A-Za-z]+)'\s*,\s*'([^']*)'\s*\],?\s*$/.exec(line);
    if (match) declared.set(match[1], match[2]);
  }

  return declared;
}

function bit(name) {
  const value = PermissionFlagsBits[name];
  return value === undefined ? undefined : BigInt(value);
}

// ── Pemindaian ────────────────────────────────────────────────────────────

const files = sourceFiles();
const used = new Map();

for (const file of files) {
  const lines = stripCommentsKeepLines(fs.readFileSync(file, 'utf8'));

  lines.forEach((line, index) => {
    for (const match of line.matchAll(/PermissionFlagsBits\.([A-Za-z]+)/g)) {
      const name = match[1];
      if (!name) continue;

      const spots = used.get(name) ?? [];
      spots.push({ file: relative(file), line: index + 1 });
      used.set(name, spots);
    }
  });
}

const declared = declaredPermissions();

let integer = 0n;
for (const name of declared.keys()) {
  const value = bit(name);
  if (value === undefined) {
    console.error('Gagal: tools/invite.mjs meminta izin tak dikenal: ' + name);
    process.exit(1);
  }
  integer |= value;
}

// ── Laporan ────────────────────────────────────────────────────────────────

console.log(RULE);
console.log('IZIN DISCORD YANG DIPANGGIL DI src/');
console.log(RULE);
console.log('');
console.log('  berkas .ts dipindai : ' + files.length);
console.log('  rujukan ditemukan  : ' + [...used.values()].reduce((n, spots) => n + spots.length, 0));
console.log('  izin berbeda       : ' + used.size);
console.log('  sudah terdaftar    : ' + declared.size);
console.log('');
console.log('  Izin yang diperintah di src/ termasuk berkas berawalan "_":');
console.log('  src/commands/admin/_shared.ts memegang seluruh ADMIN_PERMISSIONS.');
console.log('  Berkas itu tidak didaftarkan sebagai modul, tapi izinya tetap dipakai.');
console.log('');

const sorted = [...used.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

console.log(THIN);
console.log('RINCIAN PENGGUNAAN');
console.log(THIN);

for (const [name, spots] of sorted) {
  const mark = declared.has(name) ? 'terdaftar ' : 'BELUM    ';
  console.log('');
  console.log('  ' + name.padEnd(20) + spots.length + 'x  [' + mark + ']');
  for (const spot of spots.slice(0, 3)) {
    console.log('      ' + (spot.file + ':' + spot.line));
  }
  if (spots.length > 3) {
    console.log('      ... dan ' + (spots.length - 3) + ' rujukan lain');
  }
}

const missing = sorted.filter(([name]) => !declared.has(name));
const extra = [...declared.keys()].filter((name) => !used.has(name));

console.log('');
console.log(THIN);
console.log('REKOMENDASI');
console.log(THIN);
console.log('');

if (missing.length === 0) {
  console.log('  Semua izin yang dipanggil src/ sudah terdaftar di tools/invite.mjs.');
} else {
  console.log('  ' + missing.length + ' izin dipanggil di src/ tapi belum diminta saat');
  console.log('  undangan. Bot akan gagal di server yang profilnya kurang:');
  console.log('');

  for (const [name, spots] of missing) {
    console.log('  + ' + name);
    const where = spots.slice(0, 4).map((spot) => spot.file + ':' + spot.line);
    console.log('      dipanggil di : ' + where.join(', ') + (spots.length > 4 ? ' ...' : ''));
    console.log('      saran baris  : ["' + name + '", "<alasan singkat>"],');

    const value = bit(name);
    if (value === undefined) {
      console.log('      CATATAN      : nama tidak dikenal oleh discord.js yang terpasang');
      continue;
    }
    const next = integer | value;
    console.log(
      '      integer      : ' + integer.toString() + ' -> ' + next.toString() +
        ' (+' + value.toString() + ')',
    );
    console.log('');
  }

  console.log('  Setelah menambahkannya, jalankan ulang `npm run invite` lalu');
  console.log('  `tests/invitePermissions.test.ts` akan memeriksa hasilnya.');
}

if (extra.length > 0) {
  console.log('');
  console.log('  Catatan: ' + extra.length + ' izin terdaftar tapi tidak dipanggil kode:');
  console.log('  ' + extra.join(', '));
  console.log('');
  console.log('  Itu tidak otomatis salah. Izin yang Discord tegakkan sendiri');
  console.log('  (Embed Links, Read Message History, Attach Files) memang tidak akan');
  console.log('  pernah muncul di src/. Tapi kalau bukan seperti itu, hapus dari daftar');
  console.log('  supaya profil undangan tidak memberi akses yang tidak terpakai.');
}

console.log('');
console.log(RULE);
console.log(
  'RINGKASAN: ' + used.size + ' dipanggil | ' +
    (used.size - missing.length) + ' terdaftar | ' + missing.length + ' perlu ditambah | ' +
    extra.length + ' terdaftar tanpa rujukan kode',
);
console.log(RULE);