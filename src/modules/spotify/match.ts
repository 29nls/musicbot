import type { TrackInfo } from '../music/index.js';
import type { SpotifyTrackMeta } from './types.js';

/**
 * Pencocokan metadata Spotify ke hasil pencarian Lavalink — murni.
 *
 * Ini bagian yang menentukan fitur ini dipercaya atau tidak: pencarian
 * "judul - artis" di YouTube hampir selalu mengembalikan cover, remix, live
 * version, dan reaksi. Tanpa pencocokan yang jujur, `/play <tautan spotify>`
 * akan sering memutar versi yang berbeda dari yang dipilih orang — dan itu
 * terlihat sebagai bot salah, bukan sebagai hasil pencarian.
 */

/** Selisih durasi yang masih dianggap lagu yang sama (±2 detik). */
export const DURATION_TOLERANCE_MS = 2_000;

/** Selisih yang masih diterima, tapi diberi catatan di embed (≤ 8 detik). */
export const DURATION_SOFT_LIMIT_MS = 8_000;

export interface MatchInput {
  meta: SpotifyTrackMeta;
  candidates: readonly TrackInfo[];
}

/** Hasil pencocokan beserta alasan pilihannya (untuk ditampilkan). */
export interface SpotifyMatch {
  track: TrackInfo;
  /** Selisih durasi metadata vs audio; 0 = sama persis. */
  durationDiffMs: number;
  /** true kalau judul kandidat cocok persis setelah normalisasi. */
  exactTitle: boolean;
  /** Kandidat lain yang ada tapi tidak dipilih. */
  alternatives: number;
}

export function pickSpotifyMatch(input: MatchInput): SpotifyMatch | null {
  const { meta, candidates } = input;
  if (candidates.length === 0) return null;

  const artist = meta.artists[0] ?? '';
  const ranked = candidates
    .map((track) => ({ track, score: scoreCandidate(track, meta, artist) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) return null;

  return {
    track: best.track,
    durationDiffMs: Math.abs(best.track.durationMs - meta.durationMs),
    exactTitle: normalized(best.track.title) === normalized(meta.title),
    alternatives: candidates.length - 1,
  };
}

/**
 * Skor kandidat; negatif berarti kandidat dibuang.
 *
 * Dua ambang ditegakkan: judul harus cocok (minimal seluruhnya ada di judul
 * kandidat), dan durasi harus masuk toleransi keras. Tanpa dua hal itu,
 * "Indonesian live cover" bisa lolos hanya karena contains judul asli.
 */
function scoreCandidate(track: TrackInfo, meta: SpotifyTrackMeta, artist: string): number {
  const candidateTitle = normalized(track.title);
  const metaTitle = normalized(meta.title);

  if (!candidateTitle || !metaTitle) return -1;
  if (!candidateTitle.includes(metaTitle) && !metaTitle.includes(candidateTitle)) return -1;

  const candidateAuthor = normalized(track.author);
  const authorMatch =
    artist.length > 0 && candidateAuthor.length > 0 && candidateAuthor.includes(normalized(artist));

  const diff = Math.abs(track.durationMs - meta.durationMs);
  if (diff > DURATION_SOFT_LIMIT_MS) return -1;

  let score = 0;
  if (candidateTitle === metaTitle) score += 100;
  else score += 40;
  if (authorMatch) score += 60;
  // Durasi yang makin dekat nilainya makin besar — pemirsaan durasi adalah
  // petunjuk kuat bahwa ini rekaman yang sama.
  score += Math.max(0, 40 - Math.round(diff / 1_000));

  return score;
}

/** Lowercase + buang tanda baca & spasi berlebih supaya perbandingan adil. */
function normalized(text: string): string {
  return text
    .toLocaleLowerCase('id')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Ringkasan jujur untuk embed: kalau durasinya meleset, pengguna perlu tahu
 * bahwa yang berbunyi bukan rekaman yang persis sama.
 */
export function matchNote(match: SpotifyMatch): string {
  if (match.durationDiffMs === 0) {
    return match.exactTitle ? 'Judul & durasi cocok persis.' : 'Durasi cocok persis.';
  }

  const seconds = Math.round(match.durationDiffMs / 1_000);
  return `Durasi audio ${seconds} detik berbeda dari metadata Spotify.`;
}

/** Map kandidat untuk tes: menyederhanakan pembuatan TrackInfo. */
export function toMatchTrack(overrides: Partial<TrackInfo> & { title: string }): TrackInfo {
  return {
    encoded: 'data',
    author: 'Artis',
    durationMs: 200_000,
    uri: 'https://example.test/audio',
    artworkUrl: null,
    isStream: false,
    requesterId: '1',
    ...overrides,
  };
}