import type { LyricLine } from './types.js';

/**
 * Parser LRC + pemilih baris aktif. Semua fungsi di sini murni.
 *
 * Format LRC: satu baris boleh punya beberapa tag waktu di depan teksnya,
 * contoh `[00:12.34][01:20.00] chorus pertama`.
 */

/** Tag metadata (bukan lirik): `[ar: ...]`, `[ti: ...]`, `[offset: -300]`. */
const METADATA_PATTERN = /^\[(ar|al|ti|by|re|ve|length|offset|tool|la|lang|au)[:]/i;

/** Satu tag waktu di awal baris: `[mm:ss]`, `[mm:ss.xx]`, `[mm:ss.xxx]`. */
const TIMESTAMP_PATTERN = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** Deretan tag waktu di awal baris LRC. */
const LEADING_TAGS_PATTERN = /^((?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+)(.*)$/;

/** Baris lirik yang terlalu panjang di-potong supaya embed tidak meledak. */
const MAX_LINE_LENGTH = 300;

export interface LrcParseResult {
  lines: LyricLine[];
  /** Offset dari tag `[offset: ...]` dalam ms; bisa negatif. */
  offsetMs: number;
}

/**
 * Ubah satu tag waktu LRC jadi ms.
 *
 * Pecahan desimal dibaca sebagai pecahan detik: `[00:12.5]` = 12,5 detik,
 * `[00:12.50]` = 12,5 detik juga, `[00:12.500]` = 12,5 detik.
 * Mengembalikan null kalau tag itu bukan timestamp yang valid.
 */
export function parseLrcTimestamp(token: string): number | null {
  const match = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]$/.exec(token.trim());
  if (!match) return null;

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const fraction = match[3];

  // "5" -> 500ms, "50" -> 500ms, "500" -> 500ms, "5050" -> 505ms.
  const fractionMs = fraction ? Number(`${fraction}000`.slice(0, 3)) : 0;
  const total = minutes * 60_000 + seconds * 1_000 + fractionMs;

  return Number.isFinite(total) ? total : null;
}

/** Buang semua tag waktu yang nyasar di tengah teks (lirik polos vs LRC). */
export function stripLrcTags(line: string): string {
  return line.replace(TIMESTAMP_PATTERN, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Baca teks LRC jadi daftar baris lirik terurut.
 *
 * Toleran: tag metadata diabaikan, baris tanpa tag waktu dilewati, baris teks
 * kosong juga dilewati, dan waktu negatif akibat `[offset:]` dijepit ke 0.
 */
export function parseLrc(input: string): LrcParseResult {
  const raw = input.replace(/\r\n?/g, '\n');
  const offsetMatch = /^\[offset:\s*([+-]?\d+)\s*\]\s*$/im.exec(raw);
  const offsetMs = offsetMatch?.[1] ? Number(offsetMatch[1]) : 0;

  const lines: LyricLine[] = [];

  for (const rawLine of raw.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed || METADATA_PATTERN.test(trimmed)) continue;

    const leading = LEADING_TAGS_PATTERN.exec(trimmed);
    if (!leading) continue;

    const text = clip(leading[2]?.trim() ?? '');
    if (!text) continue;

    for (const token of leading[1]?.match(TIMESTAMP_PATTERN) ?? []) {
      const timeMs = parseLrcTimestamp(token);
      if (timeMs === null) continue;
      lines.push({ timeMs: Math.max(0, timeMs + offsetMs), text });
    }
  }

  lines.sort((a, b) => a.timeMs - b.timeMs);
  return { lines, offsetMs };
}

/**
 * Baca teks polos (lirik tanpa waktu) menjadi daftar baris.
 * Dipakai untuk `plainLyrics` LRCLIB dan hasil scraping Genius.
 */
export function parsePlainLyrics(input: string): string[] {
  return input
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => clip(stripLrcTags(line)))
    .filter((line) => line.length > 0);
}

/**
 * Indeks baris yang aktif pada posisi tertentu, atau -1 kalau belum ada.
 * Pencarian biner karena `lines` selalu terurut naik.
 */
export function findActiveLineIndex(lines: readonly LyricLine[], positionMs: number): number {
  if (lines.length === 0 || !Number.isFinite(positionMs) || positionMs < 0) return -1;

  let low = 0;
  let high = lines.length - 1;
  let found = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const line = lines[middle];
    if (!line) break;
    if (line.timeMs <= positionMs) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return found;
}

/** Baris lirik yang sedang dibaca, atau null kalau belum ada. */
export function activeLineAt(lines: readonly LyricLine[], positionMs: number): LyricLine | null {
  const index = findActiveLineIndex(lines, positionMs);
  return index >= 0 ? (lines[index] ?? null) : null;
}

export interface LyricWindowEntry {
  line: LyricLine;
  /** true kalau baris ini yang sedang dibaca pada posisi yang diminta. */
  active: boolean;
}

export interface LyricWindowOptions {
  /** Berapa baris sebelum baris aktif yang ditampilkan. */
  before?: number;
  /** Berapa baris setelah baris aktif yang ditampilkan. */
  after?: number;
}

/**
 * Potongan lirik yang bisa dibaca: beberapa baris sebelum, baris aktif, lalu
 * beberapa baris sesudahnya. Kalau posisi belum mencapai baris pertama, yang
 * ditampilkan adalah awal lirik supaya tetap ada isi.
 */
export function selectLyricWindow(
  lines: readonly LyricLine[],
  positionMs: number,
  options: LyricWindowOptions = {},
): LyricWindowEntry[] {
  const before = options.before ?? 3;
  const after = options.after ?? 4;
  const size = before + after + 1;
  if (size <= 0 || lines.length === 0) return [];

  const activeIndex = findActiveLineIndex(lines, positionMs);
  const start = activeIndex < 0 ? 0 : Math.max(0, Math.min(activeIndex - before, lines.length - size));

  return lines
    .slice(Math.max(0, start), Math.max(0, start) + size)
    .map((line, index) => ({ line, active: Math.max(0, start) + index === activeIndex }));
}

/** Ubah ms ke "m:ss" untuk penanda waktu di embed (bukan "1 jam 2 menit"). */
export function formatTimecode(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';

  const totalSeconds = Math.floor(ms / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');

  return `${minutes}:${pad(seconds)}`;
}

function clip(text: string): string {
  return text.length > MAX_LINE_LENGTH ? `${text.slice(0, MAX_LINE_LENGTH - 1)}…` : text;
}