import {
  MAX_STAT_KEY_LENGTH,
  MAX_STAT_LABEL_LENGTH,
  STAT_KINDS,
  type StatKind,
} from './types.js';

/**
 * Normalisasi kunci & label statistik.
 *
 * Aturan ini adalah penyaring privasi, bukan sekadar pembersihan input:
 * **argumen perintah dan teks pencarian member tidak boleh pernah sampai ke
 * `key`.** Kalau `/play <query>` menyimpan apa yang diketik orang, tabel
 * "lagu terpopuler" akan berisi semua yang pernah diketik siapa pun di server
 * itu — termasuk pesan pribadi — dan tabel itu tidak punya jalur penghapusan
 * karena memang tidak menyimpan siapa pun.
 *
 * Jadi `commandKey` mengambil **nama perintah saja**: `play` bukan
 * `play situs Rahasia member`.
 */

/** Error validasi dengan pesan yang bisa ditampilkan ke user. */
export class StatValidationError extends Error {
  public override readonly name = 'StatValidationError';
}

/** true kalau nilai itu salah satu jenis yang dikenal. */
export function isStatKind(value: unknown): value is StatKind {
  return typeof value === 'string' && (STAT_KINDS as readonly string[]).includes(value);
}

/**
 * Kunci untuk `kind = "command"`: nama perintah saja, huruf kecil.
 *
 * Huruf besar dikecilkan karena `/Play` dan `/play` adalah perintah yang sama
 * di Discord, dan membelah satu perintah jadi dua baris leaderboard hanya
 * membuat angkanya setengah benar.
 */
export function commandKey(commandName: string): string {
  const trimmed = commandName.trim().toLowerCase();

  return trimmed.slice(0, MAX_STAT_KEY_LENGTH);
}

/**
 * Kunci untuk `kind = "track"`.
 *
 * `uri` dipakai kalau ada karena itu satu-satunya pengenal yang stabil antar
 * hasil pencarian; judul dipakai sebagai cadangan dan **dikecilkan**, karena
 * judul yang sama dari dua sumber berbeda tetap satu lagu bagi pendengar.
 * Judul yang terlalu panjang dipotong, bukan ditolak: angka yang benar masih
 * berguna walau judulnya terpotong.
 */
export function trackKey(input: { uri?: string | null; title: string }): string {
  const uri = input.uri?.trim();

  return (uri && uri.length > 0 ? uri : input.title)
    .trim()
    .toLowerCase()
    .slice(0, MAX_STAT_KEY_LENGTH);
}

/** Label yang tampil di leaderboard. */
export function statLabel(value: string, fallback = 'Tidak diketahui'): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');

  if (trimmed.length === 0) return fallback;

  return trimmed.slice(0, MAX_STAT_LABEL_LENGTH);
}

/**
 * Validasi nilai yang akan ditulis.
 *
 * Dipanggil di tepi (service), bukan di dalam repository, supaya kode yang
 * memanggil modul ini dari luar tidak bisa menulis kunci kosong tanpa
 * disengaja — baris dengan `key = ''` akan menggabungkan semua item yang
 * tidak bernama jadi satu leaderboard palsu.
 */
export function assertStatInput(input: { kind: StatKind; key: string; label: string }): void {
  if (!isStatKind(input.kind)) {
    throw new StatValidationError(`Jenis statistik tidak dikenal: ${String(input.kind)}`);
  }

  if (input.key.trim().length === 0) {
    throw new StatValidationError('Kunci statistik tidak boleh kosong.');
  }

  if (input.label.trim().length === 0) {
    throw new StatValidationError('Label statistik tidak boleh kosong.');
  }
}