import type { FilterMode } from './filters.js';
import type { LoopMode } from './loop.js';

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
  /** Mode loop yang sedang aktif; selalu ada, default `off`. */
  loopMode: LoopMode;
  /** Filter audio yang sedang aktif; selalu ada, default `off`. */
  filterMode: FilterMode;
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
/**
 * Metadata Spotify yang ikut dibawa ke embed hasil `/play`.
 *
 * Bentuknya inline (bukan tipe dari modul Spotify) supaya modul musik tidak
 * bergantung pada modul Spotify: yang dibutuhkan perintah hanya beberapa
 * field untuk ditampilkan, dan ketergantungan satu arah lebih mudah dijaga
 * daripada dua modul yang saling mengimpor.
 */
export interface SpotifySourceInfo {
  title: string;
  artists: string[];
  album: string;
  imageUrl: string | null;
  url: string;
  /** Judul lagu pada sumber audio yang benar-benar diputar. */
  sourceTitle: string;
  sourceUri: string | null;
  /** Penjelasan jujur kenapa kandidat itu yang dipilih. */
  matchNote: string;
}

export type PlayOutcome =
  | { kind: 'unavailable' }
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
  | { kind: 'queue-full' }
  /** Semua lagu ditolak oleh batas §6.2 (tidak ada yang dimuat). */
  | { kind: 'rejected'; reason: 'too-long' | 'needs-control'; count: number }
  | {
      kind: 'added';
      tracks: TrackInfo[];
      started: boolean;
      /** Posisi di antrean setelah ditambahkan. */
      position: number;
      /** Jumlah lagu yang dipotong karena antrean penuh. */
      skipped: number;
      /** Lagu yang ditolak batas durasi 6 jam — berlaku untuk semua. */
      rejectedTooLong?: number;
      /** Lagu > 30 menit/live yang ditolak karena peminta bukan DJ. */
      rejectedNeedsControl?: number;
      /** Metadata Spotify kalau lagunya datang dari tautan Spotify. */
      spotify?: SpotifySourceInfo;
      playlistName?: string;
    };
