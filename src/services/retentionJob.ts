import { getEnv } from '../config/env.js';
import { getLoggingService } from '../modules/logging/index.js';
import { getModerationService } from '../modules/moderation/index.js';
import type { RetentionResult } from '../modules/moderation/retention.js';
import { getStatsService } from '../modules/stats/index.js';
import { getTicketService } from '../modules/tickets/index.js';
import { getLogger } from './logger.js';
import {
  runRetentionSweeps,
  type LogSweepRunner,
  type ModerationSweepRunner,
  type StatsSweepRunner,
  type TicketSweepRunner,
} from './retentionSweeps.js';
import type { SweepLease } from './sweepLease.js';

/** Yang dibutuhkan job ini dari service moderasi (dipisah supaya bisa diuji). */
export type RetentionRunner = ModerationSweepRunner;

/** Sapuan retensi tiket — dijalankan setelah kasus, bukan menggantikannya. */
export type TicketRetentionRunner = TicketSweepRunner;

/**
 * Sapuan retensi statistik playback (Fase 3).
 *
 * Sama seperti tiket dan log, ini punya default berupa service sungguhan.
 * Dulu ia opsional sehingga bisa diam-diam dilewati; sekarang lewat
 * `runRetentionSweeps` keempat sapuan wajib ada, dan menguji job tinggal
 * menyuntik runner palsu untuk keempatnya.
 */
export type StatsRetentionRunner = StatsSweepRunner;

/**
 * Sapuan retensi riwayat log — dijalankan terakhir.
 *
 * Dipisah dari kasus karena retensinya jauh lebih pendek (30 hari vs 12 bulan)
 * dan volumenya jauh lebih besar, jadi mengalahkannya di jalur yang sama
 * berarti satu query lambat menahan penghapusan yang lain.
 */
export type LogRetentionRunner = LogSweepRunner;

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
    /**
     * Sapuan statistik playback. Ada default berupa service sungguhan, jadi
     * jalur ini tidak bisa diam-diam melewatkannya; opsinya hanya supaya tes
     * menyuntik runner palsu.
     */
    statsRunner?: StatsRetentionRunner;
  } = {},
): RetentionJob {
  const logger = getLogger();
  const ticketRunner = options.ticketRunner ?? getTicketService();
  const logRunner = options.logRunner ?? getLoggingService();
  const statsRunner = options.statsRunner ?? getStatsService();
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
      // Keempat sapuan ada di satu tempat supaya jalur ini dan skrip cron
      // tidak bisa berbeda isi. Urutan dan aturan isolasinya di sana.
      const summary = await runRetentionSweeps(
        {
          moderation: runner,
          tickets: ticketRunner,
          stats: statsRunner,
          logs: logRunner,
          logger,
        },
        now,
      );

      return summary.moderation;
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
