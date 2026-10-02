import { getLogger } from '../../services/logger.js';
import { parseLrc, parsePlainLyrics } from './lrc.js';
import {
  buildLyricsQuery,
  extractGeniusLyrics,
  firstNonEmpty,
  pickBestCandidate,
  type LyricsCandidate,
} from './query.js';
import type { LyricsDocument, LyricsQuery, LyricsResult, LyricsSource } from './types.js';

/** Endpoint LRCLIB (gratis, tanpa API key). */
export const DEFAULT_LYRICS_BASE_URL = 'https://lrclib.net/api';

/** Endpoint resmi Genius — hanya dipakai kalau token dikonfigurasi. */
export const GENIUS_API_BASE_URL = 'https://api.genius.com';

/** LRCLIB menolak request tanpa User-Agent yang jelas. */
export const LYRICS_USER_AGENT = 'HarmonyDiscordBot/1.0 (bot Discord Harmoni)';

export const LYRICS_TIMEOUT_MS = 8_000;
export const LYRICS_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
export const LYRICS_MISS_TTL_MS = 15 * 60 * 1_000;
export const LYRICS_CACHE_LIMIT = 250;

const LYRICS_ERROR_MESSAGE =
  'Sumber lirik sedang tidak bisa dihubungi. Coba lagi beberapa saat lagi.';

const NOT_FOUND_MESSAGE =
  'Lirik untuk lagu ini belum ada di sumber yang dipakai. Coba cek judulnya, atau pakai `/lyrics <judul>`.';

/** Bentuk respons HTTP yang dipakai modul ini — sengaja sempit supaya mudah di-fake saat tes. */
export interface LyricsHttpRequest {
  headers: Record<string, string>;
  timeoutMs: number;
}

export interface LyricsHttpResponse {
  ok: boolean;
  status: number;
  /** JSON untuk API, teks untuk halaman HTML Genius. */
  body: unknown;
}

export type LyricsHttpGet = (
  url: string,
  request: LyricsHttpRequest,
) => Promise<LyricsHttpResponse>;

/** Implementasi HTTP bawaan (global fetch + batas waktu). */
export const fetchLyricsResource: LyricsHttpGet = async (url, request) => {
  const response = await fetch(url, {
    headers: request.headers,
    signal: AbortSignal.timeout(request.timeoutMs),
  });

  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('json')
    ? ((await response.json()) as unknown)
    : ((await response.text()) as unknown);

  return { ok: response.ok, status: response.status, body };
};

/** Hasil satu percobaan ke sumber lirik. */
type Attempt =
  | { kind: 'document'; document: LyricsDocument }
  | { kind: 'miss' }
  | { kind: 'error' };

export interface LyricsServiceOptions {
  baseUrl?: string;
  /** Token Genius opsional. Kosong = LRCLIB saja (cukup untuk 99% lagu). */
  geniusToken?: string | undefined;
  timeoutMs?: number;
  cacheTtlMs?: number;
  httpGet?: LyricsHttpGet;
  now?: () => number;
}

interface CacheEntry {
  result: LyricsResult;
  expiresAt: number;
}

/**
 * Ambil lirik dari LRCLIB, dengan Genius sebagai cadangan opsional.
 *
 * Semua akses jaringan lewat `httpGet` yang di-inject, jadi seluruh alur bisa
 * diuji dengan fake tanpa menyentuh internet. Hasil (termasuk "tidak ada
 * lirik") disimpan sebentar supaya user tidak mengetuk API berulang.
 */
export class LyricsService {
  private readonly baseUrl: string;
  private readonly geniusToken: string | undefined;
  private readonly httpGet: LyricsHttpGet;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: LyricsServiceOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_LYRICS_BASE_URL).replace(/\/+$/, '');
    this.geniusToken = options.geniusToken?.trim() || undefined;
    this.httpGet = options.httpGet ?? fetchLyricsResource;
    this.now = options.now ?? (() => Date.now());
    this.timeoutMs = options.timeoutMs ?? LYRICS_TIMEOUT_MS;
    this.cacheTtlMs = options.cacheTtlMs ?? LYRICS_CACHE_TTL_MS;
  }

  /** true kalau cadangan Genius aktif (token ada di konfigurasi). */
  get hasGeniusFallback(): boolean {
    return this.geniusToken !== undefined;
  }

  /** Jumlah entri cache yang sedang aktif (dipakai tes & diagnostik). */
  get cacheSize(): number {
    return this.cache.size;
  }

  /** Cari lirik; cache dicek dulu supaya request berulang tidak memanggil API. */
  async lookup(query: LyricsQuery): Promise<LyricsResult> {
    const key = cacheKey(query);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.result;

    let result = await this.fromLrclib(query);

    if (result.kind !== 'found' && this.geniusToken) {
      const fallback = await this.fromGenius(query);
      if (fallback.kind === 'document') result = { kind: 'found', document: fallback.document };
    }

    this.remember(key, result);
    return result;
  }

  /** Buang cache (dipakai tes dan saat bot berhenti). */
  clearCache(): void {
    this.cache.clear();
  }

  private async fromLrclib(query: LyricsQuery): Promise<LyricsResult> {
    const { trackName, artistName } = buildLyricsQuery(query);
    if (!trackName) return { kind: 'not-found', message: NOT_FOUND_MESSAGE };

    const attempts: Attempt[] = [];

    if (artistName) {
      const direct = await this.lrclibGetByName(trackName, artistName, query.durationMs);
      // Pencarian langsung hampir selalu jadi: jangan waste satu request lagi
      // ke /search kalau liriknya sudah ketemu.
      if (direct.kind === 'document') return { kind: 'found', document: direct.document };
      attempts.push(direct);
    }

    attempts.push(await this.lrclibSearch(trackName, artistName, query.durationMs));

    return settle(attempts);
  }

  /** `GET /get?artist_name=&track_name=&duration=` — jalur tercepat. */
  private async lrclibGetByName(
    trackName: string,
    artistName: string,
    durationMs: number,
  ): Promise<Attempt> {
    const params = new URLSearchParams({ artist_name: artistName, track_name: trackName });
    if (durationMs > 0) params.set('duration', String(Math.round(durationMs / 1_000)));

    const response = await this.request(`${this.baseUrl}/get?${params.toString()}`, {
      'User-Agent': LYRICS_USER_AGENT,
    });
    if (!response) return { kind: 'error' };
    if (!response.ok) return statusToAttempt(response.status);

    const document = toDocument(response.body, trackName, artistName);
    return document ? { kind: 'document', document } : { kind: 'miss' };
  }

  /** `GET /search?...` lalu ambil detail kandidat terbaik lewat `GET /get/{id}`. */
  private async lrclibSearch(
    trackName: string,
    artistName: string,
    durationMs: number,
  ): Promise<Attempt> {
    const params = new URLSearchParams();
    if (artistName) {
      params.set('artist_name', artistName);
      params.set('track_name', trackName);
    } else {
      params.set('q', `${trackName} ${artistName}`.trim());
    }

    const response = await this.request(`${this.baseUrl}/search?${params.toString()}`, {
      'User-Agent': LYRICS_USER_AGENT,
    });
    if (!response) return { kind: 'error' };
    if (!response.ok) return statusToAttempt(response.status);

    const items = Array.isArray(response.body) ? (response.body as LyricsCandidate[]) : [];
    const best = pickBestCandidate(items, durationMs);
    if (!best) return { kind: 'miss' };

    const inline = toDocument(best, best.trackName ?? trackName, best.artistName ?? artistName);
    if (inline) return { kind: 'document', document: inline };

    if (typeof best.id !== 'number') return { kind: 'miss' };

    const detail = await this.request(`${this.baseUrl}/get/${best.id}`, {
      'User-Agent': LYRICS_USER_AGENT,
    });
    if (!detail) return { kind: 'error' };
    if (!detail.ok) return statusToAttempt(detail.status);

    const document = toDocument(detail.body, best.trackName ?? trackName, best.artistName ?? artistName);
    return document ? { kind: 'document', document } : { kind: 'miss' };
  }

  /** Cadangan Genius: cari lagu, ambil URL halamannya, lalu baca teks liriknya. */
  private async fromGenius(query: LyricsQuery): Promise<Attempt> {
    const token = this.geniusToken;
    if (!token) return { kind: 'miss' };

    const { trackName, artistName } = buildLyricsQuery(query);
    const term = `${trackName} ${artistName}`.trim();
    if (!term) return { kind: 'miss' };

    const search = await this.request(
      `${GENIUS_API_BASE_URL}/search?${new URLSearchParams({ q: term }).toString()}`,
      geniusHeaders(token),
    );
    if (!search) return { kind: 'error' };
    if (!search.ok) return statusToAttempt(search.status);

    const songId = firstSongId(search.body);
    if (songId === null) return { kind: 'miss' };

    const song = await this.request(
      `${GENIUS_API_BASE_URL}/songs/${songId}`,
      geniusHeaders(token),
    );
    if (!song) return { kind: 'error' };
    if (!song.ok) return statusToAttempt(song.status);

    const pageUrl = readString(song.body, 'response', 'song', 'url');
    if (!pageUrl) return { kind: 'miss' };

    const page = await this.request(pageUrl, {
      'User-Agent': LYRICS_USER_AGENT,
      Accept: 'text/html',
    });
    if (!page) return { kind: 'error' };
    if (!page.ok) return statusToAttempt(page.status);

    const lines = extractGeniusLyrics(typeof page.body === 'string' ? page.body : '');
    if (lines.length === 0) return { kind: 'miss' };

    return {
      kind: 'document',
      document: {
        lines: lines.map((text) => ({ timeMs: 0, text })),
        synced: false,
        source: 'genius',
        trackName,
        artistName,
      },
    };
  }

  private async request(
    url: string,
    headers: Record<string, string>,
  ): Promise<LyricsHttpResponse | null> {
    try {
      return await this.httpGet(url, { headers, timeoutMs: this.timeoutMs });
    } catch (error) {
      getLogger().warn({ err: error, url }, 'Gagal menghubungi sumber lirik');
      return null;
    }
  }

  private remember(key: string, result: LyricsResult): void {
    const ttl =
      result.kind === 'found'
        ? this.cacheTtlMs
        : Math.min(this.cacheTtlMs, LYRICS_MISS_TTL_MS);

    // Map mempertahankan urutan: hapus yang paling lama dulu saat penuh.
    if (this.cache.size >= LYRICS_CACHE_LIMIT) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }

    this.cache.delete(key);
    this.cache.set(key, { result, expiresAt: this.now() + ttl });
  }
}

/** Status >= 500 dianggap kegagalan sumber, 404 hanya "tidak ada lirik". */
function statusToAttempt(status: number): Attempt {
  return status >= 500 ? { kind: 'error' } : { kind: 'miss' };
}

function settle(attempts: readonly Attempt[]): LyricsResult {
  for (const attempt of attempts) {
    if (attempt.kind === 'document') return { kind: 'found', document: attempt.document };
  }
  if (attempts.some((attempt) => attempt.kind === 'error')) {
    return { kind: 'error', message: LYRICS_ERROR_MESSAGE };
  }
  return { kind: 'not-found', message: NOT_FOUND_MESSAGE };
}

/** Ubah respons LRCLIB menjadi dokumen lirik, atau null kalau tidak ada lirik. */
export function toDocument(
  candidate: unknown,
  trackName: string,
  artistName: string,
): LyricsDocument | null {
  if (!candidate || typeof candidate !== 'object') return null;

  const source = candidate as LyricsCandidate;
  const syncedText = firstNonEmpty(source.syncedLyrics);
  const plainText = firstNonEmpty(source.plainLyrics);

  const finish = (
    lines: LyricsDocument['lines'],
    synced: boolean,
    lyricsSource: LyricsSource,
  ): LyricsDocument => ({
    lines,
    synced,
    source: lyricsSource,
    trackName: firstNonEmpty(source.trackName) ?? trackName,
    artistName: firstNonEmpty(source.artistName) ?? artistName,
  });

  if (syncedText) {
    const { lines } = parseLrc(syncedText);
    if (lines.length > 0) return finish(lines, true, 'lrclib-synced');
  }

  if (plainText) {
    const lines = parsePlainLyrics(plainText);
    if (lines.length > 0) return finish(lines.map((text) => ({ timeMs: 0, text })), false, 'lrclib-plain');
  }

  return null;
}

/** Kunci cache: judul + artis sudah dibersihkan, jadi stabilize dengan lowercase. */
export function cacheKey(query: LyricsQuery): string {
  const { trackName, artistName } = buildLyricsQuery(query);
  return `${artistName.toLowerCase()}|${trackName.toLowerCase()}`;
}

/** Ambil ID lagu pertama dari respons pencarian Genius. */
function firstSongId(body: unknown): number | null {
  const hits = readPath(body, 'response', 'hits');
  if (!Array.isArray(hits)) return null;

  for (const hit of hits) {
    const id = readNumber(hit, 'result', 'id');
    if (id !== null) return id;
  }

  return null;
}

function geniusHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'User-Agent': LYRICS_USER_AGENT,
  };
}

/** Ambil nilai di dalam objek berdasarkan jalur kunci, atau null. */
function readPath(body: unknown, ...path: string[]): unknown {
  let current: unknown = body;

  for (const key of path) {
    if (!current || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[key];
  }

  return current ?? null;
}

function readString(body: unknown, ...path: string[]): string | null {
  const value = readPath(body, ...path);
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readNumber(body: unknown, ...path: string[]): number | null {
  const value = readPath(body, ...path);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}