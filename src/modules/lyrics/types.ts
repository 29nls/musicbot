/**
 * Tipe bersama untuk fitur lirik (PRD 5.2: "Lirik (via API Genius/LRCLIB)").
 *
 * Semua bentuk di sini murni dan tidak tahu apa pun soal Discord, HTTP, atau
 * Lavalink, supaya seluruh logika lirik bisa diuji tanpa jaringan.
 */

/** Sumber lirik yang dipakai untuk menjawab permintaan. */
export type LyricsSource = 'lrclib-synced' | 'lrclib-plain' | 'genius';

/** Satu baris lirik. `timeMs` selalu 0 untuk lirik tanpa timestamp. */
export interface LyricLine {
  /** Mulai baris ini dalam ms sejak lagu dimulai; 0 kalau lirik tidak sinkron. */
  timeMs: number;
  text: string;
}

/** Hasil akhir yang sudah rapi dan siap dirender jadi embed. */
export interface LyricsDocument {
  lines: LyricLine[];
  /** true kalau baris punya timestamp sehingga bisa menandai baris yang aktif. */
  synced: boolean;
  source: LyricsSource;
  trackName: string;
  artistName: string;
}

/** Permintaan lirik. Artis boleh kosong kalau user cuma mengetik judul. */
export interface LyricsQuery {
  title: string;
  /** Nama artis; string kosong = tidak diketahui. */
  artist: string;
  /** Durasi dalam ms; 0 = tidak diketahui (live stream). */
  durationMs: number;
}

export type LyricsResult =
  | { kind: 'found'; document: LyricsDocument }
  /** Sumber tidak punya lirik untuk lagu ini — bukan kegagalan sistem. */
  | { kind: 'not-found'; message: string }
  /** Jaringan / sumber sedang bermasalah. */
  | { kind: 'error'; message: string };