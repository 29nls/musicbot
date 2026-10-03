import { getLogger } from '../../services/logger.js';

/**
 * Job pengukur latensi Lavalink (PRD §11 "latensi Lavalink").
 *
 * Tanpa pengukuran, "Lavalink lambat" hanya bisa ditebak dari keluhan member.
 * Probe ini memanggil endpoint `/stats` yang murah — bukan mencari lagu, bukan
 * menyentuh player — lalu menyimpan angkanya di registry.
 *
 * Keamanannya sama seperti job retensi dan job 24/7 yang sudah ada:
 * - timer di-`unref()` sehingga tidak pernah menahan proses keluar;
 * - probe yang masih berjalan tidak diganggu probe berikutnya (Lavalink yang
 *   lambat tidak boleh menumpuk permintaan);
 * - kegagalan hanya jadi peringatan, dan bot tidak pernah gagal karena probe.
 */
export interface MetricsProbeOptions {
  /** Ukur latensi (ms); `null` berarti tidak ada node atau probe gagal. */
  measure: () => Promise<number | null>;
  /** Terima hasil probe (ms, atau null kalau gagal). */
  onSample: (latencyMs: number | null) => void;
  /** Jeda antar probe; default 30 detik. */
  intervalMs?: number;
  /** Jalankan sekali saat start (default true). */
  runOnStart?: boolean;
}

export interface MetricsProbe {
  /** Jalankan satu probe sekarang; tidak pernah melempar. */
  runOnce(): Promise<void>;
  /** Berhenti menjadwalkan (dipanggil saat shutdown). */
  stop(): void;
}

/** Jeda default: cukup untuk melihat latensi, terlalu sering hanya menambah beban. */
export const DEFAULT_PROBE_INTERVAL_MS = 30_000;

export function startMetricsProbe(options: MetricsProbeOptions): MetricsProbe {
  const logger = getLogger();
  const intervalMs = options.intervalMs ?? DEFAULT_PROBE_INTERVAL_MS;
  let running = false;

  const runOnce = async (): Promise<void> => {
    if (running) {
      logger.debug('Probe Lavalink dilewati — probe sebelumnya masih jalan');
      return;
    }

    running = true;
    try {
      const latencyMs = await options.measure();
      options.onSample(latencyMs);

      if (latencyMs === null) {
        logger.debug('Probe Lavalink gagal — node tidak menjawab');
      } else {
        logger.debug({ latencyMs }, 'Latensi Lavalink terukur');
      }
    } catch (error) {
      // Probe yang melempar diperlakukan sama dengan probe yang gagal: bot
      // harus tetap jalan, dan grafik tidak boleh ikut error.
      logger.debug({ err: error }, 'Probe Lavalink gagal dijalankan');
      options.onSample(null);
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
    timer.unref();
  }

  return {
    runOnce,
    stop(): void {
      if (timer) clearInterval(timer);
      logger.debug('Probe latensi Lavalink dihentikan');
    },
  };
}