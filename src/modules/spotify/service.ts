import { getLogger } from '../../services/logger.js';
import { toSpotifyMeta, type SpotifyResult, type SpotifyTrackMeta } from './types.js';

/**
 * Pengambilan metadata dari Spotify Web API.
 *
 * Yang diambil **hanya metadata**. Audio tetap dicari di Lavalink, jadi bot ini
 * tidak butuh langganan premium maupun plugin berbayar — dan itu dinyatakan
 * terbuka di README, bukan diklaim sebagai "dukungan Spotify penuh".
 *
 * Transport HTTP di-inject supaya seluruh alur bisa diuji tanpa internet.
 */

export const DEFAULT_SPOTIFY_API_URL = 'https://api.spotify.com/v1';
export const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const SPOTIFY_TIMEOUT_MS = 8_000;

/** Dipakai 50 menit; token client-credentials berlaku ~1 jam. */
export const SPOTIFY_TOKEN_TTL_MS = 50 * 60 * 1_000;

const SAFETY_MS = 60_000;

export interface SpotifyHttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export interface SpotifyHttpResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

export type SpotifyTransport = (request: SpotifyHttpRequest) => Promise<SpotifyHttpResponse>;

export interface SpotifyServiceOptions {
  clientId: string;
  clientSecret: string;
  apiBaseUrl?: string;
  tokenUrl?: string;
  timeoutMs?: number;
  transport?: SpotifyTransport;
  now?: () => number;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

/** Transport bawaan (global fetch + batas waktu). */
export const fetchSpotify: SpotifyTransport = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(request.timeoutMs),
  });

  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('json')
    ? ((await response.json()) as unknown)
    : ((await response.text()) as unknown);

  return { ok: response.ok, status: response.status, body };
};

export class SpotifyMetadataService {
  private readonly apiBaseUrl: string;
  private readonly tokenUrl: string;
  private readonly timeoutMs: number;
  private readonly transport: SpotifyTransport;
  private readonly now: () => number;
  private token: CachedToken | undefined;

  constructor(private readonly options: SpotifyServiceOptions) {
    this.apiBaseUrl = (options.apiBaseUrl ?? DEFAULT_SPOTIFY_API_URL).replace(/\/+$/, '');
    this.tokenUrl = options.tokenUrl ?? SPOTIFY_TOKEN_URL;
    this.timeoutMs = options.timeoutMs ?? SPOTIFY_TIMEOUT_MS;
    this.transport = options.transport ?? fetchSpotify;
    this.now = options.now ?? (() => Date.now());
  }

  /** true kalau kredensial ada di `.env`. */
  get isConfigured(): boolean {
    return this.options.clientId.trim().length > 0 && this.options.clientSecret.trim().length > 0;
  }

  /** Metadata satu lagu. */
  async getTrack(id: string): Promise<SpotifyResult> {
    if (!this.isConfigured) return { kind: 'not-configured' };

    const token = await this.accessToken();
    if (!token) {
      return {
        kind: 'error',
        message:
          'Spotify menolak kredensial bot (401). Periksa `SPOTIFY_CLIENT_ID` & `SPOTIFY_CLIENT_SECRET` di .env.',
      };
    }

    const response = await this.send({
      method: 'GET',
      url: `${this.apiBaseUrl}/tracks/${encodeURIComponent(id)}`,
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response) {
      return { kind: 'error', message: 'Spotify tidak bisa dihubungi. Coba lagi nanti.' };
    }

    if (response.status === 404) {
      return {
        kind: 'not-found',
        message: 'Lagu itu tidak ada (atau tidak tersedia di wilayah server Spotify).',
      };
    }

    if (response.status === 429) {
      return {
        kind: 'error',
        message: 'Spotify membatasi permintaan (rate limit). Coba lagi beberapa menit lagi.',
      };
    }

    if (!response.ok) {
      return { kind: 'error', message: `Spotify menjawab ${response.status}.` };
    }

    const meta = mapTrack(response.body);
    if (!meta) {
      return { kind: 'error', message: 'Respons Spotify tidak bisa dibaca (bentuk tidak dikenal).' };
    }

    return { kind: 'found', track: meta };
  }

  /** Buang token yang di-cache (mis. setelah kredensial diubah). */
  clearTokenCache(): void {
    this.token = undefined;
  }

  private async accessToken(): Promise<string | null> {
    const cached = this.token;
    if (cached && cached.expiresAt > this.now()) return cached.value;

    const basic = Buffer.from(
      `${this.options.clientId}:${this.options.clientSecret}`,
      'utf8',
    ).toString('base64');

    const response = await this.send({
      method: 'POST',
      url: this.tokenUrl,
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!response || !response.ok) {
      getLogger().warn(
        { status: response?.status ?? 'no-response' },
        'Gagal mengambil access token Spotify',
      );
      return null;
    }

    const value = readToken(response.body);
    if (!value) return null;

    const expiresIn = readNumber(response.body, 'expires_in');
    const ttl = expiresIn > 0 ? Math.min(expiresIn * 1_000, SPOTIFY_TOKEN_TTL_MS) : SPOTIFY_TOKEN_TTL_MS;
    this.token = { value, expiresAt: this.now() + Math.max(0, ttl - SAFETY_MS) };

    return value;
  }

  private async send(
    request: Omit<SpotifyHttpRequest, 'timeoutMs'>,
  ): Promise<SpotifyHttpResponse | null> {
    try {
      return await this.transport({ ...request, timeoutMs: this.timeoutMs });
    } catch (error) {
      getLogger().warn({ err: error, url: request.url }, 'Permintaan Spotify gagal');
      return null;
    }
  }
}

/** Bentuk `/v1/tracks/{id}` → domain; null kalau bentuknya tak dikenal. */
export function mapTrack(body: unknown): SpotifyTrackMeta | null {
  if (!body || typeof body !== 'object') return null;

  const record = body as Record<string, unknown>;
  const id = record.id;
  const name = record.name;
  if (typeof id !== 'string' || typeof name !== 'string') return null;

  const album = (record.album ?? {}) as Record<string, unknown>;
  const artists = Array.isArray(record.artists)
    ? record.artists
        .map((artist) => (artist as Record<string, unknown>)?.name)
        .filter((value): value is string => typeof value === 'string')
    : [];

  const images = Array.isArray(album.images) ? album.images : [];
  const best = [...images]
    .filter((image): image is Record<string, unknown> => Boolean(image) && typeof image === 'object')
    .sort((left, right) => Number(right.width ?? 0) - Number(left.width ?? 0))[0];

  return toSpotifyMeta({
    id,
    title: name,
    artists,
    album: typeof album.name === 'string' ? album.name : '',
    imageUrl: typeof best?.url === 'string' ? best.url : null,
    durationMs: typeof record.duration_ms === 'number' ? record.duration_ms : 0,
    isExplicit: record.explicit === true,
  });
}

function readToken(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>).access_token;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(body: unknown, key: string): number {
  if (!body || typeof body !== 'object') return 0;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}