import type {
  InteractionCounters,
  InteractionKind,
  InteractionOutcome,
  MetricsSnapshot,
} from './types.js';

/**
 * Penghitung metrik untuk satu proses.
 *
 * Murni: tidak menyentuh Discord, database, maupun jaringan, jadi seluruh
 * perhitungan bisa diuji tanpa apa pun yang hidup. Jamnya di-inject supaya
 * uptime dan waktu sample bisa dikendalikan di tes.
 *
 * **Angkanya kumulatif sejak proses start, bukan jendela bergulir.** Alasannya
 * jujur: menghitung error rate per menit butuh riwayat atau penyapuan
 * berkala, dan penyapuan berkala justru tempat yang paling sering gagal
 * diam-diam — begitu proses mati, grafik kembali ke nol dan semua alarm ikut
 * hilang. Untuk target KPI §13 ("< 1%") yang dilihat mingguan, angka kumulatif
 * sejak start lebih jujur: satu proses yang hidup seminggu tidak bisa
 * "menghapus" kegagalannya dengan restart.
 */
export class MetricsRegistry {
  private readonly counters: Record<InteractionKind, { total: number; errors: number }> = {
    command: { total: 0, errors: 0 },
    component: { total: 0, errors: 0 },
    message: { total: 0, errors: 0 },
  };

  private tracksPlayed = 0;
  private lavalinkConnected = false;
  private lavalinkLatencyMs: number | null = null;
  private lavalinkSampledAt: number | null = null;

  private readonly startedAt: number;
  private readonly now: () => number;

  constructor(options: { startedAt?: number; now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
    this.startedAt = options.startedAt ?? this.now();
  }

  /** Catat satu interaksi yang selesai normal. */
  record(kind: InteractionKind, outcome: InteractionOutcome = 'ok'): void {
    const counter = this.counters[kind];
    counter.total += 1;
    if (outcome === 'error') counter.errors += 1;
  }

  /** Catat satu lagu yang selesai diputar. */
  recordTrackPlayed(): void {
    this.tracksPlayed += 1;
  }

  /**
   * Catat hasil probe Lavalink.
   *
   * Sample yang dipakai harus berupa angka: `NaN`, negatif, atau tak hingga
   * diabaikan supaya satu pengukuran rusak tidak merusak seluruh grafik.
   * Kegagalan probe **tidak menghapus** latensi terakhir yang berhasil — ia
   * hanya menandai node sedang tidak terjangkau, karena "terakhir diketahui 12
   * detik lalu" jauh lebih berguna daripada "tidak pernah".
   */
  recordLavalinkLatency(latencyMs: number): void {
    if (!Number.isFinite(latencyMs) || latencyMs < 0) return;

    this.lavalinkConnected = true;
    this.lavalinkLatencyMs = latencyMs;
    this.lavalinkSampledAt = this.now();
  }

  /** Tandai node Lavalink sedang tidak bisa dihubungi. */
  recordLavalinkUnreachable(): void {
    this.lavalinkConnected = false;
  }

  /** Ambil semua angka saat ini. */
  snapshot(): MetricsSnapshot {
    const interactions = {
      command: view(this.counters.command),
      component: view(this.counters.component),
      message: view(this.counters.message),
    };

    return {
      uptimeSeconds: Math.max(0, Math.floor((this.now() - this.startedAt) / 1_000)),
      tracksPlayed: this.tracksPlayed,
      interactions,
      commandErrorRate: interactions.command.errorRate,
      lavalink: {
        connected: this.lavalinkConnected,
        latencyMs: this.lavalinkLatencyMs,
        sampledAt: this.lavalinkSampledAt,
      },
    };
  }
}

function view(counter: { total: number; errors: number }): InteractionCounters {
  return {
    total: counter.total,
    errors: counter.errors,
    errorRate: counter.total === 0 ? 0 : counter.errors / counter.total,
  };
}