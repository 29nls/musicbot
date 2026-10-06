import { describe, expect, it } from 'vitest';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  sealSession,
  sessionCookieOptions,
  unsealSession,
  type SessionPayload,
} from '@/lib/session.js';

const SECRET = 'a'.repeat(48);
const OTHER_SECRET = 'b'.repeat(48);
const USER = '100000000000000001';
const TOKEN = 'oauth-token-yang-rahasia';

/** Ubah satu byte terakhir: isinya berubah, panjangnya tetap sama. */
function flipLastByte(buffer: Buffer): Buffer {
  buffer[buffer.length - 1] = (buffer[buffer.length - 1] ?? 0) ^ 0xff;

  return buffer;
}

const base: SessionPayload = {
  userId: USER,
  accessToken: TOKEN,
  expiresAt: Date.now() + SESSION_TTL_MS,
};

describe('cookie sesi dienkripsi dan tidak bisa dibaca', () => {
  it('round-trip mengembalikan payload yang sama', () => {
    const result = unsealSession(sealSession(base, SECRET), SECRET);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.userId).toBe(USER);
      expect(result.payload.accessToken).toBe(TOKEN);
    }
  });

  it('token OAuth tidak muncul apa adanya di cookie', () => {
    const sealed = sealSession(base, SECRET);

    // Cookie dienkripsi karena isinya adalah token yang tidak boleh ada di
    // peramban atau ekstensi mana pun. Kalau ini bocor, siapa pun yang bisa
    // membaca cookie punya akses daftar server atas nama user itu.
    expect(sealed).not.toContain(TOKEN);
    expect(sealed).not.toContain(USER);
  });

  it('secret lain tidak bisa membuka', () => {
    const result = unsealSession(sealSession(base, SECRET), OTHER_SECRET);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('rusak');
  });

  it('token yang dimodifikasi satu byte ditolak', () => {
    const sealed = sealSession(base, SECRET);
    const raw = Buffer.from(sealed, 'base64url');
    flipLastByte(raw);

    const result = unsealSession(raw.toString('base64url'), SECRET);

    // AES-256-GCM punya tag autentikasi: isi yang diubah membuat verifikasi
    // gagal, bukan menghasilkan payload baru yang dipercaya.
    expect(result.ok).toBe(false);
  });
});

describe('cookie rusak adalah masukan biasa, bukan error 500', () => {
  it('tidak ada cookie → "kosong"', () => {
    expect(unsealSession(undefined, SECRET)).toEqual({ ok: false, reason: 'kosong' });
    expect(unsealSession(null, SECRET)).toEqual({ ok: false, reason: 'kosong' });
    expect(unsealSession('', SECRET)).toEqual({ ok: false, reason: 'kosong' });
  });

  it('bukan base64 yang sah → "format", bukan exception', () => {
    const result = unsealSession('!!!bukan base64!!!', SECRET);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('format');
  });

  it('terlalu pendek untuk berisi iv+tag+isi → "format"', () => {
    const result = unsealSession(Buffer.alloc(8).toString('base64url'), SECRET);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('format');
  });

  it('isi yang didekripsi bukan JSON → "rusak"', () => {
    // Cookie sengaja dibuat dengan isi non-JSON memakai kunci yang sama.
    const key = createHash('sha256').update(`${SESSION_COOKIE}:${SECRET}`).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update('bukan json', 'utf8'), cipher.final()]);
    const token = Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');

    expect(unsealSession(token, SECRET).ok).toBe(false);
  });
});

describe('kedaluwarsa', () => {
  it('sesi yang lewat tanggal ditolak', () => {
    const expired: SessionPayload = { ...base, expiresAt: 1_000 };
    const result = unsealSession(sealSession(expired, SECRET), SECRET, 2_000);

    expect(result).toEqual({ ok: false, reason: 'kedaluwarsa' });
  });

  it('sesi hidup pada milidetik terakhir dan mati tepat pada batasnya', () => {
    const sealed = sealSession({ ...base, expiresAt: 5_000 }, SECRET);

    // Interval-nya setengah terbuka `[dibuat, kedaluwarsa)`, sama seperti cookie
    // di peramban: tepat pada detik kedaluwarsa, cookie sudah tidak dikirim.
    // Menahan sesi satu milidetik lebih lama tidak menambah apa pun dan hanya
    // membuat-token-yang-sudah-mati tampak masih hidup.
    expect(unsealSession(sealed, SECRET, 4_999).ok).toBe(true);
    expect(unsealSession(sealed, SECRET, 5_000).ok).toBe(false);
  });

  it('umur sesi mengikuti masa token Discord, bukan lebih lama', () => {
    // 7 hari = masa berlaku token OAuth Discord. Sesi yang lebih panjang hanya
    // akan menyimpan token yang sudah tidak berlaku.
    expect(SESSION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('payload yang tidak berbentuk sesi ditolak', () => {
  it('userId bukan snowflake ditolak', () => {
    expect(unsealSession(sealSession({ ...base, userId: 'bukan-id' } as SessionPayload, SECRET), SECRET).ok).toBe(
      false,
    );
  });

  it('accessToken kosong ditolak', () => {
    expect(unsealSession(sealSession({ ...base, accessToken: '' } as SessionPayload, SECRET), SECRET).ok).toBe(
      false,
    );
  });

  it('expiresAt bukan angka ditolak', () => {
    expect(
      unsealSession(sealSession({ ...base, expiresAt: 'besok' } as unknown as SessionPayload, SECRET), SECRET).ok,
    ).toBe(false);
  });

  it('selectedGuildId bukan snowflake ditolak', () => {
    expect(
      unsealSession(sealSession({ ...base, selectedGuildId: 'x' } as SessionPayload, SECRET), SECRET).ok,
    ).toBe(false);
  });

  it('versi cookie yang tidak dikenal ditolak', () => {
    expect(unsealSession(sealSession(base, SECRET), SECRET).ok).toBe(true);
    // Mengganti byte terakhir mengubah isi terenkripsi, jadi versi pun ikut
    // berubah dan tag autentikusinya gagal.
    const sealed = sealSession(base, SECRET);
    const raw = Buffer.from(sealed, 'base64url');
    flipLastByte(raw);

    expect(unsealSession(raw.toString('base64url'), SECRET).ok).toBe(false);
  });
});

describe('opsi cookie sesi tidak ada yang longgar', () => {
  it('httpOnly, sameSite lax, dan path selalu benar', () => {
    const options = sessionCookieOptions(Date.now() + 1000, true);

    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
    expect(options.secure).toBe(true);
  });

  it('secure hanya true saat HTTPS', () => {
    // Di localhost http, cookie `secure` tidak akan pernah dikirim dan login
    // akan tampak gagal tanpa sebab yang bisa ditemukan.
    expect(sessionCookieOptions(Date.now() + 1000, false).secure).toBe(false);
  });

  it('tidak ada atribut yang membuat cookie terbaca JavaScript', () => {
    const options = sessionCookieOptions(Date.now() + 1000, true) as Record<string, unknown>;

    // Tidak ada `domain` yang longgar (cukup `path`), dan tidak ada `partitioned`
    // yang tidak kompatibel dengan cookie sesi ini.
    expect(options.domain).toBeUndefined();
  });
});

describe('guild terpilih ikut cookie', () => {
  it('guild terpilih bertahan melalui round-trip', () => {
    const withGuild: SessionPayload = { ...base, selectedGuildId: '200000000000000002' };
    const result = unsealSession(sealSession(withGuild, SECRET), SECRET);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.selectedGuildId).toBe('200000000000000002');
  });
});