import { getLoggingService } from './modules/logging/index.js';
import { getModerationService } from './modules/moderation/index.js';
import { getStatsService } from './modules/stats/index.js';
import { getTicketService } from './modules/tickets/index.js';
import { formatPruneReport, runPrune } from './services/pruneRetention.js';
import { disconnectDatabase } from './services/database.js';
import { getLogger } from './services/logger.js';

/**
 * Sekali-jalan: bersihkan semua data yang lewat retensi.
 *
 * Dipakai kalau pembersihan lebih suka dijalankan dari cron luar:
 *   npm run db:prune
 *
 * Bot sendiri juga menjadwalkan siklus yang sama di dalam proses, jadi
 * biasanya tidak perlu menjalankan ini dua kali. Kalau `RETENTION_SWEEP_HOURS=0`
 * dipakai, barulah cron ini yang jadi satu-satunya jalur retensi.
 *
 * **Berkas ini sengaja tidak punya daftar sapuan apa pun.** Ia hanya
 * membangun keempat service dari Prisma lalu menyerahkan pekerjaan ke
 * `runPrune`. Setiap sapuan yang ditulis langsung di sini adalah satu
 * kesempatan lagi untuk membuat kedua jalur retensi berbeda — dan itu
 * persis kesalahan yang membuat versi lama membiarkan tiket beserta
 * transkripnya menumpuk tanpa pernah dihapus.
 */
const logger = getLogger();

try {
  const report = await runPrune({
    moderation: getModerationService(),
    tickets: getTicketService(),
    stats: getStatsService(),
    logs: getLoggingService(),
  });

  if (report.casesDeleted > 0 || report.warningsDeleted > 0) {
    logger.info(
      {
        cutoff: report.cutoff,
        cases: report.casesDeleted,
        warnings: report.warningsDeleted,
      },
      'Retensi selesai',
    );
  }

  // Sapuan lain punya basis waktu sendiri, jadi kegagalannya tidak boleh
  // menutupi laporan kasus. Tapi kegagalannya juga tidak boleh hilang:
  // `null` di laporan berarti "tidak pernah bisa dicek", bukan "tidak ada".
  for (const [label, count] of [
    ['tiket', report.ticketsDeleted],
    ['statistik playback', report.statsDeleted],
    ['log', report.logsDeleted],
  ] as const) {
    if (count === null) logger.warn({ label }, `Retensi ${label} gagal — data lain tetap aman`);
    else if (count > 0) logger.info({ label, deleted: count }, `Retensi ${label} selesai`);
  }

  // Ringkasan JSON polos di stdout supaya cron bisa mengirimnya ke log/monitor.
  process.stdout.write(formatPruneReport(report));
} catch (error) {
  logger.error({ err: error }, 'Retensi gagal dijalankan');
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}