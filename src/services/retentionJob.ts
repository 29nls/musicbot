import { getEnv } from '../config/env.js';
import { getLoggingService } from '../modules/logging/index.js';
import type { LogRetentionResult } from '../modules/logging/retention.js';
import { getModerationService } from '../modules/moderation/index.js';
import type { RetentionResult } from '../modules/moderation/retention.js';
import { getTicketService } from '../modules/tickets/index.js';
import type { TicketRetentionResult } from '../modules/tickets/retention.js';
import type { StatRetentionResult } from '../modules/stats/index.js';
import { getLogger } from './logger.js';
import type { SweepLease } from './sweepLease.js';

/** Yang dibutuhkan job ini dari service moderasi (dipisah supaya bisa diuji). */
export interface RetentionRunner {
  purgeExpired(now?: Date): Promise<RetentionResult>;
}

/** Sapuan retensi tiket — dijalankan setelah kasus, bukan menggantikannya. */
export interface TicketRetentionRunner {
  purgeExpired(now?: Date): Promise<TicketRetentionResult>;
}

/**
 * Sapuan retensi statistik playback (Fase 3).
 *
 * Opsional lewat opsi, bukan default: kalau tidak diberikan, sapuan statistik
 * dilewati. Itu membuat job ini tetap bisa diuji tanpa repository sungguhan,
 * dan `src/index.ts` yang memutuskan apakah bot ikut menyapu statistik.
 */
export interface StatsRetentionRunner {
  purgeExpired(now?: Date): Promise<StatRetentionResult>;
}

/**
 * Sapuan retensi riwayat log — dijalankan terakhir.
 *
 * Dipisah dari kasus karena retensinya jauh lebih pendek (30 hari vs 12 bulan)
 * dan volumenya jauh lebih besar, jadi mengalahkannya di jalur yang sama
 * berarti satu query lambat menahan penghapusan yang lain.
 */
export interface LogRetentionRunner {
  purgeExpired(now?: Date): Promise<LogRetentionResult>;
}

export interface RetentionJobOptions {
  /** Jeda antar sapuan; default dari env `RETENTION_SWEEP_HOURS` (6 jam). */
  intervalMs?: number;
  /** Jalankan sekali saat start (default true). */
  runOnStart?: boolean;
  /**
   * Lease yang membuat sapuan ini jalan di satu proses saja.
   *
   * Penghapusan retensi bersifat global, jadi tanpa lease tiap proses akan
   * menjalankannya bersamaan: database dipanggil N kali untuk pekerjaan yang
   * sama, dan tiap proses melaporkan angka yang berbeda sehingga tidak ada
   * yang bisa dipercaya. Kosongkan kalau hanya ada satu proses.
   */
  lease?: SweepLease;
}

export interface RetentionJob {
  /** Jalankan satu sapuan; null kalau gagal, masih jalan, atau dilewati proses lain. */
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
  options: RetentionJobOptions & {
    ticketRunner?: TicketRetentionRunner;
    logRunner?: LogRetentionRunner;
    /** Kalau diisi, statistik playback ikut disapu pada siklus yang sama. */
    statsRunner?: StatsRetentionRunner;
  } = {},
): RetentionJob {
  const logger = getLogger();
  const ticketRunner = options.ticketRunner ?? getTicketService();
  const logRunner = options.logRunner ?? getLoggingService();
  const intervalMs = options.intervalMs ?? defaultIntervalMs();
  let running = false;

  const runOnce = async (now = new Date()): Promise<RetentionResult | null> => {
    if (running) {
      logger.debug('Sapuan retensi dilewati — sapuan sebelumnya masih jalan');
      return null;
    }

    // Sapuan retensi bersifat global, jadi hanya satu proses yang boleh
    // menjalankannya. Yang dilewati dicatat di debug, bukan diam: proses yang
    // melompat tetap harus bisa menjelaskan kenapa angkanya nol.
    if (options.lease?.available) {
      const claim = await options.lease.claim();
      if (claim === 'foreign') {
        logger.debug('Sapuan retensi dilewati — proses lain sedang memegangnya');
        return null;
      }
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

      // Tiket punya basis waktu sendiri (retensi dihitung sejak ditutup), jadi
      // sapuannya terpisah — tapi tetap di jadwal yang sama supaya tidak ada
      // cron kedua yang harus dipasang di host.
      try {
        const tickets = await ticketRunner.purgeExpired(now);
        if (tickets.ticketsDeleted > 0) {
          logger.info(
            { cutoff: tickets.cutoff.toISOString(), tickets: tickets.ticketsDeleted },
            'Retensi: tiket kedaluwarsa dihapus',
          );
        }
      } catch (error) {
        logger.warn({ err: error }, 'Retensi tiket gagal — kasus & peringatan tetap aman');
      }

      if (options.statsRunner) {
        try {
          const stats = await options.statsRunner.purgeExpired(now);
          if (stats.deleted > 0) {
            logger.info(
              { cutoff: stats.cutoff.toISOString(), deleted: stats.deleted },
              'Retensi: statistik playback lama dihapus',
            );
          }
        } catch (error) {
          logger.warn({ err: error }, 'Retensi statistik gagal — data lain tetap aman');
        }
      }
      try {
        const logs = await logRunner.purgeExpired(now);
        if (logs.logs > 0) {
          logger.info(
            { cutoff: logs.cutoff.toISOString(), logs: logs.logs },
            'Retensi: riwayat log kedaluwarsa dihapus',
          );
        }
      } catch (error) {
        logger.warn({ err: error }, 'Retensi log gagal — kasus & peringatan tetap aman');
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
