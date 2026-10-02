import { PrismaModerationRepository } from './modules/moderation/repository.js';
import { purgeExpiredRecords } from './modules/moderation/retention.js';
import { disconnectDatabase, getPrisma } from './services/database.js';
import { getLogger } from './services/logger.js';

/**
 * Sekali-jalan: bersihkan kasus & peringatan yang lewat retensi 12 bulan.
 *
 * Dipakai kalau pembersihan lebih suka dijalankan dari cron luar:
 *   npm run db:prune
 *
 * Bot sendiri juga menjadwalkan job yang sama, jadi biasanya tidak perlu
 * menjalankan ini dua kali.
 */
const logger = getLogger();

try {
  const result = await purgeExpiredRecords(new PrismaModerationRepository(getPrisma()));
  logger.info(
    { cutoff: result.cutoff.toISOString(), cases: result.cases, warnings: result.warnings },
    'Retensi selesai',
  );

  // Ringkasan JSON polos di stdout supaya cron bisa mengirimnya ke log/monitor.
  process.stdout.write(
    `${JSON.stringify({
      cutoff: result.cutoff.toISOString(),
      casesDeleted: result.cases,
      warningsDeleted: result.warnings,
    })}\n`,
  );
} catch (error) {
  logger.error({ err: error }, 'Retensi gagal dijalankan');
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
