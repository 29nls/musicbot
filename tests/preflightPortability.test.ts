import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Penjaga portabilitas `deploy/casaos/preflight.mjs`.
 *
 * Kenapa penjaga ini perlu: skrip itu dijalankan **di NAS pengguna**, bukan di
 * mesin dev. CasaOS/ZimaOS lazim membawa Node 12, sementara mesin dev repo ini
 * Node 24 — jadi tanpa penjaga, sintaks Node baru masuk tanpa ada yang gagal
 * sampai pengguna menjalankannya, dan gejalanya hanya satu baris
 * `SyntaxError: Unexpected token '?'` yang bahkan tidak menyebut versi Node.
 *
 * Ini bukan teori: berkas versi lama memakai `??` dan impor `node:fs`, dan
 * Node 12.22.12 menolaknya persis di baris `??` (direproduksi saat perbaikan).
 *
 * Batas yang jujur: penjaga ini memeriksa daftar token/API yang sudah pernah
 * menggigit, memakai pemindai komentar/string sederhana di bawah — ia BUKAN
 * simulasi Node 12 dan tidak akan menangkap setiap API baru. Saat mengubah
 * berkasnya, jalankan juga sekali dengan Node 12 sungguhan.
 */

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), 'utf8');
}

type ScannerState = 'code' | 'line-comment' | 'block-comment' | 'single' | 'double' | 'template';

/**
 * Sisakan bagian berkas yang perlu diperiksa.
 *
 * `keepStrings = false` membuang komentar DAN literal string, sehingga token
 * seperti `??` di dalam teks pesan tidak ikut tertangkap. `keepStrings = true`
 * hanya membuang komentar — dipakai untuk mencari `'node:...'`, yang memang
 * hidup di dalam literal string impor.
 *
 * Batas: isi `${...}` di dalam template literal ikut dibuang bersama teksnya.
 * Untuk berkas ini tidak masalah — interpolasinya hanya pemanggilan sederhana —
 * tapi jangan dipakai untuk memindai berkas yang menaruh operator di sana.
 */
function strip(source: string, keepStrings: boolean): string {
  let out = '';
  let state: ScannerState = 'code';

  for (let index = 0; index < source.length; index++) {
    const char = source[index] as string;
    const next = source[index + 1];

    if (state === 'line-comment') {
      if (char === '\n') {
        state = 'code';
        out += char;
      }
      continue;
    }

    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        state = 'code';
        index++;
      }
      continue;
    }

    if (state === 'single' || state === 'double' || state === 'template') {
      if (char === '\\') {
        index++;
        continue;
      }
      const closer = state === 'single' ? "'" : state === 'double' ? '"' : '`';
      if (char === closer) state = 'code';
      if (keepStrings) out += char;
      continue;
    }

    if (char === '/' && next === '/') {
      state = 'line-comment';
      index++;
      continue;
    }
    if (char === '/' && next === '*') {
      state = 'block-comment';
      index++;
      continue;
    }
    if (char === "'") {
      state = 'single';
      if (keepStrings) out += char;
      continue;
    }
    if (char === '"') {
      state = 'double';
      if (keepStrings) out += char;
      continue;
    }
    if (char === '`') {
      state = 'template';
      if (keepStrings) out += char;
      continue;
    }

    out += char;
  }

  return out;
}

describe('preflight.mjs kompatibel Node lama (NAS CasaOS)', () => {
  const source = read('deploy/casaos/preflight.mjs');
  const code = strip(source, false);
  const withoutComments = strip(source, true);

  it('dimulai dengan shebang node', () => {
    expect(source.startsWith('#!/usr/bin/env node\n')).toBe(true);
  });

  it('tidak memakai nullish coalescing (`??`)', () => {
    expect(code).not.toMatch(/\?\?/);
  });

  it('tidak memakai optional chaining (`?.`)', () => {
    expect(code).not.toMatch(/\?\./);
  });

  it('tidak memanggil API yang belum ada di Node 12 (`.at()`, `.replaceAll()`)', () => {
    expect(code).not.toMatch(/\.at\s*\(/);
    expect(code).not.toMatch(/\.replaceAll\s*\(/);
  });

  it("mengimpor builtin tanpa prefiks `node:`", () => {
    // Prefiks `node:` baru dikenal Node 14.18/16; di Node 12 impornya gagal
    // dengan "Cannot find module 'node:fs'" setelah parse berhasil.
    expect(withoutComments).not.toMatch(/['"]node:/);
  });

  it('mencetak versi Node supaya laporan bug tidak perlu menebak', () => {
    // Dicek di `withoutComments`, bukan `code`: nilainya hidup di dalam
    // interpolasi template literal, dan mode kode-saja membuang seluruh isi
    // template (lihat catatan batas di `strip`).
    expect(withoutComments).toMatch(/process\.versions\.node/);
  });
});

describe('pemindai portabilitas', () => {
  it('benar-benar menangkap pelanggaran pada contoh yang rusak', () => {
    const rusak = [
      'const a = b ?? c;',
      'const d = e?.f;',
      'const g = h.at(-1);',
      'const h = i.replaceAll("x", "y");',
      "import x from 'node:fs';",
    ].join('\n');

    expect(strip(rusak, false)).toMatch(/\?\?/);
    expect(strip(rusak, false)).toMatch(/\?\./);
    expect(strip(rusak, false)).toMatch(/\.at\s*\(/);
    expect(strip(rusak, false)).toMatch(/\.replaceAll\s*\(/);
    expect(strip(rusak, true)).toMatch(/['"]node:/);
  });

  it('tidak tertipu oleh komentar dan string yang menyebut token itu', () => {
    // Berkasnya sendiri memuat `??` dan `node:` di komentar portabilitas —
    // kalau pemindai tidak membedakan komentar, penjaga ini mustahil hijau.
    const contoh = '// jangan pakai ?? atau ?. atau .at() di sini\nconst aman = "pakai ?? dong";\n';
    expect(strip(contoh, false)).not.toMatch(/\?\?/);
    expect(strip(contoh, false)).not.toMatch(/\?\./);
    expect(strip(contoh, false)).not.toMatch(/\.at\s*\(/);
    // String berisi token dibuang pada mode kode-saja...
    expect(strip('const s = "??";', false)).not.toMatch(/\?\?/);
    // ...dan dipertahankan pada mode simpan-string, yang dipakai mencari impor `node:`.
    expect(strip('const s = "node:fs";', true)).toMatch(/['"]node:/);
  });
});
