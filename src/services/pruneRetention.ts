import { runRetentionSweeps, type RetentionSweepDeps, type RetentionSweepSummary } from './retentionSweeps.js';

/**
 * Jalur retensi yang dipanggil sekali dari cron: `npm run db:prune`.
 *
 * Jalur ini punya sejarah yang berbeda dari job dalam proses, dan itulah
 * sumber syarat bug-nya. PRD §12 mengarahkan operator untuk mematikan
 * `RETENTION_SWEEP_HOURS=0` lalu menjalankan pembersihan dari cron — jadi
 * jalur inilah yang jadi satu-satunya saat opsi itu dipakai.
 * Script lama di sini hanya menyapu kasus, peringatan, dan log: tiket
 * (retensi 12 bulan, termasuk transkrip percakapan privat) dan statistik
 * playback (90 hari) tidak pernah disentuh, dan laporan JSON-nya tidak punya
 * kunci untuk keduanya, jadi selisihnya tidak terlihat dari mana pun.
 *
 * Sekarang jalur ini memakai `runRetentionSweeps`, yang sama dengan job
 * dalam proses. Satu definisi, jadi tidak ada lagi tempat kedua yang bisa
 * kehilangan sapuan.
 */

/**
 * Laporan satu siklus, sudah diratakan menjadi JSON.
 *
 * Angka yang gagal menyapu bernilai `null`, bukan `0`. Bedanya penting:
 * `0` berarti "benar-benar tidak ada yang kedaluwarsa", `null` berarti
 * "tidak pernah bisa dicek", dan keduanya berarti hal yang sangat berbeda
 * bagi operator yang membaca laporan cron pagi ini.
 */
export interface PruneReport {
  /** Batas waktu sapuan kasus; detik dipakai juga sebagai penanda satu siklus. */
  cutoff: string;
  casesDeleted: number;
  warningsDeleted: number;
  ticketsDeleted: number | null;
  statsDeleted: number | null;
  logsDeleted: number | null;
}

/**
 * Jalankan keempat sapuan sekali jalan dan rangkum hasilnya.
 *
 * Melempar hanya kalau sapuan kasus gagal, sama seperti job dalam proses:
 * kalau itu gagal, siklus ini memang tidak menghasilkan apa pun yang bisa
 * dilaporkan. Kegagalan tiga sapuan lain tercatat di ringkasan sebagai
 * `null` supaya tidak pernah hilang tanpa jejak.
 */
export async function runPrune(deps: RetentionSweepDeps, now = new Date()): Promise<PruneReport> {
  return toReport(await runRetentionSweeps(deps, now));
}

/** Ubah ringkasan sapuan menjadi laporan yang aman dicetak ke stdout. */
export function toReport(summary: RetentionSweepSummary): PruneReport {
  return {
    cutoff: summary.moderation.cutoff.toISOString(),
    casesDeleted: summary.moderation.cases,
    warningsDeleted: summary.moderation.warnings,
    ticketsDeleted: summary.tickets?.ticketsDeleted ?? null,
    statsDeleted: summary.stats?.deleted ?? null,
    logsDeleted: summary.logs?.logs ?? null,
  };
}

/**
 * Bentuk JSON polos untuk stdout, satu baris.
 *
 * Dipisah dari `runPrune` supaya bentuk lapirannya bisa diuji tanpa
 * menjalankan sapuan apa pun: kalau satu kunci hilang, laporan cron jadi
 * lebih sulit dibaca tanpa error.
 */
export function formatPruneReport(report: PruneReport): string {
  return `${JSON.stringify({
    cutoff: report.cutoff,
    casesDeleted: report.casesDeleted,
    warningsDeleted: report.warningsDeleted,
    ticketsDeleted: report.ticketsDeleted,
    statsDeleted: report.statsDeleted,
    logsDeleted: report.logsDeleted,
  })}\n`;
}