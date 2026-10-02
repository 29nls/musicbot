import type { LoggingRepository } from './repository.js';
import { DEFAULT_LOG_RETENTION_DAYS } from './types.js';

/**
 * Retensi riwayat log (PRD Bab 12): entri log disimpan 30 hari.
 *
 * Berbeda dengan kasus moderasi, batasnya bukan "umur sekarang dikurangi N
 * bulan" melainkan `expiresAt` yang dibawa setiap baris saat ditulis. Dua
 * alasannya: umur retensi log bisa diubah tanpa mengubah query penghapusan,
 * dan entri yang gagal ditulis lengkap maupun tidak tidak ikut kabur lewat
 * perhitungan ulang.
 */
export interface LogRetentionResult {
  /** Batas waktu penyapuan — baris dengan `expiresAt` di bawah ini dihapus. */
  cutoff: Date;
  /** Jumlah entri log yang dihapus. */
  logs: number;
}

/** Umur simpan riwayat log dalam hari, untuk ditampilkan ke user. */
export const LOG_RETENTION_DAYS = DEFAULT_LOG_RETENTION_DAYS;

/**
 * Hapus entri log yang sudah lewat retensi.
 *
 * `expiresAt` null tidak ikut terhapus: baris seperti itu tidak pernah
 * menetapkan batas, jadi menghapusnya berarti membuang data yang justru masih
 * harus disimpan — keputusan yang jauh lebih sulit dibatalkan daripada
 * sebaliknya.
 */
export async function purgeExpiredLogs(
  repository: Pick<LoggingRepository, 'deleteExpiredLogs'>,
  now = new Date(),
): Promise<LogRetentionResult> {
  const logs = await repository.deleteExpiredLogs(now);

  return { cutoff: now, logs };
}