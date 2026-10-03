import type { Redis, RedisOptions } from 'ioredis';
import { getEnv } from '../config/env.js';
import { getLogger } from './logger.js';

/**
 * Store kunci-nilai bersama untuk state yang tidak boleh per proses.
 *
 * **Kenapa file ini ada.** Redis sejak awal ada di `docker-compose.yml` dan
 * `REDIS_URL` sejak awal jadi env yang *wajib* diisi — tapi tidak satu baris
 * kode pun memakainya. Jadi bot ini selama ini menuntut pengguna menyiapkan
 * infrastruktur yang tidak pernah disentuh, dan semua rate limit, search
 * session, serta cache hanya hidup di satu proses. Itu bukan detail
 * housekeeping: itulah yang membuat sharding (§5.3) belum boleh diaktifkan.
 *
 * **Prinsipnya: satu antarmuka, dua implementasi, dan tidak pernah diam
 * soal yang mana yang dipakai.** Kalau Redis mati, bot **tetap jalan** dengan
 * store memori dan menulis peringatan yang jelas di log — mati total hanya
 * karena cache tidak tersedia adalah keputusan yang lebih buruk daripada
 * berjalan tanpa rate limit lintas proses selama beberapa menit.
 */

/** Nilai yang disimpan selalu string; serialization diserahkan ke pemanggil. */
export interface SetOptions {
  /** Masa berlaku dalam milidetik. Tidak diisi = tidak kedaluwarsa. */
  ttlMs?: number;
}

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: SetOptions): Promise<void>;
  delete(key: string): Promise<void>;
  /**
   * Ambil nilai sekaligus menghapusnya (sekali pakai).
   *
   * Diperlukan oleh state yang harus benar-benar hanya bisa diklaim satu kali —
   * session select menu, misalnya: dua klik yang kebetulan sama-sama diproses
   * hanya boleh menghasilkan satu lagu, bukan dua.
   */
  take(key: string): Promise<string | null>;
  /**
   * Tambah satu dan kembalikan nilainya.
   *
   * `ttlMs` hanya dipasang kalau key-nya baru dibuat — kalau tidak, tiap
   * penekanan akan memperpanjang cooldown dan rate limit jadi tidak pernah
   * berhenti untuk pengguna yang aktif.
   */
  increment(key: string, options?: SetOptions): Promise<number>;
  /** Tutup koneksi (dipanggil saat shutdown). Aman dipanggil berulang. */
  close(): Promise<void>;
}

/** Batas entri untuk store memori; lihat catatan pruning di bawah. */
const MEMORY_MAX_ENTRIES = 10_000;

interface MemoryRecord {
  value: string;
  expiresAt: number | undefined;
}

/**
 * Store in-memory dengan TTL.
 *
 * Dipakai sebagai (1) fallback saat Redis tidak bisa dihubungi, dan (2)
 * implementasi yang selalu ada untuk tes. Peta dibatasi supaya bot yang
 * berjalan lama dengan cooldown dari ribuan user tidak menahan memori tanpa
 * batas; entri kedaluwarsa dibuang saat peta sudah penuh, bukan lewat interval,
 * supaya tidak ada timer yang harus tetap hidup.
 */
export class MemoryKeyValueStore implements KeyValueStore {
  private readonly records = new Map<string, MemoryRecord>();

  async get(key: string): Promise<string | null> {
    const record = this.records.get(key);

    if (!record) return null;
    if (isExpired(record)) {
      this.records.delete(key);
      return null;
    }

    return record.value;
  }

  async set(key: string, value: string, options: SetOptions = {}): Promise<void> {
    this.pruneIfNeeded();

    this.records.set(key, {
      value,
      expiresAt: ttlToExpiry(options.ttlMs),
    });
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }

  async take(key: string): Promise<string | null> {
    const record = this.records.get(key);
    this.records.delete(key);

    if (!record || isExpired(record)) return null;

    return record.value;
  }

  async increment(key: string, options: SetOptions = {}): Promise<number> {
    this.pruneIfNeeded();

    const current = this.records.get(key);
    const fresh = !current || isExpired(current);
    const base = fresh ? 0 : Number.parseInt(current.value, 10) || 0;
    const next = base + 1;

    this.records.set(key, {
      value: String(next),
      expiresAt: fresh ? ttlToExpiry(options.ttlMs) : current?.expiresAt,
    });

    return next;
  }

  async close(): Promise<void> {
    this.records.clear();
  }

  /** Jumlah entri yang masih ada — dipakai tes. */
  get size(): number {
    return this.records.size;
  }

  private pruneIfNeeded(): void {
    if (this.records.size < MEMORY_MAX_ENTRIES) return;

    for (const [key, record] of this.records) {
      if (isExpired(record)) this.records.delete(key);
    }

    // Masih penuh setelah membuang yang kedaluwarsa: buang yang paling tua
    // expired lebih dulu sudah tidak mungkin, jadi jatuhkan sebagian entri.
    // Rate limit yang hilang lebih baik daripada memori yang habis.
    if (this.records.size >= MEMORY_MAX_ENTRIES) {
      const overflow = this.records.size - MEMORY_MAX_ENTRIES + 1;
      let removed = 0;

      for (const key of this.records.keys()) {
        if (removed >= overflow) break;
        this.records.delete(key);
        removed += 1;
      }
    }
  }
}

/**
 * Subset ioredis yang dipakai store ini.
 *
 * Sengaja memakai interface sendiri (bukan tipe `Redis` langsung) supaya
 * seluruh perilaku store bisa diuji dengan klien palsu, dan supaya jelas perintah
 * apa saja yang benar-benar dibutuhkan kalau nanti implementasinya berubah.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'PX', ttlMs: number): Promise<unknown>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<number>;
  /** GETDEL atomik; opsional karena butuh Redis 6.2+. */
  getdel?(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  pttl(key: string): Promise<number>;
  quit(): Promise<unknown>;
  on(event: string, listener: (error: Error) => void): unknown;
}

/**
 * Store Redis.
 *
 * TTL selalu dikirim sebagai `PX` (milidetik) supaya tidak ada pembulatan
 * detik yang membuat rate limit 2 detik jadi 3 detik — error kecil seperti ini
 * yang paling sering membuat orang mengira rate limitnya tidak berlaku.
 */
export class RedisKeyValueStore implements KeyValueStore {
  constructor(private readonly client: RedisLike) {}

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, options: SetOptions = {}): Promise<void> {
    if (options.ttlMs && options.ttlMs > 0) {
      await this.client.set(key, value, 'PX', Math.max(1, Math.trunc(options.ttlMs)));
      return;
    }

    await this.client.set(key, value);
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  async take(key: string): Promise<string | null> {
    // GETDEL menghapus dan mengembalikan dalam satu perintah, jadi dua proses
    // yang berebut session yang sama tidak bisa sama-sama menang.
    if (this.client.getdel) return this.client.getdel(key);

    // Redis lama: dua perintah, jadi risikonya kembali ke select+del.
    const value = await this.client.get(key);
    if (value !== null) await this.client.del(key);

    return value;
  }

  async increment(key: string, options: SetOptions = {}): Promise<number> {
    const value = await this.client.incr(key);
    const ttlMs = options.ttlMs && options.ttlMs > 0 ? Math.trunc(options.ttlMs) : 0;

    // PTTL -1 = key ada tapi tanpa masa berlaku, -2 = key tidak ada. Kalau
    // key baru dibuat, masa berlaku baru ikut dipasang; kalau bukan, TTL yang
    // sudah ada dibiarkan supaya tidak diperpanjang setiap penekanan.
    if (ttlMs > 0) {
      const current = await this.client.pttl(key);
      if (current === -1) await this.client.set(key, String(value), 'PX', Math.max(1, ttlMs));
    }

    return value;
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

export interface KeyValueStoreHandle {
  store: KeyValueStore;
  driver: 'redis' | 'memory';
  /** Alasan jatuh ke memori, kalau ada. */
  warning?: string;
}

/** Opsi koneksi Redis: cepat gagal, lalu jatuh ke memori. */
const REDIS_OPTIONS: RedisOptions = {
  connectTimeout: 2_000,
  maxRetriesPerRequest: 1,
  // Bring up: coba sebentar, lalu menyerah supaya proses bisa lanjut.
  retryStrategy: (attempt: number) => (attempt > 2 ? null : 200),
  lazyConnect: true,
  enableOfflineQueue: false,
};

/**
 * Bangun store untuk proses ini: coba Redis, jatuh ke memori bila gagal.
 *
 * Kemunculan Redis **tidak pernah menggagalkan startup**. Yang dilakukan
 * kalau Redis tidak terjangkau: log peringatan yang menyebut konsekuensinya
 * (rate limit kembali per proses, sharding tetap belum aman), lalu jalankan
 * dengan store memori.
 */
export async function createKeyValueStore(): Promise<KeyValueStoreHandle> {
  const logger = getLogger();

  try {
    const module = await import('ioredis');
    // ioredis diekspor sebagai CommonJS; bentuk modul di Node bisa berupa
    // { default: { default: Ctor } } atau { default: Ctor }, jadi keduanya
    // diperiksa alih-alih menebak.
    const RedisCtor = module.default.default ?? module.default;
    const client = new RedisCtor(getEnv().REDIS_URL, REDIS_OPTIONS) as Redis;
    const store = new RedisKeyValueStore(client as unknown as RedisLike);

    await client.connect();
    await store.increment('harmony:kvstore:probe', { ttlMs: 60_000 });

    logger.info('Store kunci-nilai memakai Redis');
    return { store, driver: 'redis' };
  } catch (error) {
    const warning =
      'Redis tidak bisa dihubungi — memakai store memori. ' +
      'Rate limit kembali per proses dan sharding tetap belum aman sampai Redis hidup.';

    logger.warn({ err: error }, warning);

    return { store: new MemoryKeyValueStore(), driver: 'memory', warning };
  }
}

/**
 * Store yang dipakai modul lain (rate limit, cache perintah custom, dan seterusnya).
 *
 * Disimpan di modul ini supaya semuanya membaca **satu** store per proses. Kalau
 * cooldown memakai store A dan cache perintah memakai store B, klaim "berlaku lintas
 * proses kalau Redis hidup" jadi tidak benar begitu salah satu gagal dialling.
 *
 * Sebelum `setKeyValueStore()` dipanggil (mis. di tes), yang dipakai adalah store
 * memori, jadi modul yang mengimpor file ini tidak pernah gagal hanya karena
 * startup belum selesai.
 */
let current: KeyValueStore = new MemoryKeyValueStore();

export function setKeyValueStore(handle: KeyValueStoreHandle): void {
  current = handle.store;
  getLogger().debug({ driver: handle.driver }, 'Store kunci-nilai proses diganti');
}

export function getKeyValueStore(): KeyValueStore {
  return current;
}

function isExpired(record: MemoryRecord, now = Date.now()): boolean {
  return record.expiresAt !== undefined && record.expiresAt <= now;
}

function ttlToExpiry(ttlMs: number | undefined): number | undefined {
  if (!ttlMs || !Number.isFinite(ttlMs) || ttlMs <= 0) return undefined;

  return Date.now() + Math.max(1, Math.trunc(ttlMs));
}