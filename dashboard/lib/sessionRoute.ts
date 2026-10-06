import { cookies } from 'next/headers';
import { getEnv } from './env.js';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  sealSession,
  sessionCookieOptions,
  unsealSession,
  type SessionPayload,
  type UnsealResult,
} from './session.js';

/**
 * Membaca dan menulis cookie sesi dari route handler dan server component.
 *
 * Wrapper tipis, dan itu disengaja: semua keputusan soal enkripsi, validasi
 * bentuk, dan kedaluwarsa ada di `session.ts` yang murni dan teruji. Yang ada di
 * sini hanya cara membungkusnya jadi `cookies()` dari Next.js.
 *
 * **`cookies()` di Next.js 15 itu async**, jadi harus di-`await`. Kalau tidak,
 * hasilnya adalah Promise dan setiap akses `.get` berikutnya gagal dengan pesan
 * yang tidak menyiratkan penyebabnya.
 */

function sessionKey(): { secret: string; secure: boolean } {
  const env = getEnv();

  return {
    secret: env.DASHBOARD_SECRET,
    // `secure` hanya saat URLnya HTTPS: di localhost http, cookie `secure`
    // tidak akan pernah dikirim dan login akan tampak gagal tanpa sebab.
    secure: env.DASHBOARD_URL.startsWith('https://'),
  };
}

/** Sesi sekarang, atau penjelasan kenapa tidak ada. */
export async function readSession(): Promise<UnsealResult> {
  const store = await cookies();
  const { secret } = sessionKey();

  return unsealSession(store.get(SESSION_COOKIE)?.value, secret);
}

/**
 * Sesi sekarang kalau masih ada; kalau tidak, sesi uji bila diizinkan.
 *
 * Sesi uji ada supaya dashboard bisa diperiksa dan dites tanpa kredensial Discord
 * sama sekali. `getEnv()` menolak menyalakannya di `NODE_ENV=production`, jadi
 * tidak ada jalur di mana satu variabel yang tertinggal di server produksi
 * membuka akses sebagai orang lain.
 */
export async function readSessionOrDev(): Promise<SessionPayload | null> {
  const result = await readSession();
  if (result.ok) return result.payload;

  const env = getEnv();
  if (env.devSessionEnabled && env.DEV_GUILD_ID) {
    return {
      userId: '100000000000000001',
      accessToken: 'dev-token',
      expiresAt: Date.now() + SESSION_TTL_MS,
      selectedGuildId: env.DEV_GUILD_ID,
    };
  }

  return null;
}

/** Tulis cookie sesi baru; mengembalikan waktu kedaluwarsanya. */
export async function writeSession(payload: Omit<SessionPayload, 'expiresAt'>): Promise<number> {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const { secret, secure } = sessionKey();
  const store = await cookies();

  store.set(
    SESSION_COOKIE,
    sealSession({ ...payload, expiresAt }, secret),
    sessionCookieOptions(expiresAt, secure),
  );

  return expiresAt;
}

/** Perbarui guild terpilih di dalam sesi yang sudah ada. */
export async function updateSessionGuild(guildId: string): Promise<boolean> {
  const current = await readSession();
  if (!current.ok) return false;

  await writeSession({
    userId: current.payload.userId,
    accessToken: current.payload.accessToken,
    selectedGuildId: guildId,
  });

  return true;
}

/** Hapus cookie sesi. */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}