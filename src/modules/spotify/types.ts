/**
 * Metadata Spotify (PRD §5.2 "Spotify metadata support").
 *
 * Bot **tidak** memutar audio dari Spotify: itu butuh Lavalink dengan plugin
 * berlisensi berbayar. Yang diambil dari Spotify hanyalah metadata
 * (judul, artis, album, cover, durasi) sebagai sumber kebenaran judul, lalu
 * audio dicari lagi lewat Lavalink. Sifat itu yang membuat fitur ini mungkin
 * tanpa kredensial premium apa pun.
 */

/** Metadata satu lagu dari Spotify Web API. */
export interface SpotifyTrackMeta {
  id: string;
  title: string;
  artists: string[];
  album: string;
  /** URL sampul (640px kalau tersedia). */
  imageUrl: string | null;
  /** Durasi ms. */
  durationMs: number;
  isExplicit: boolean;
  /** Link halaman Spotify — ditampilkan supaya sumbernya jelas. */
  url: string;
}

export interface CreateSpotifyMetaInput {
  id: string;
  title: string;
  artists: string[];
  album: string;
  imageUrl?: string | null;
  durationMs: number;
  isExplicit?: boolean;
}

export function toSpotifyMeta(input: CreateSpotifyMetaInput): SpotifyTrackMeta {
  return {
    id: input.id,
    title: input.title.trim(),
    artists: input.artists.map((artist) => artist.trim()).filter((artist) => artist.length > 0),
    album: input.album.trim(),
    imageUrl: input.imageUrl ?? null,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    isExplicit: input.isExplicit ?? false,
    url: `https://open.spotify.com/track/${input.id}`,
  };
}

export type SpotifyResult =
  | { kind: 'found'; track: SpotifyTrackMeta }
  | { kind: 'not-found'; message: string }
  /** Kredensial belum diisi di `.env` — fitur dimatikan, bukan gagal. */
  | { kind: 'not-configured' }
  | { kind: 'error'; message: string };