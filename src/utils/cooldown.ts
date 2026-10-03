import { MemoryKeyValueStore, type KeyValueStore } from '../services/kvStore.js';
import { getLogger } from '../services/logger.js';

/**
 * Rate limit per user per perintah (§16).
 *
 * Dulu peta in-memory satu proses. Sekarang lewat `KeyValueStore`, jadi kalau
 * Redis hidup, cooldown ikut berlaku lintas proses — syarat kecil sebelum
 * sharding boleh dipertimbangkan. Bedanya sengaja tidak dramatis: kalau store
 * (Redis) sedang bermasalah, pemanggil **tidak ikut gagal**, dan cooldown
 * dihitung dari store memori cadangan supaya perlindungannya tetap ada.
 */

const PREFIX = 'harmony:cooldown:';

/** Cadangan: tetap berlaku kalau store utama sedang tidak bisa dihubungi. */
const fallback = new MemoryKeyValueStore();

let store: KeyValueStore = fallback;

/** Store yang dipakai modul ini; dipanggil startup setelah store dibuat. */
export function setCooldownStore(next: KeyValueStore): void {
  store = next;
}

/** Nama store aktif — dipakai tes dan log startup. */
export function cooldownStoreName(): string {
  return store === fallback ? 'memory' : 'shared';
}

/**
 * @returns 0 kalau boleh jalan, atau sisa detik tunggu kalau masih cooldown.
 */
export async function checkCooldown(key: string, seconds: number): Promise<number> {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;

  try {
    return await check(store, key, seconds);
  } catch (error) {
    // Store utama gagal. Ini bukan alasan perintah gagal: cooldown cadangan
    // dihitung dari memori supaya rate limit tetap ada, walau hanya berlaku
    // untuk proses ini saja.
    getLogger().warn({ err: error }, 'Store cooldown bermasalah — memakai penyimpanan memori');
    return check(fallback, key, seconds);
  }
}

async function check(target: KeyValueStore, key: string, seconds: number): Promise<number> {
  const fullKey = `${PREFIX}${key}`;
  const ttlMs = Math.max(1, Math.trunc(seconds * 1_000));

  const raw = await target.get(fullKey);
  if (raw !== null) {
    const expiresAt = Number(raw);
    const remaining = expiresAt - Date.now();
    if (Number.isFinite(remaining) && remaining > 0) {
      return Math.ceil(remaining / 1_000);
    }
  }

  // Yang disimpan adalah waktu berakhir mutlak (milidetik sejak epoch), bukan
  // sisa relatif. Alasannya: sisa relatif selalu melaporkan angka yang sama,
  // jadi orang yang ditolak diberi tahu "tunggu 5 detik" padahal tinggal 2,5
  // detik — dan itulah yang membuat rate limit terasa seperti bohong. TTL di
  // sisi store tetap dipasang supaya key hilang tepat saat jendela habis.
  // Ditulis hanya saat pemakaian berhasil: percobaan yang ditolak tidak boleh
  // menggeser jendela, kalau tidak orang yang menekan terus-menerus tidak akan
  // pernah keluar dari cooldown.
  // dan-itulah yang membuat orang merasa rate limitnya bohong. TTL di sisi store
  await target.set(fullKey, String(Date.now() + ttlMs), { ttlMs });

  return 0;
}

export async function resetCooldown(key: string): Promise<void> {
  const fullKey = `${PREFIX}${key}`;

  await Promise.allSettled([store.delete(fullKey), fallback.delete(fullKey)]);
}

/**
 * Jumlah bucket yang sedang disimpan.
 *
 * Dipakai tes untuk membuktikan store memori tidak tumbuh tanpa batas, dan
 * berguna kalau nanti ada perintah `/stats` yang ingin menampilkan beban rate
 * limit.
 */
export async function cooldownBucketCount(): Promise<number> {
  return fallback.size;
}