/** Satu lagu dalam bentuk yang dipakai bot (bukan bentuk mentah Lavalink). */
export interface TrackInfo {
  /** Data base64 dari Lavalink — ini yang dikirim balik saat memutar. */
  encoded: string;
  title: string;
  author: string;
  /** Durasi ms; 0 untuk siaran langsung. */
  durationMs: number;
  uri: string | null;
  artworkUrl: string | null;
  isStream: boolean;
  requesterId: string;
}

export interface QueueSnapshot {
  guildId: string;
  current: TrackInfo | null;
  upcoming: TrackInfo[];
  upcomingDurationMs: number;
  paused: boolean;
  positionMs: number;
  volume: number;
  /** Sisa waktu sebelum bot keluar otomatis (ms); null kalau tidak aktif. */
  idleRemainingMs: number | null;
}

/** Hasil pencarian ke Lavalink — sengaja tidak membocorkan tipe internal library. */
export type SearchOutcome =
  | { kind: 'tracks'; tracks: RawTrack[]; playlistName?: string }
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
  | { kind: 'unavailable' };

/** Bentuk track Lavalink yang dibutuhkan (subset dari `Track` shoukaku). */
export interface RawTrack {
  encoded: string;
  info: {
    title: string;
    author: string;
    length: number;
    isStream: boolean;
    uri?: string;
    artworkUrl?: string;
  };
}

/** Hasil `/play` yang siap dirender jadi embed. */
export type PlayOutcome =
  | { kind: 'unavailable' }
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
  | { kind: 'queue-full' }
  | {
      kind: 'added';
      tracks: TrackInfo[];
      started: boolean;
      /** Posisi di antrean setelah ditambahkan. */
      position: number;
      /** Jumlah lagu yang dipotong karena antrean penuh. */
      skipped: number;
      playlistName?: string;
    };
