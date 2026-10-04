import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Kontrak nama endpoint antara PRD dan server health check.
 *
 * **Kenapa ini perlu sebagai tes.** Cukup lama PRD §11 menuliskan
 * `/healthz` sementara yang berjalan sejak awal adalah `/health` & `/ready`:
 * dokumen dan kode sama-sama terlihat benar, jadi tidak ada yang salah sampai
 * ada yang mengikuti PRD itu dan mendapat 404. Salah nama endpoint di dokumen
 * adalah kesalahan yang tidak pernah muncul di halaman error.
 *
 * Cakupannya sengaja **satu baris**: baris requirement "Observability" di §11.
 * Kalau seluruh PRD ikut diperiksa, catatan riwayat (§19) yang menyebut nama
 * lama akan dianggap pelanggaran — padahal mencatat sejarah bukan klaim bahwa
 * endpoint itu ada sekarang.
 *
 * Arahnya dua: PRD tidak boleh menyebut endpoint yang tidak dilayani, dan
 * server tidak boleh melayani endpoint yang tidak disebut PRD.
 */

const PRD = readFileSync(fileURLToPath(new URL('../PRD.md', import.meta.url)), 'utf8');
const SERVER = readFileSync(
  fileURLToPath(new URL('../src/modules/health/server.ts', import.meta.url)),
  'utf8',
);

/** Baris requirement Observability di §11 — satu-satunya klaim endpoint. */
function observabilityRow(): string {
  const row = PRD.split(/\r?\n/).find((line) => line.startsWith('| **Observability** |'));

  if (row === undefined) {
    throw new Error(
      'Baris "| **Observability** |" tidak ditemukan di PRD.md — penjaga ini tidak boleh diam.',
    );
  }

  return row;
}

/** Path yang benar-benar dibandingkan server, mis. `path === '/metrics'`. */
function servedPaths(): Set<string> {
  const found = new Set<string>();
  const pattern = /path === '([^']+)'/g;

  let match = pattern.exec(SERVER);
  while (match !== null) {
    found.add(match[1] ?? '');
    match = pattern.exec(SERVER);
  }

  return found;
}

/** Path yang disebut PRD di baris itu, ditulis dalam backtick. */
function documentedPaths(): Set<string> {
  const found = new Set<string>();
  const pattern = /`(\/[a-z0-9_-]+)`/gi;
  const row = observabilityRow();

  let match = pattern.exec(row);
  while (match !== null) {
    found.add(match[1] ?? '');
    match = pattern.exec(row);
  }

  return found;
}

describe('kontrak endpoint health check', () => {
  it('PRD tidak menyebut endpoint yang tidak dilayani server', () => {
    const served = servedPaths();
    const invented = [...documentedPaths()].filter((path) => !served.has(path));

    expect(invented).toEqual([]);
  });

  it('server tidak melayani endpoint yang tidak disebut PRD', () => {
    const documented = documentedPaths();
    const undeclared = [...servedPaths()].filter((path) => !documented.has(path));

    expect(undeclared).toEqual([]);
  });

  it('baris requirement tidak menyebut nama endpoint dari draft lama', () => {
    // Nama lama hanya boleh muncul sebagai catatan sejarah di §19, tidak
    // sebagai klaim di baris requirement.
    expect(observabilityRow()).not.toContain('/healthz');
  });

  it('ketiga endpoint yang dijanjikan benar-benar dibandingkan server', () => {
    const served = servedPaths();

    expect(served.has('/health')).toBe(true);
    expect(served.has('/ready')).toBe(true);
    expect(served.has('/metrics')).toBe(true);
  });

  it('penjaganya benar-benar bergigi, bukan karena tidak menemukan apa pun', () => {
    // Kalau pola pengambilannya rusak, kedua penjaga utama di atas hijau
    // karena himpunan kosong. Dinyatakan terbuka di sini.
    expect(servedPaths().size).toBeGreaterThanOrEqual(3);
    expect(documentedPaths().size).toBeGreaterThanOrEqual(3);
  });
});
