/**
 * Statistik playback agregat per server (Fase 3, PRD §5.3).
 *
 * Bentuk domain modul ini. Yang perlu dibaca lebih dulu sebelum memakai:
 * **tidak ada satu pun field yang menunjuk orang.** Bot ini tidak pernah
 * merekam siapa yang memutar apa (§12) — yang disimpan hanya "lagu ini
 * diputar N kali di server ini", per hari. Karena itu modul ini tidak punya
 * jalur `/privacy` atau `/data-delete`: tidak ada yang bisa disalin untuk
 * seseorang.
 */

/** Jenis yang dihitung. */
export const STAT_KINDS = ['track', 'command'] as const;

export type StatKind = (typeof STAT_KINDS)[number];

/** Satu baris agregat: satu item (lagu / perintah) pada satu hari. */
export interface StatEntry {
  guildId: string;
  kind: StatKind;
  /** Pengenal stabil: `uri` lagu (judul kalau tanpa uri), atau nama perintah. */
  key: string;
  /** Label yang tampil di leaderboard (judul lagu, atau `/nama`). */
  label: string;
  /** Hari UTC tanpa jam. */
  day: Date;
  /** Ber kali item ini diputar/dipakai pada hari itu. */
  count: number;
  /** Total milidetik yang benar-benar terdengar; 0 untuk `command`. */
  listenedMs: number;
}

/** Hasil penggabungan beberapa baris jadi satu baris per item. */
export interface StatTotal {
  key: string;
  label: string;
  count: number;
  listenedMs: number;
  /** Hari terakhir item ini tercatat. */
  lastDay: Date;
}

/** Satu titik grafik harian. Hari tanpa aktivitas tetap ikut, dengan 0. */
export interface StatDayPoint {
  day: Date;
  count: number;
  listenedMs: number;
}

/** Satu hari pada ringkasan. */
export interface StatDailyTotal {
  day: Date;
  count: number;
  listenedMs: number;
}

/** Ringkasan satu server untuk satu jenis statistik. */
export interface StatSummary {
  guildId: string;
  kind: StatKind;
  /** Rentang hari yang dipanggil (inklusif). */
  since: Date;
  until: Date;
  /** Total item di rentang itu, bukan hanya yang masuk leaderboard. */
  totalCount: number;
  totalListenedMs: number;
  /** Jumlah hari yang punya aktivitas, dan jumlah hari dalam rentang. */
  activeDays: number;
  days: number;
  /** Leaderboard: item paling banyak, sudah digabung per key. */
  top: StatTotal[];
  /** Deret harian, termasuk hari kosong (bernilai 0). */
  daily: StatDailyTotal[];
  /** Hari paling ramai. */
  peak: StatDailyTotal | null;
}

/** Batas yang dipakai perintah `/stats` dan normalisasi internal. */
export const STAT_MAX_DAYS = 90;
export const STAT_MIN_DAYS = 1;
export const STAT_DEFAULT_DAYS = 30;
export const STAT_TOP_LIMIT = 10;
export const MAX_STAT_KEY_LENGTH = 200;
export const MAX_STAT_LABEL_LENGTH = 200;
/** Panjang bar grafik maksimum, supaya embed tidak melebar di HP. */
export const STAT_BAR_WIDTH = 12;