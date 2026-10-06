import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { exchangeCode, getCurrentUser } from '@/lib/discord.js';
import { getEnv } from '@/lib/env.js';
import { writeSession } from '@/lib/sessionRoute.js';

/**
 * Callback OAuth: tukar kode jadi token, cek siapa yang masuk, simpan sesi.
 *
 * Tiga pemeriksaan, berurutan dari yang paling murah:
 *
 * 1. **`state` cocok dengan cookie.** Yang dibandingkan adalah cookie PKCE yang
 *    dibuat di route login; `state` dari query string saja tidak cukup, karena
 *    penyerang boleh mengarangnya. Perbandingan memakai `timingSafeEqual` supaya
 *    lamanya tidak membocorkan karakter yang cocok.
 * 2. **PKCE masih ada.** Kalau cookie hilang (browser menutup cookie, atau
 *    logout di tengah jalan), kode tidak bisa ditukar dan lebih baik gagal
 *    dengan pesan jelas daripada mencoba tanpa verifier.
 * 3. **`/users/@me` menjawab.** Tanpa ini, sesi akan menyimpan token yang belum
 *    pernah dipakai, dan kegagalan baru akan muncul di daftar server — jauh dari
 *    penyebabnya.
 *
 * **Semua kegagalan mengarahkan ke `/` dengan alasan di query string**, bukan
 * Exception. Halaman depan yang menampilkan sebabnya, jadi peramban tidak pernah
 * melihat halaman error mentah dari provider.
 */

const PKCE_COOKIE = 'harmony_oauth';

interface PkceCookie {
  verifier?: unknown;
  state?: unknown;
}

function sameValue(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

function fail(reason: string): NextResponse {
  return NextResponse.redirect(new URL(`/?error=${reason}`, getEnv().DASHBOARD_URL));
}

export async function GET(request: Request): Promise<NextResponse> {
  const env = getEnv();
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) return fail('invalid_request');

  const store = await cookies();
  const raw = store.get(PKCE_COOKIE)?.value;
  store.delete(PKCE_COOKIE);

  if (!raw) return fail('no_pkce');

  let pkce: PkceCookie;
  try {
    pkce = JSON.parse(raw) as PkceCookie;
  } catch {
    return fail('no_pkce');
  }

  if (typeof pkce.state !== 'string' || typeof pkce.verifier !== 'string') return fail('no_pkce');
  if (!sameValue(state, pkce.state)) return fail('bad_state');

  let accessToken: string;
  try {
    const token = await exchangeCode({
      clientId: env.oauthClientId,
      clientSecret: env.OAUTH_CLIENT_SECRET,
      redirectUri: env.oauthRedirectUri,
      code,
      codeVerifier: pkce.verifier,
    });
    accessToken = token.access_token;
  } catch {
    return fail('token_failed');
  }

  const user = await getCurrentUser(accessToken);
  if (!user) return fail('token_failed');

  await writeSession({ userId: user.id, accessToken });

  return NextResponse.redirect(new URL('/servers', env.DASHBOARD_URL));
}