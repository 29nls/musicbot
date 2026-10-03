/**
 * Metrik proses (PRD §11 "Observability").
 *
 * PRD §11 menyebut empat angka yang harus bisa dilihat: jumlah guild, lagu
 * diputar, error rate, dan latensi Lavalink. Jumlah guild sudah ada di health
 * check; tiga sisanya hidup di modul ini.
 *
 * Bentuk modulnya sengaja terpisah dari health check: laporan kesehatan
 * menjawab "apakah bot masih layak dilayani", sedangkan metrik menjawab "apakah
 * kebetulan jadi lambat atau sering gagal". Dua pertanyaan berbeda,
 * dua tempat berbeda, satu sumber angka.
 */

/** Permukaan interaksi yang dihitung terpisah. */
export type InteractionKind = 'command' | 'component' | 'message';

/** Hasil satu interaksi: selesai tanpa error, atau berakhir dengan error. */
export type InteractionOutcome = 'ok' | 'error';

export interface InteractionCounters {
  /**
   * Interaksi yang benar-benar dijalankan.
   *
   * Dihitung **setelah** gerbang izin dan cooldown lolos, jadi yang terhitung
   * adalah pekerjaan yang benar-benar dikerjakan — bukan klik yang ditolak
   * sebelum menyentuh apa pun.
   */
  total: number;
  /** Interaksi yang berakhir dengan error dan tercatat di log bot. */
  errors: number;
  /** `errors / total`, rentang 0 sampai 1. Nol kalau belum ada interaksi. */
  errorRate: number;
}

export interface LavalinkMetrics {
  /** Hasil sample terakhir: ada node yang menjawab atau tidak. */
  connected: boolean;
  /** Latensi terakhir yang berhasil diukur (ms); null kalau belum pernah. */
  latencyMs: number | null;
  /** Kapan latensi itu diukur (ms epoch); null kalau belum pernah. */
  sampledAt: number | null;
}

export interface MetricsSnapshot {
  /** Berapa lama proses ini hidup (detik). */
  uptimeSeconds: number;
  /** Lagu yang selesai diputar, termasuk yang di-skip karena pindah lagu. */
  tracksPlayed: number;
  /** Penghitung per permukaan interaksi. */
  interactions: Record<InteractionKind, InteractionCounters>;
  /** KPI §13 "error rate perintah": hanya perintah, bukan komponen/pesan. */
  commandErrorRate: number;
  lavalink: LavalinkMetrics;
}