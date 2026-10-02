import { getEnv } from '../config/env.js';
import { getModerationService } from '../modules/moderation/index.js';
import type { RetentionResult } from '../modules/moderation/retention.js';
import { getLogger } from './logger.js';

/** Yang dibutuhkan job ini dari service moderasi (dipisah supaya bisa diuji). */
export interface RetentionRunner {
  purgeExpired(now?: Date): Promise<RetentionResult>;
}

export interface RetentionJobOptions {
  /** Jeda antar sapuan; default dari env `RETENTION_SWEEP_HOURS` (6 jam). */
  intervalMs?: number;
  /** Jalankan sekali saat start (default true). */
  runOnStart?: boolean;
}

export interface RetentionJob {
  /** Jalankan satu sapuan; null kalau gagal atau masih berjalan. */
  runOnce(now?: Date): Promise<RetentionResult | null>;
  /** Berhenti menjadwalkan (dipanggil saat shutdown). */
  stop(): void;
}

const DEFAULT_HOURS = 6;

/**
 * Job retensi data: menghapus kasus & peringatan yang lewat 12 bulan.
 *
 * Dijadwalkan di dalam proses bot, jadi ikut berhenti kalau bot berhenti —
 * tidak ada cron yang harus dipasang di host. Sapuan pertama berjalan saat
 * start supaya data lama langsung bersih tanpa menunggu interval.
 *
 * Keamanannya:
 * - timer di-`unref()` sehingga tidak pernah menahan proses keluar;
 * - sapuan yang masih berjalan tidak diganggu sapuan berikutnya (mis. DB lambat);
 * - kegagalan hanya jadi peringatan — bot tidak crash dan mencoba lagi nanti;
 * - `RETENTION_SWEEP_HOURS=0` mematikan penjadwalan (runOnStart tetap jalan).
 */
export function startRetentionJob(
  runner: RetentionRunner = getModerationService(),
  options: RetentionJobOptions = {},
): RetentionJob {
  const logger = getLogger();
  const intervalMs = options.intervalMs ?? defaultIntervalMs();
  let running = false;

  const runOnce = async (now = new Date()): Promise<RetentionResult | null> => {
    if (running) {
      logger.debug('Sapuan retensi dilewati — sapuan sebelumnya masih jalan');
      return null;
    }

    running = true;
    try {
      const result = await runner.purgeExpired(now);
      if (result.cases > 0 || result.warnings > 0) {
        logger.info(
          { cutoff: result.cutoff.toISOString(), cases: result.cases, warnings: result.warnings },
          'Retensi: kasus & peringatan kedaluwarsa dihapus',
        );
      } else {
        logger.debug({ cutoff: result.cutoff.toISOString() }, 'Retensi: tidak ada data kedaluwarsa');
      }
      return result;
    } catch (error) {
      logger.warn({ err: error }, 'Retensi gagal dijalankan — akan dicoba lagi nanti');
      return null;
    } finally {
      running = false;
    }
  };

  if (options.runOnStart !== false) {
    void runOnce();
  }

  let timer: NodeJS.Timeout | undefined;

  if (intervalMs > 0) {
    timer = setInterval(() => {
      void runOnce();
    }, intervalMs);
    // Tanpa unref, timer ini akan menjaga proses tetap hidup saat shutdown.
    timer.unref();
    logger.info(
      { intervalHours: Math.round(intervalMs / 3_600_000) },
      'Job retensi dijadwalkan',
    );
  } else {
    logger.info('Job retensi dijadwalkan: mati (RETENTION_SWEEP_HOURS=0)');
  }

  return {
    runOnce,
    stop(): void {
      if (timer) clearInterval(timer);
      logger.debug('Job retensi dihentikan');
    },
  };
}

/** Default dari env `RETENTION_SWEEP_HOURS`; 0 berarti penjadwalan dimatikan. */
function defaultIntervalMs(): number {
  const hours = getEnv().RETENTION_SWEEP_HOURS;
  if (hours === 0) return 0;

  return hours * 3_600_000 || DEFAULT_HOURS * 3_600_000;
}
