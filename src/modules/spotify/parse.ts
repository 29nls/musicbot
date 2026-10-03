/**
 * Parser tautan Spotify (murni).
 *
 * Bentuk yang paling sering diketik orang:
 * - `https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc`
 * - `spotify:track:4cOdK2wGLETKBW3PvgPWqT`
 * - `https://spotify.link/...` (share link) — tidak bisa dipakai: hanya
 *   berisi id singkat yang harus ditukar lewat API, jadi ditolak dengan jelas.
 */

/** ID Spotify selalu 22 karakter base62. */
const SPOTIFY_ID_PATTERN = /^[A-Za-z0-9]{22}$/;

export type SpotifyLink =
  | { kind: 'track'; id: string }
  /** Playlist & album punya banyak lagu; di luar cakupan fitur ini. */
  | { kind: 'playlist'; id: string }
  | { kind: 'album'; id: string }
  /** Tautan bukan Spotify sama sekali — biarkan jalur Lavalink yang menangani. */
  | { kind: 'none' };

/**
 * Baca input user dan putuskan apakah itu tautan Spotify.
 *
 * Sengaja tidak melempar untuk input acak: `/play` harus tetap bisa menerima
 * judul biasa dan URL biasa, jadi "bukan Spotify" adalah jawaban normal.
 */
export function parseSpotifyLink(input: string): SpotifyLink {
  const raw = input.trim();
  if (raw.length === 0) return { kind: 'none' };

  // URI: spotify:track:<id>
  const uriMatch = /^spotify:(track|playlist|album):([A-Za-z0-9]+)$/i.exec(raw);
  if (uriMatch?.[1] && uriMatch[2]) {
    return toLink(uriMatch[1].toLowerCase(), uriMatch[2]);
  }

  // URL: https://open.spotify.com/<type>/<id>(?params)
  const urlMatch =
    /^(?:https?:\/\/)?(?:open\.|play\.)?spotify\.com\/(track|playlist|album)\/([A-Za-z0-9]+)/i.exec(raw);
  if (urlMatch?.[1] && urlMatch[2]) {
    return toLink(urlMatch[1].toLowerCase(), urlMatch[2]);
  }

  return { kind: 'none' };
}

function toLink(type: string, id: string): SpotifyLink {
  if (!SPOTIFY_ID_PATTERN.test(id)) return { kind: 'none' };

  if (type === 'track') return { kind: 'track', id };
  if (type === 'playlist') return { kind: 'playlist', id };
  return { kind: 'album', id };
}

/** Kalimat yang dipakai saat playlist/album ditemukan di /play. */
export function unsupportedLinkMessage(link: SpotifyLink): string {
  if (link.kind === 'playlist') {
    return (
      'Tautan playlist Spotify belum bisa dipakai di `/play` — playlist punya banyak lagu dan ' +
      'butuh alur pemuatan sendiri. Buka lagunya lewat Spotify lalu tempel tautan track-nya.'
    );
  }

  if (link.kind === 'album') {
    return (
      'Tautan album Spotify belum bisa dipakai di `/play`. Buka lagunya lewat Spotify lalu ' +
      'tempel tautan track-nya.'
    );
  }

  return 'Tautan itu bukan tautan track Spotify.';
}