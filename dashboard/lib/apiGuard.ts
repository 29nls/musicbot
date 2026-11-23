import { getEnv } from './env.js';
import { getStore } from './serverDeps.js';
import type { SessionPayload } from './session.js';

/**
 * Penjaga bersama untuk route musik dan playlist.
 *
 * Semua route yang mengubah state memakai pemeriksaan yang sama: asal
 * permintaan, `guildId` dari session (bukan badan permintaan), dan rate limit
 * di store bersama. Menyalinnya ke setiap route berarti satu route yang lupa
 * satu pemeriksaan sudah cukup untuk membuka celah.
 */

const SNOWFLAKE = /^\d{17,20}$/;

/** Batas per menit; angka ini juga dipakai UI untuk menjelaskan penolakan. */
export const MUSIC_RATE_LIMIT = 40;
export const PLAYLIST_RATE_LIMIT = 30;
export const RATE_WINDOW_MS = 60_000;

/**
 * Asal sah untuk POST/PATCH/DELETE.
 *
 * Sama dengan route konfigurasi: `DASHBOARD_URL`, asal request itu sendiri, atau
 * host yang benar-benar dipakai peramban. `Origin` yang tidak ada diterima
 * karena cookie `sameSite=lax` tetap menjadi penjaganya.
 */
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;

  if (origin === getEnv().DASHBOARD_URL) return true;
  if (origin === new URL(request.url).origin) return true;

  const host = request.headers.get('host');
  if (!host) return false;

  try {
    const incoming = new URL(origin);
    return incoming.host === host && (incoming.protocol === 'http:' || incoming.protocol === 'https:');
  } catch {
    return false;
  }
}

/** `guildId` dari query atau session; `null` kalau bentuknya bukan snowflake. */
export function guildIdFrom(request: Request, session: SessionPayload): string | null {
  const value = new URL(request.url).searchParams.get('guildId') ?? session.selectedGuildId;

  return value && SNOWFLAKE.test(value) ? value : null;
}

export function isSnowflake(value: unknown): value is string {
  return typeof value === 'string' && SNOWFLAKE.test(value);
}

export type RateLimitVerdict =
  | { allowed: true }
  | { allowed: false; reason: 'rate-limited' | 'shared-store-down'; retryAfterSeconds?: number };

/** Catat satu percobaan; kegagalan store **bukan** izin untuk melanjutkan. */
export async function checkRateLimit(
  key: string,
  limit: number,
): Promise<RateLimitVerdict> {
  try {
    const count = await getStore().increment(key, { ttlMs: RATE_WINDOW_MS });
    if (count > limit) return { allowed: false, reason: 'rate-limited', retryAfterSeconds: 60 };

    return { allowed: true };
  } catch {
    return { allowed: false, reason: 'shared-store-down' };
  }
}
