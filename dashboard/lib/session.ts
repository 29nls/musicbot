import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Sesi dashboard: cookie terenkripsi, tanpa tabel baru.
 *
 * **Kenapa tanpa tabel.** PRD-DASHBOARD §4.4 menyatakan dashboard tidak
 * menambah tabel dan tidak mengubah `/privacy`, sementara D5 menulis sesi
 * disimpan sebagai baris di database. Dua pernyataan itu tidak bisa benar
 * bersama. Yang dipilih di sini yang pertama: cookie terenkripsi berisi id user,
 * token OAuth, dan waktu kedaluwarsa. Alasannya bukan hanya soal tabel —
 * pencabutan sesi server-side memang tidak dibutuhkan di sini, karena setiap
 * penulisan tetap memeriksa izin lewat token bot. Jadi sesi yang "masih ada"
 * tidak memberi kekuatan apa pun yang tidak diberikan ulang oleh pemeriksaan
 * itu.
 *
 * **Kenapa bukan JWT.** JWT ditandatangani tapi isinya terbaca; token OAuth
 * Discord tidak boleh ada di cookie yang bisa dibaca peramban atau ekstensi
 * mana pun. AES-256-GCM menyembunyikan isinya sekaligus memastikan keutuhannya
 * (tag autentikasi), dan itu dua hal yang dibutuhkan sekaligus di sini.
 *
 * Kunci diturunkan dari `DASHBOARD_SECRET` dengan SHA-256: secret boleh berupa
 * kalimat panjang, yang dibutuhkan hanya 32 byte acak yang stabil. Pemisahan
 * nama kunci (`namacookie` + versi) ikut diturunkan supaya kunci untuk cookie
 * yang berbeda tidak identik.
 */

export const SESSION_COOKIE = 'harmony_session';
const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface SessionPayload {
  /** User Discord yang menandatangani lewat OAuth. Ini `executor_id` di audit. */
  userId: string;
  /** Token OAuth user; dipakai membaca daftar server, tidak pernah ditulis ke log. */
  accessToken: string;
  /** Kedaluwarsa sesi (epoch ms). */
  expiresAt: number;
  /** Guild yang sedang dipilih; kosong berarti belum memilih. */
  selectedGuildId?: string;
}

export type UnsealResult =
  | { ok: true; payload: SessionPayload }
  | { ok: false; reason: 'kosong' | 'format' | 'rusak' | 'kedaluwarsa' };

function deriveKey(secret: string, label: string): Buffer {
  return createHash('sha256').update(`${label}:${secret}`).digest();
}

function isPayload(value: unknown): value is SessionPayload {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;

  return (
    typeof record.userId === 'string' &&
    /^\d{17,20}$/.test(record.userId) &&
    typeof record.accessToken === 'string' &&
    record.accessToken.length > 0 &&
    typeof record.expiresAt === 'number' &&
    Number.isFinite(record.expiresAt) &&
    (record.selectedGuildId === undefined ||
      (typeof record.selectedGuildId === 'string' && /^\d{17,20}$/.test(record.selectedGuildId)))
  );
}

/** Bungkus payload jadi token cookie. */
export function sealSession(payload: SessionPayload, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret, SESSION_COOKIE), iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify({ v: VERSION, ...payload }), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, body]).toString('base64url');
}

/**
 * Baca token cookie.
 *
 * Semua kegagalan dijawab objek, bukan exception: cookie yang rusak (atau
 * sengaja dibuat rusak) adalah masukan biasa bagi route yang harus menjawab
 * "sesi berakhir", bukan 500.
 */
export function unsealSession(token: string | undefined | null, secret: string, now = Date.now()): UnsealResult {
  if (!token) return { ok: false, reason: 'kosong' };

  let raw: Buffer;
  try {
    raw = Buffer.from(token, 'base64url');
  } catch {
    return { ok: false, reason: 'format' };
  }

  if (raw.length <= IV_BYTES + TAG_BYTES) return { ok: false, reason: 'format' };

  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const body = raw.subarray(IV_BYTES + TAG_BYTES);

  let parsed: unknown;
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret, SESSION_COOKIE), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    parsed = JSON.parse(plain);
  } catch {
    return { ok: false, reason: 'rusak' };
  }

  if (typeof parsed !== 'object' || parsed === null) return { ok: false, reason: 'format' };

  const { v, ...payload } = parsed as Record<string, unknown>;
  if (v !== VERSION) return { ok: false, reason: 'format' };
  if (!isPayload(payload)) return { ok: false, reason: 'format' };
  if (payload.expiresAt <= now) return { ok: false, reason: 'kedaluwarsa' };

  return { ok: true, payload: payload as SessionPayload };
}

/** Opsi cookie sesi. Dipakai route, dan diuji supaya tidak ada yang longgar. */
export function sessionCookieOptions(expiresAt: number, secure: boolean) {
  return {
    httpOnly: true,
    // `secure` hanya saat HTTPS: di localhost http, cookie `secure` tidak akan
    // pernah dikirim dan login tampak gagal tanpa sebab.
    secure,
    sameSite: 'lax' as const,
    path: '/',
    expires: new Date(expiresAt),
  };
}

/** Umur sesi mengikuti masa berlaku token Discord (7 hari), bukan lebih. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
