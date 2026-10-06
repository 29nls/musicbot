import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  buildAuthorizeUrl,
  createCodeChallenge,
  createCodeVerifier,
  createState,
} from '@/lib/discord.js';
import { getEnv } from '@/lib/env.js';

/**
 * Awal alur OAuth: PKCE dan `state` disimpan di cookie, lalu pengarah ke Discord.
 *
 * **Untuk apa PKCE.** `code_verifier` adalah string acak yang dibuat di sini dan
 * hanya disimpan di cookie browser; `code_challenge` adalah hash-nya yang dikirim
 * ke Discord. Kode yang dicuri di tengah jalan tidak berguna tanpa verifier,
 * dan verifier tidak pernah menyentuh server lain selain callback di sini.
 *
 * **Untuk apa `state`.** Nilainya disimpan sebagai cookie lalu dibandingkan lagi di
 * callback. Tanpa itu, penyerang bisa membuat browser korban menyelesaikan alur
 * login dengan akunnya sendiri — login CSRF — dan korban akan mengira akunnya
 * sudah masuk ke dashboard.
 *
 * Cookie PKCE berumur pendek (10 menit) dan `sameSite=lax`: kodenya hanya layak
 * dipakai sekali, dan segera setelah diminta.
 */

const PKCE_COOKIE = 'harmony_oauth';
const PKCE_TTL_MS = 10 * 60 * 1000;

export async function GET(): Promise<NextResponse> {
  const env = getEnv();
  const verifier = createCodeVerifier();
  const state = createState();

  const store = await cookies();
  store.set(PKCE_COOKIE, JSON.stringify({ verifier, state }), {
    httpOnly: true,
    secure: env.DASHBOARD_URL.startsWith('https://'),
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: Math.floor(PKCE_TTL_MS / 1000),
  });

  const url = buildAuthorizeUrl({
    clientId: env.oauthClientId,
    redirectUri: env.oauthRedirectUri,
    state,
    codeChallenge: createCodeChallenge(verifier),
  });

  return NextResponse.redirect(url);
}