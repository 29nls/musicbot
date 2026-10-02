/**
 * Modul murni untuk menyiapkan queries lirik: membersihkan judul/artis dari
 * metadata lagu, memilih kandidat yang durasinya paling cocok, dan mengubah
 * HTML halaman Genius menjadi baris lirik.
 */

import type { LyricsQuery } from './types.js';

/**
 * Selisih durasi yang masih dianggap "lagu yang sama".
 * Durasi dari LRCLIB/genius dihitung dalam DETIK, jadi batasnya juga detik.
 */
export const DURATION_TOLERANCE_SECONDS = 4;

/** Potongan yang sering menempel di judul lagu dari YouTube/Spotify. */
const TITLE_NOISE = [
  /\bofficial\s*(music\s*)?video\b/gi,
  /\bofficial\s*(visual|audio|audio\s*visualizer)\b/gi,
  /\bmusic\s*video\b/gi,
  /\blyric\s*video\b/gi,
  /\b(lyrics?|lirik)\b/gi,
  /\b(visualizer|visualiser)\b/gi,
  /\b(remaster(ed)?|remastered\s*\d{4}|deluxe|explicit|clean)\b/gi,
  /\b(hd|hq|4k|mv|pt)\b/gi,
  /\(\s*\d{4}\s*\)/g,
  /\[\s*\d{4}\s*\]/g,
  /\[[^\]]*\]/g,
  /\(feat[^)]*\)/gi,
  /\bfeat\.?[^|]*$/gi,
];

/** Navigasi YouTube otomatis menambahkan " - Topic" dan "VEVO". */
const ARTIST_NOISE = [
  /\s*-\s*topic\s*$/i,
  /\s*vevo\s*$/i,
  /\s*official\s*$/i,
  /\s*-\s*official\s*$/i,
  /\s*records\s*$/i,
];

/** Bersihkan judul: buang "year", "(Official Video)", "[HD]", "feat. ...". */
export function cleanTrackTitle(title: string): string {
  let cleaned = toText(title).replace(/\s*\|\s*/g, ' - ');

  for (const pattern of TITLE_NOISE) {
    cleaned = cleaned.replace(pattern, ' ');
  }

  // Menghapus label sering meninggalkan kurung kosong, misalnya "Lagu (Official)".
  cleaned = normalizeSpaces(cleaned).replace(/\(\s*\)|\[\s*\]/g, ' ');

  return normalizeSpaces(cleaned).replace(/\s*-\s*$/, '');
}

/** Bersihkan nama artis: buang " - Topic", "VEVO", "Official". */
export function cleanArtistName(author: string): string {
  let cleaned = toText(author);

  for (const pattern of ARTIST_NOISE) {
    cleaned = cleaned.replace(pattern, ' ');
  }

  return normalizeSpaces(cleaned);
}

/** Ringkas query jadi bentuk yang dikirim ke LRCLIB / Genius. */
export function buildLyricsQuery(query: LyricsQuery): { trackName: string; artistName: string } {
  return {
    trackName: cleanTrackTitle(query.title),
    artistName: cleanArtistName(query.artist),
  };
}

/** Bentuk minimum kandidat dari LRCLIB atau Genius. */
export interface LyricsCandidate {
  id?: number;
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  duration?: number | null;
  instrumental?: boolean | null;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

/**
 * Pilih kandidat yang paling cocok dengan lagu yang diputar.
 *
 * Aturannya sederhana dan sengaja: buang yang instrumental (liriknya cuma
 * "[Instrumental]"), lalu pilih yang durasinya paling dekat dengan lagu kita.
 * Kalau durasi tidak diketahui, ambil kandidat pertama yang ada liriknya.
 */
export function pickBestCandidate<T extends LyricsCandidate>(
  items: readonly T[],
  durationMs: number,
): T | null {
  const usable = items.filter((item) => !item.instrumental);
  if (usable.length === 0) return null;

  const withLyrics = usable.filter((item) => hasLyrics(item));
  const pool = withLyrics.length > 0 ? withLyrics : usable;

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return pool[0] ?? null;
  }

  const durationSec = durationMs / 1_000;
  let best: T | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (const item of pool) {
    if (typeof item.duration !== 'number' || item.duration <= 0) continue;
    const delta = Math.abs(item.duration - durationSec);
    if (delta < bestDelta) {
      best = item;
      bestDelta = delta;
    }
  }

  if (best && bestDelta <= DURATION_TOLERANCE_SECONDS) return best;

  // Tidak ada yang cocok durasinya: lebih baik ambil kandidat pertama yang
  // punya lirik daripada membalas "tidak ditemukan".
  return best ?? pool[0] ?? null;
}

/** Kandidat dianggap punya lirik kalau minimal ada satu baris teks. */
export function hasLyrics(candidate: LyricsCandidate): boolean {
  return Boolean(firstNonEmpty(candidate.syncedLyrics) ?? firstNonEmpty(candidate.plainLyrics));
}

/** Ambil teks pertama yang bukan kosong dari beberapa kandidat. */
export function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return null;
}

/** Bagian HTML Genius yang berisi lirik (satu blok per bagian lagu). */
const GENIUS_CONTAINER_PATTERN =
  /<div[^>]*data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '...',
  mdash: '-',
  ndash: '-',
};

/** Ubah `&amp;` `&#x27;` `&#39;` jadi karakter aslinya. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

/**
 * Ambil lirik dari HTML halaman Genius.
 *
 * Halaman Genius menaruh lirik di `div[data-lyrics-container]`. Kita hanya
 * mengambil teksnya (tag diabaikan, `<br>` jadi baris baru), bukan mengurai
 * seluruh DOM, supaya tidak rapuh saat markup mereka berubah sedikit.
 */
export function extractGeniusLyrics(html: string): string[] {
  const lines: string[] = [];

  for (const match of html.matchAll(GENIUS_CONTAINER_PATTERN)) {
    const block = match[1] ?? '';
    const text = decodeEntities(
      block
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' '),
    );

    for (const line of text.split('\n')) {
      const cleaned = normalizeSpaces(line);
      if (cleaned) lines.push(cleaned);
    }
  }

  return lines;
}

function normalizeSpaces(text: string): string {
  return text.replace(/[\t\r\n]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

/** Judul dari sumber luar mungkin null/undefined — jaga agar tidak melempar. */
function toText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}