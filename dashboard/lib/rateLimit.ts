import type { KeyValueStore } from '@bot/services/kvStore.js';

/**
 * Pembatas laju penulisan dashboard.
 *
 * **Kenapa butuh.** Bot sendiri dibatasi Discord, jadi satu akun tidak bisa
 * membanjiri bot. Dashboard tidak punya batasan itu: token bot yang dipakai
 * server-side tidak pernah menyentuh rate limit Discord per-user, jadi satu
 * tab yang salah menulis bisa mengarang hundreds of penulisan ke `guild_config`
 * dan membanjiri `log_entry` dengan entri audit palsu. Yang dilindungi di sini
 * adalah database dan ketenangan riwayat, bukan hanya server.
 *
 * **Mengapa lewat `KeyValueStore` dan bukan penghitung in-process.** Rate limit
 * harus bertahan melewati restart dan harus berlaku lintas proses: kalau
 * instance Next.js berikutnya punya penghitung sendiri, batasnya jadi "per
 * instance", dan instance yang lain tidak ikut membatasi.
 *
 * **Jendela bergeser atau tetap?** Tetap (*fixed window*). Alasannya jujur:
 * jendela bergeser bisa membolehkan dua kali batas pada detik terakhir jendela,
 * tapi implementasinya jauh lebih banyak baris dan butuh kunci tambahan. 30 per
 * menit dengan jendela tetap 60 detik sudah memotong serangan otomatis 100 per
 * detik menjadi 30 per menit, dan untuk orang yang memakai dashboard manusia,
 * 30 per menit adalah batas yang tidak akan pernah terkena kecuali memang
 * sengaja.
 *
 * **Redis mati = tidak ada rate limit.** `increment` yang gagal di sini
 * mengembalikan `null`/lempar, dan pemanggil harus **menolak menulis**, bukan
 * menerima. Batasnya sama dengan keputusan D3: kalau kanal bersama tidak hidup,
 * dashboard tidak bisa menjamin apa-apa, jadi ia menutup pintu, bukan membuka
 * pintu dengan mematikan alarm.
 */

/** Batas penulisan per jendela, per guild, per user. */
export const WRITE_LIMIT = 30;
/** Panjang jendela dalam milidetik. */
export const WRITE_WINDOW_MS = 60_000;

export interface RateLimitResult {
  allowed: boolean;
  /** Sisa kuota setelah percobaan ini. */
  remaining: number;
  /** Detik sampai jendela berikutnya bergeser; 0 saat tidak dibatasi. */
  retryAfterSeconds: number;
}

function keyFor(guildId: string, userId: string): string {
  return `dash:rl:w:${guildId}:${userId}`;
}

/**
 * Catat satu percobaan penulisan lalu putuskan boleh atau tidak.
 *
 * `increment` dengan TTL membuat jendela secara otomatis: kunci baru punya
 * `ttlMs`, dan increment berikutnya tidak memperpanjangnya (lihat kontrak
 * `KeyValueStore.increment`), jadi jendela benar-benar tetap meski traffic
 * berlanjut.
 *
 * Melempar bila Redis tidak terjangkau, jadi pemanggil tidak bisa keliru
 * memperlakukannya sebagai "boleh": `applyConfigPatch` menangkapnya dan menjawab
 * `shared-store-down`. Tidak ada jalur di mana kegagalan diam-diam berarti "tidak
 * dibatasi".
 */
export async function checkWriteRateLimit(
  store: KeyValueStore,
  guildId: string,
  userId: string,
  limit = WRITE_LIMIT,
  windowMs = WRITE_WINDOW_MS,
): Promise<RateLimitResult> {
  const key = keyFor(guildId, userId);
  const count = await store.increment(key, { ttlMs: windowMs });

  if (count > limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }

  return {
    allowed: true,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: 0,
  };
}

/** Hapus penghitung; dipakai saat logout dan di tes. */
export async function clearWriteRateLimit(
  store: KeyValueStore,
  guildId: string,
  userId: string,
): Promise<void> {
  await store.delete(keyFor(guildId, userId));
}