import type { ModerationRepository } from './repository.js';

/**
 * Retensi data (PRD Bab 10 & 12): kasus moderasi dan peringatan disimpan
 * 12 bulan. Setelah itu bot menghapusnya otomatis — bukan karena nilai
 * moderasi basi, tapi karena kebijakan privasi.
 */
export const RETENTION_MONTHS = 12;

export interface RetentionResult {
  /** Batas waktu yang dipakai — ikut dilog agar bisa diaudit. */
  cutoff: Date;
  /** Jumlah baris `warning` yang dihapus. */
  warnings: number;
  /** Jumlah baris `moderation_case` yang dihapus. */
  cases: number;
}

/** Batas retensi: tepat 12 bulan sebelum `now`. */
export function retentionCutoff(now = new Date()): Date {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
  return cutoff;
}

/**
 * Hapus kasus & peringatan yang melewati retensi.
 *
 * Peringatan dihapus lebih dulu agar jumlahnya akurat; kasus yang ikut terhapus
 * tetap menarik peringatan anaknya lewat `onDelete: Cascade`, jadi jalurnya
 * tetap aman kalau ada baris yang lolos penghapusan pertama.
 *
 * `active` tidak diperhitungkan: ban yang masih aktif tetap berlaku di Discord,
 * tabel kasus hanya arsip audit.
 */
export async function purgeExpiredRecords(
  repository: Pick<ModerationRepository, 'deleteExpiredWarnings' | 'deleteExpiredCases'>,
  now = new Date(),
): Promise<RetentionResult> {
  const cutoff = retentionCutoff(now);

  const warnings = await repository.deleteExpiredWarnings(cutoff);
  const cases = await repository.deleteExpiredCases(cutoff);

  return { cutoff, warnings, cases };
}
