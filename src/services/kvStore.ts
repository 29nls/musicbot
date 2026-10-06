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

/** Opsi untuk penulisan bersyarat. */
export interface CompareAndSetOptions extends SetOptions {
  /**
   * Nilai yang harus ada persis di store supaya penulisan berjalan.
   *
   * `null` berarti **key-nya harus belum ada**. Bagian itu bukan tambahan:
   * tanpa itu, "buat record baru" tetap balapan — dua proses bisa sama-sama
   * membaca key kosong lalu sama-sama menulis, dan yang kedua menimpa yang
   * pertama.
   *
   * Bandingannya lewat nilai utuh, bukan nomor versi, jadi store ini tidak
   * perlu tahu apa pun tentang isi yang disimpan.
   */
  expectedValue: string | null;
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
  /**
   * Tulis hanya kalau nilai saat ini persis sama dengan yang diharapkan.
   *
   * Mengembalikan true kalau penulisan terjadi, false kalau nilai di store
   * sudah berubah di antara pembacaan dan penulisan. Pemanggil yang benar
   * lalu membaca ulang dan mencoba lagi — itulah bedanya dengan penulisan
   * biasa yang diam-diam menimpa perubahan orang lain.
   *
   * **Opsional karena tidak semua lapisan bisa melakukannya.** Di Redis ini
   * satu skrip Lua; di store memori otomatis benar. Kalau tidak ada, pemanggil
   * harus tahu bahwa itu tidak dijamin dan tidak boleh mengarang jaminan.
   */
  compareAndSet?(key: string, value: string, options: CompareAndSetOptions): Promise<boolean>;
  /**
   * Terbitkan pesan ke kanal lintas proses.
   *
   * Opsional karena hanya store Redis yang bisa: store memori hidup di satu
   * proses, jadi tidak ada proses lain yang bisa diberi tahu. `false` berarti
   * store ini tidak mendukung — pemanggil tidak boleh menganggap pesannya
   * sudah sampai, dan itu keputusan yang harus diambil pemanggil, bukan
   * disembunyikan di sini.
   */
  publish?(channel: string, message: string): Promise<boolean>;
  /**
   * Berlangganan satu kanal; mengembalikan fungsi untuk berhenti.
   *
   * Koneksinya harus terpisah dari koneksi perintah (Redis menolak perintah
   * biasa di koneksi yang sedang berlangganan), jadi store tidak bisa
   * memakai kliennya sendiri. `subscriberFactory` yang menyediakannya.
   */
  subscribe?(channel: string, handler: (message: string) => void): Promise<() => Promise<void>>;
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

  /**
   * Store memori tidak bisa memberi tahu proses lain: selalu `false`.
   *
   * Sengaja tetap ada alih-alih dibiarkan undefined supaya pemanggil yang
   * memeriksa `typeof store.publish === 'function'` dan yang memanggilnya
   * mendapat jawaban yang sama.
   */
  async publish(_channel: string, _message: string): Promise<boolean> {
    return false;
  }

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

  async compareAndSet(key: string, value: string, options: CompareAndSetOptions): Promise<boolean> {
    const record = this.records.get(key);
    const current = record && !isExpired(record) ? record.value : null;
    const expected = options.expectedValue;

    if (expected === null ? current !== null : current !== expected) return false;

    this.pruneIfNeeded();
    this.records.set(key, { value, expiresAt: ttlToExpiry(options.ttlMs) });
    return true;
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
  /**
   * `EVAL` atomik; opsional karena butuh Redis 2.6+.
   *
   * Bentuk argumennya sengaja sama dengan ioredis
   * (`eval(script, jumlahKey, ...key, ...argumen)`) supaya tidak perlu
   * diterjemahkan ulang saat akhirnya bicara dengan Redis sungguhan.
   */
  eval?(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>;
  incr(key: string): Promise<number>;
  pttl(key: string): Promise<number>;
  quit(): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  /** PUBLISH; jumlah penerima yang menerima pesan. */
  publish?(channel: string, message: string): Promise<number>;
  /** SUBSCRIBE; hanya di koneksi khusus langganan. */
  subscribe?(channel: string): Promise<unknown>;
}

/**
 * Skrip Lua untuk penulisan bersyarat.
 *
 * `GET`, bandingkan, lalu `SET` dalam satu perintah: tidak ada jeda antara
 * membaca dan menulis, jadi tidak ada proses lain yang bisa menyisipkan di
 * tengahnya. Untuk Redis inilah satu-satunya cara membuat baca-ubah-tulis
 * benar-benar atomik — `WATCH`/`MULTI` butuh koneksi yang sama selama dua
 * perintah, dan `EVAL` tidak.
 */
const COMPARE_AND_SET_SCRIPT = [
  "local current = redis.call('GET', KEYS[1])",
  "if ARGV[4] == '1' then",
  "  if current then return 0 end",
  "elseif current ~= ARGV[1] then",
  "  return 0",
  "end",
  "if tonumber(ARGV[3]) > 0 then",
  "  redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])",
  "else",
  "  redis.call('SET', KEYS[1], ARGV[2])",
  "end",
  "return 1",
].join('\n');

/**
 * Store Redis.
 *
 * TTL selalu dikirim sebagai `PX` (milidetik) supaya tidak ada pembulatan
 * detik yang membuat rate limit 2 detik jadi 3 detik — error kecil seperti ini
 * yang paling sering membuat orang mengira rate limitnya tidak berlaku.
 */
export class RedisKeyValueStore implements KeyValueStore {
  constructor(
    private readonly client: RedisLike,
    private readonly options: RedisKeyValueStoreOptions = {},
  ) {}

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

  /**
   * Penulisan bersyarat lewat satu skrip Lua.
   *
   * Tanpa `EVAL` (Redis sangat lama, atau klien yang tidak menyediakannya),
   * jatuh ke baca-lalu-tulis biasa **dan hasilnya bukan jaminan**: nilainya
   * dikembalikan apa adanya supaya pemanggil tidak mengira ini atomik.
   */
  async compareAndSet(key: string, value: string, options: CompareAndSetOptions): Promise<boolean> {
    const ttlMs = options.ttlMs && options.ttlMs > 0 ? Math.trunc(options.ttlMs) : 0;

    if (!this.client.eval) {
      getLogger().warn(
        { key },
        'Client Redis tidak punya EVAL — penulisan bersyarat turun ke baca-lalu-tulis dan tidak atomik',
      );

      const current = await this.client.get(key);
      if (current !== options.expectedValue) return false;
      await this.set(key, value, { ttlMs: ttlMs > 0 ? ttlMs : undefined });
      return true;
    }

    const result = await this.client.eval(
      COMPARE_AND_SET_SCRIPT,
      1,
      key,
      options.expectedValue ?? '',
      value,
      String(ttlMs),
      options.expectedValue === null ? '1' : '0',
    );

    return Number(result) === 1;
  }

  /**
   * Terbitkan satu pesan. `false` kalau klien tidak punya PUBLISH.
   *
   * Jumlah penerima tidak dipakai sebagai bukti: nol penerima itu sah (bot
   * tidak jalan), sedangkan `false` berarti dashboard tidak bisa menjamin
   * apa pun dan harus menolak menulis.
   */
  async publish(channel: string, message: string): Promise<boolean> {
    if (!this.client.publish) return false;

    await this.client.publish(channel, message);
    return true;
  }

  /**
   * Berlangganan lewat koneksi terpisah.
   *
   * Fungsi berhenti menutup koneksi langganannya sendiri — kalau tidak,
   * ioredis yang ditinggal tetap memegang socket dan timer reconnect.
   */
  async subscribe(
    channel: string,
    handler: (message: string) => void,
  ): Promise<() => Promise<void>> {
    const factory = this.options.subscriberFactory;
    if (!factory) throw new Error('store ini tidak punya koneksi langganan');

    const subscriber = factory();
    subscriber.on('message', (...args: unknown[]) => {
      const [receivedChannel, receivedMessage] = args;
      if (receivedChannel !== channel) return;
      if (typeof receivedMessage !== 'string') return;
      handler(receivedMessage);
    });

    if (!subscriber.subscribe) throw new Error('klien langganan tidak punya SUBSCRIBE');
    await subscriber.subscribe(channel);

    return async () => {
      await subscriber.quit();
    };
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

/** Opsi store Redis. Subscriber sengaja terpisah dari koneksi perintah. */
export interface RedisKeyValueStoreOptions {
  /**
   * Pabrik koneksi langganan. Dipanggil hanya saat `subscribe()` dipakai,
   * jadi store yang tidak berlangganan tidak menambah koneksi.
   */
  subscriberFactory?: () => RedisLike;
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
 * Tutup klien Redis yang gagal tanpa membiarkan error kedua menutupi yang
 * pertama — alasan kegagalan awal yang paling berguna untuk dilaporkan.
 */
function closeQuietly(client: Redis | undefined): void {
  if (!client) return;

  try {
    // 'disconnect()' memotong koneksi seketika tanpa antre perintah,
    // justru yang dibutuhkan di sini: server memang tidak hidup, jadi
    // 'quit()' akan menggantung menunggu balasan.
    client.disconnect();
  } catch {
    // Tidak ada yang bisa dilakukan, dan tidak boleh menutupi alasan asli.
  }
}

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

  // Disimpan di luar try supaya jalur kegagalan bisa menutup klien yang sudah
  // dibuat: ioredis yang ditinggal begitu saja masih memegang socket dan
  // timer reconnect, dan itu bocor resource di proses yang justru hidup lama
  // dengan store memori.
  let client: Redis | undefined;

  try {
    const module = (await import('ioredis')) as unknown as {
      default?: { default?: new (url?: string, options?: RedisOptions) => Redis } & Redis;
    };
    // ioredis diekspor sebagai CommonJS; bentuk modul di Node bisa berupa
    // { default: { default: Ctor } } atau { default: Ctor }, jadi keduanya
    // diperiksa alih-alih menebak.
    //
    // Bentuk modulnya ditulis tangan karena tipe `ioredis` hanya menyebut satu
    // dari keduanya, dan berkas ini dikompilasi dengan dua resolusi modul yang
    // berbeda (bot memakai NodeNext, dashboard memakai bundler). Tanpa coretan
    // ini, properti `.default` di dalam `.default` tidak ada di salah satunya —
    // padahal bentuk itu benar-benar terjadi di Node.
    const RedisCtor = module.default?.default ?? module.default;
    if (typeof RedisCtor !== 'function') throw new Error('konstruktor ioredis tidak ditemukan');
    client = new RedisCtor(getEnv().REDIS_URL, REDIS_OPTIONS) as Redis;

    // Tanpa listener 'error', ioredis mencetak sendiri
    // "[ioredis] Unhandled error event" ke stderr setiap koneksi gagal. Noise itu
    // menutupi peringatan yang berguna, jadi detailnya turun ke level debug;
    // konsekuensinya (jatuh ke memori) tetap dilaporkan sebagai peringatan.
    // Listener harus dipasang SEBELUM connect(), karena error pertama datang
    // dari connect() itu sendiri.
    client.on('error', (error: unknown) => {
      logger.debug({ err: error }, 'Koneksi Redis bermasalah');
    });

    const store = new RedisKeyValueStore(client as unknown as RedisLike, {
      // `duplicate()` menyalin opsi koneksi tanpa ikut berlangganan di
      // koneksi perintah, jadi publikasi dan langganan bisa hidup bersama.
      subscriberFactory: () => (client as Redis).duplicate() as unknown as RedisLike,
    });

    await client.connect();
    await store.increment('harmony:kvstore:probe', { ttlMs: 60_000 });

    logger.info('Store kunci-nilai memakai Redis');
    return { store, driver: 'redis' };
  } catch (error) {
    closeQuietly(client);

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