import { LoggingService } from './modules/logging/service.js';
import { PrismaLoggingRepository } from './modules/logging/repository.js';
import { PrismaModerationRepository } from './modules/moderation/repository.js';
import { purgeExpiredRecords } from './modules/moderation/retention.js';
import { disconnectDatabase, getPrisma } from './services/database.js';
import { getLogger } from './services/logger.js';

/**
 * Sekali-jalan: bersihkan kasus, peringatan, dan riwayat log yang lewat retensi
 * (12 bulan untuk kasus, 30 hari untuk log).
 *
 * Dipakai kalau pembersihan lebih suka dijalankan dari cron luar:
 *   npm run db:prune
 *
 * Bot sendiri juga menjadwalkan job yang sama, jadi biasanya tidak perlu
 * menjalankan ini dua kali.
 */
const logger = getLogger();
const prisma = getPrisma();

try {
  const result = await purgeExpiredRecords(new PrismaModerationRepository(prisma));
  logger.info(
    { cutoff: result.cutoff.toISOString(), cases: result.cases, warnings: result.warnings },
    'Retensi selesai',
  );

  // Log punya retensi sendiri (30 hari). Kegagalannya tidak menggagalkan
  // laporan kasus: dua penghapusan dengan basis waktu berbeda tidak perlu gagal
  // bersama supaya satu yang berhasil dilaporkan sebagai gagal.
  let logsDeleted: number | null = null;
  try {
    const logs = await new LoggingService(new PrismaLoggingRepository(prisma)).purgeExpired();
    logsDeleted = logs.logs;
    if (logs.logs > 0) {
      logger.info({ cutoff: logs.cutoff.toISOString(), logs: logs.logs }, 'Retensi log selesai');
    }
  } catch (error) {
    logger.warn({ err: error }, 'Retensi log gagal — kasus & peringatan tetap aman');
  }

  // Ringkasan JSON polos di stdout supaya cron bisa mengirimnya ke log/monitor.
  process.stdout.write(
    `${JSON.stringify({
      cutoff: result.cutoff.toISOString(),
      casesDeleted: result.cases,
      warningsDeleted: result.warnings,
      logsDeleted,
    })}\n`,
  );
} catch (error) {
  logger.error({ err: error }, 'Retensi gagal dijalankan');
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
