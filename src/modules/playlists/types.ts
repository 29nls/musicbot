/**
 * Playlist member (Fase 2, PRD §5.2 & §10).
 *
 * Satu playlist = satu baris dengan daftar lagu dalam JSON. Bentuk domainnya
 * sengaja tidak memakai bentuk TrackInfo penuh: yang disimpan hanya yang perlu
 * untuk menampilkan dan memutar ulang (judul, artis, sumber).
 */

/** Panjang maksimum nama playlist (juga batas kolom `name`). */
export const MAX_PLAYLIST_NAME_LENGTH = 60;

/**
 * Batas lagu per playlist.
 *
 * Playlist diputar lewat pemutar yang sama dengan antrean, jadi playlist yang
 * jauh lebih besar dari antrean hanya menghasilkan pemutaran yang tidak pernah
 * sampai habis — dan tetap menahan ruang di database.
 */
export const MAX_PLAYLIST_TRACKS = 100;

/** Jumlah playlist yang ditampilkan di `/playlist list`. */
export const PLAYLIST_LIST_LIMIT = 20;

/** Jumlah baris lagu yang ditampilkan di `/playlist show`. */
export const PLAYLIST_TRACK_PREVIEW = 10;

/**
 * Satu lagu tersimpan di playlist.
 *
 * `uri` adalah sumber kebenaran: `encoded` Lavalink bisa basi setelah node
 * restart atau ganti password, jadi pemutaran ulang selalu mencoba `uri` dulu
 * supaya playlist lama tetap bisa diputar tanpa disunting manual.
 */
export interface StoredTrack {
  title: string;
  author: string;
  /** Durasi ms; 0 untuk siaran langsung (durasi tidak diketahui). */
  durationMs: number;
  /** Alamat sumber (YouTube/SoundCloud); null kalau lagu tidak punya. */
  uri: string | null;
  /** Data base64 Lavalink; jumper cepat kalau `uri` tidak ada. */
  encoded: string | null;
}

/** Satu playlist seperti yang dilihat bot. */
export interface Playlist {
  id: number;
  guildId: string;
  ownerId: string;
  name: string;
  tracks: StoredTrack[];
  /** true = member lain di server ini boleh memutar playlist-nya. */
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePlaylistInput {
  guildId: string;
  ownerId: string;
  name: string;
}

/** Kenapa sebuah permintaan playlist tidak bisa dipenuhi. */
export type PlaylistFailure =
  | { kind: 'name-taken'; name: string }
  | { kind: 'name-invalid'; message: string }
  | { kind: 'not-found' }
  | { kind: 'empty' }
  | { kind: 'full'; limit: number }
  | { kind: 'out-of-range'; count: number }
  | { kind: 'not-owner' }
  | { kind: 'private' }
  | { kind: 'duplicate-track'; title: string };

export type PlaylistResult<T> = { ok: true; value: T } | { ok: false; error: PlaylistFailure };