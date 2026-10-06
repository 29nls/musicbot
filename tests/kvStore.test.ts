import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MemoryKeyValueStore,
  RedisKeyValueStore,
  type RedisLike,
} from '../src/services/kvStore.js';
import { checkCooldown, cooldownStoreName, resetCooldown, setCooldownStore } from '../src/utils/cooldown.js';

/**
 * Store kunci-nilai.
 *
 * Store Redis diuji dengan **klien palsu**, bukan Redis sungguhan: yang perlu
 * dibuktikan di sini adalah perintah yang dikirim (PX untuk TTL, PTTL sebelum
 * memasang masa berlaku), bukan protokol Redis-nya.
 */

interface FakeRecord {
  value: string;
  expiresAt: number | undefined;
}

/** Klien Redis palsu: cukup untuk menguji store tanpa server. */
class FakeRedis implements RedisLike {
  public readonly records = new Map<string, FakeRecord>();
  public readonly calls: string[] = [];
  public failNext = false;

  private guard(): void {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('ECONNRESET');
    }
  }

  async get(key: string): Promise<string | null> {
    this.guard();
    this.calls.push(`get ${key}`);

    const record = this.records.get(key);
    if (!record) return null;
    if (record.expiresAt !== undefined && record.expiresAt <= Date.now()) {
      this.records.delete(key);
      return null;
    }

    return record.value;
  }

  async set(key: string, value: string, mode?: 'PX', ttlMs?: number): Promise<unknown> {
    this.guard();
    this.calls.push(mode === 'PX' ? `set ${key} PX ${ttlMs}` : `set ${key}`);

    this.records.set(key, {
      value,
      expiresAt: mode === 'PX' && ttlMs ? Date.now() + ttlMs : undefined,
    });

    return 'OK';
  }

  async del(key: string): Promise<number> {
    this.guard();
    this.calls.push(`del ${key}`);

    return this.records.delete(key) ? 1 : 0;
  }

  async incr(key: string): Promise<number> {
    this.guard();
    this.calls.push(`incr ${key}`);

    const record = this.records.get(key);
    const next = (record ? Number.parseInt(record.value, 10) || 0 : 0) + 1;
    this.records.set(key, { value: String(next), expiresAt: record?.expiresAt });

    return next;
  }

  async pttl(key: string): Promise<number> {
    this.guard();
    this.calls.push(`pttl ${key}`);

    const record = this.records.get(key);
    if (!record) return -2;
    if (record.expiresAt === undefined) return -1;

    return Math.max(0, record.expiresAt - Date.now());
  }

  async quit(): Promise<unknown> {
    this.calls.push('quit');
    return 'OK';
  }

  /** Satu-satunya jalan masuk error buat subclass di bawah. */
  guardForTest(): void {
    this.guard();
  }

  on(): unknown {
    return this;
  }
}

/** Klien Redis yang sudah mendukung EVAL (Redis 2.6+). */
class FakeRedisWithEval extends FakeRedis {
  /** Argumen lengkap yang diterima, supaya perintah yang dikirim bisa dibuktikan. */
  public readonly evalCalls: { script: string; numberOfKeys: number; args: string[] }[] = [];

  /** Hasil yang dikembalikan klien palsunya; dipakai untuk menguji penolakan. */
  public evalResult: unknown = 1;

  async eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown> {
    this.guardForTest();
    this.calls.push('eval');
    this.evalCalls.push({ script, numberOfKeys, args });

    return this.evalResult;
  }
}

/** Klien Redis yang sudah mendukung GETDEL (Redis 6.2+). */
class FakeRedisWithGetdel extends FakeRedis {
  async getdel(key: string): Promise<string | null> {
    this.guardForTest();
    this.calls.push(`getdel ${key}`);

    const record = this.records.get(key);
    this.records.delete(key);
    if (!record) return null;
    if (record.expiresAt !== undefined && record.expiresAt <= Date.now()) return null;

    return record.value;
  }
}

describe('MemoryKeyValueStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('menyimpan dan membaca nilai', async () => {
    const store = new MemoryKeyValueStore();

    await store.set('a', 'nilai');

    expect(await store.get('a')).toBe('nilai');
    expect(await store.get('tidak-ada')).toBeNull();
  });

  it('nilai kedaluwarsa dibaca sebagai tidak ada', async () => {
    const store = new MemoryKeyValueStore();
    await store.set('a', 'nilai', { ttlMs: 5_000 });

    vi.advanceTimersByTime(5_000);

    expect(await store.get('a')).toBeNull();
  });

  it('increment menambah dan mengembalikan angka, bukan string', async () => {
    const store = new MemoryKeyValueStore();

    expect(await store.increment('hitung')).toBe(1);
    expect(await store.increment('hitung')).toBe(2);
    expect(await store.get('hitung')).toBe('2');
  });

  it('increment pada key baru memasang TTL, pada key lama tidak memperpanjang', async () => {
    const store = new MemoryKeyValueStore();
    await store.increment('ttl', { ttlMs: 5_000 });

    vi.advanceTimersByTime(3_000);
    await store.increment('ttl', { ttlMs: 5_000 });

    // Kalau TTL ikut diperpanjang, key masih hidup di detik ke-5.
    vi.advanceTimersByTime(2_001);
    expect(await store.get('ttl')).toBeNull();
  });

  it('delete menghapus key', async () => {
    const store = new MemoryKeyValueStore();
    await store.set('a', '1');

    await store.delete('a');

    expect(await store.get('a')).toBeNull();
  });

  it('take mengembalikan nilai lalu menghapusnya', async () => {
    const store = new MemoryKeyValueStore();
    await store.set('kunci', 'nilai');

    expect(await store.take('kunci')).toBe('nilai');
    expect(await store.take('kunci')).toBeNull();
    expect(store.size).toBe(0);
  });

  it('take pada nilai kedaluwarsa mengembalikan null', async () => {
    const store = new MemoryKeyValueStore();
    await store.set('kunci', 'nilai', { ttlMs: 1_000 });

    vi.advanceTimersByTime(1_001);

    expect(await store.take('kunci')).toBeNull();
  });

  it('nilai tanpa TTL tidak pernah kedaluwarsa', async () => {
    const store = new MemoryKeyValueStore();
    await store.set('langka', 'nilai', { ttlMs: 0 });

    vi.advanceTimersByTime(86_400_000 * 30);

    expect(await store.get('langka')).toBe('nilai');
  });

  it('entri dibatasi supaya memori tidak tumbuh tanpa batas', async () => {
    const store = new MemoryKeyValueStore();

    for (let index = 0; index < 10_050; index += 1) {
      await store.set(`kunci-${index}`, 'x', { ttlMs: 600_000 });
    }

    expect(store.size).toBeLessThanOrEqual(10_000);
  });

  it('key yang kedaluwarsa dibuang lebih dulu saat pemangkasan', async () => {
    const store = new MemoryKeyValueStore();

    for (let index = 0; index < 10_000; index += 1) {
      await store.set(`lama-${index}`, 'x', { ttlMs: 1_000 });
    }

    vi.advanceTimersByTime(2_000);
    await store.set('baru', 'x', { ttlMs: 60_000 });

    expect(store.size).toBe(1);
  });

  it('close mengosongkan store', async () => {
    const store = new MemoryKeyValueStore();
    await store.set('a', '1');

    await store.close();

    expect(store.size).toBe(0);
  });
});

describe('compareAndSet di store memori', () => {
  it('menulis kalau nilai saat ini persis sama dengan yang diharapkan', async () => {
    const store = new MemoryKeyValueStore();
    await store.set('k', 'lama');

    const written = await store.compareAndSet('k', 'baru', { expectedValue: 'lama' });

    expect(written).toBe(true);
    expect(await store.get('k')).toBe('baru');
  });

  it('tidak menulis dan tidak mengubah apa pun kalau nilai sudah berbeda', async () => {
    const store = new MemoryKeyValueStore();
    await store.set('k', 'milik-orang-lain');

    const written = await store.compareAndSet('k', 'punya-saya', { expectedValue: 'saya-lihat-ini' });

    expect(written).toBe(false);
    expect(await store.get('k')).toBe('milik-orang-lain');
  });

  it('membuat key baru hanya kalau key-nya memang belum ada', async () => {
    const store = new MemoryKeyValueStore();

    const first = await store.compareAndSet('k', 'pertama', { expectedValue: null });
    const second = await store.compareAndSet('k', 'kedua', { expectedValue: null });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(await store.get('k')).toBe('pertama');
  });

  it('menolak pembuatan baru kalau key sudah ada', async () => {
    const store = new MemoryKeyValueStore();
    await store.set('k', 'ada');

    const written = await store.compareAndSet('k', 'baru', { expectedValue: null });

    expect(written).toBe(false);
    expect(await store.get('k')).toBe('ada');
  });

  it('memasang masa berlaku saat penulisan berhasil', async () => {
    const store = new MemoryKeyValueStore();
    await store.set('k', 'lama');

    await store.compareAndSet('k', 'baru', { expectedValue: 'lama', ttlMs: 60_000 });

    const records = (store as unknown as { records: Map<string, { expiresAt?: number }> }).records;
    expect(records.get('k')?.expiresAt).toBeGreaterThan(Date.now());
  });
});

describe('RedisKeyValueStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Penjaga struktur skrip Lua `compareAndSet`.
   *
   * Kenapa hanya strukturnya: tidak ada kompiler Lua di suite ini — `MiniRedis`
   * (tests/support/miniRedis.ts) tidak mengimplementasikan EVAL sama sekali, jadi
   * skrip ini belum pernah dilihat Lua sungguhan saat tes berjalan. Versi pertama
   * skrip ini lolos semua tes padahal tidak bisa dikompilasi ("'end' expected to
   * close 'if' at line 2, near '<eof>'") dan baru ketahuan saat dijalankan ke
   * Redis sungguhan. Hitungan token if/end di bawah menangkap kelas kesalahan itu
   * tanpa butuh Redis; perilakunya sendiri hanya bisa dibuktikan dengan Redis
   * hidup (empat kasus: key kosong, key ada, expectedValue cocok, expectedValue
   * basi).
   *
   * Token, bukan pola teks: `if` dihitung sebagai token utuh, jadi `elseif` tidak
   * ikut terhitung sebagai pembuka blok.
   */
  it('skrip compareAndSet punya blok Lua yang seimbang dan kedua cabang hasil', async () => {
    const client = new FakeRedisWithEval();
    const store = new RedisKeyValueStore(client);

    await store.compareAndSet('kunci', 'nilai', { expectedValue: 'lama' });

    const skrip = client.evalCalls[0]?.script ?? '';
    const token = skrip.split(/[^A-Za-z_]+/);
    const jumlahIf = token.filter((t) => t === 'if').length;
    const jumlahEnd = token.filter((t) => t === 'end').length;

    expect(jumlahIf).toBeGreaterThan(0);
    expect(jumlahEnd).toBe(jumlahIf);
    expect(skrip.trimEnd().endsWith('return 1')).toBe(true);
    // Dua jalur gagal: key yang seharusnya belum ada, dan nilai yang sudah berubah.
    expect(skrip.split('return 0').length - 1).toBe(2);
  });

  /** Bentuk argumen EVAL yang disepakati dengan skrip di src/services/kvStore.ts. */
  it('argumen EVAL membawa expectedValue, nilai, TTL, dan penanda key-harus-baru', async () => {
    const client = new FakeRedisWithEval();
    const store = new RedisKeyValueStore(client);

    await store.compareAndSet('kunci', 'baru', { expectedValue: 'lama', ttlMs: 5_000 });
    expect(client.evalCalls[0]).toEqual({
      script: expect.any(String),
      numberOfKeys: 1,
      args: ['kunci', 'lama', 'baru', '5000', '0'],
    });

    await store.compareAndSet('kunci', 'baru', { expectedValue: null });
    expect(client.evalCalls[1]).toEqual({
      script: expect.any(String),
      numberOfKeys: 1,
      args: ['kunci', '', 'baru', '0', '1'],
    });
  });

  it('TTL dikirim sebagai PX dalam milidetik, bukan detik', async () => {
    const client = new FakeRedis();
    const store = new RedisKeyValueStore(client);

    await store.set('kunci', 'nilai', { ttlMs: 5_000 });

    expect(client.calls).toContain('set kunci PX 5000');
  });

  it('tanpa TTL key ditulis tanpa PX supaya tidak ada masa berlaku', async () => {
    const client = new FakeRedis();
    const store = new RedisKeyValueStore(client);

    await store.set('kunci', 'nilai');

    expect(client.calls).toContain('set kunci');
    expect(await store.get('kunci')).toBe('nilai');
  });

  it('increment memasang TTL hanya saat key baru dibuat', async () => {
    const client = new FakeRedis();
    const store = new RedisKeyValueStore(client);

    expect(await store.increment('hitung', { ttlMs: 5_000 })).toBe(1);

    vi.advanceTimersByTime(3_000);
    expect(await store.increment('hitung', { ttlMs: 5_000 })).toBe(2);

    vi.advanceTimersByTime(2_001);
    expect(await store.get('hitung')).toBeNull();
  });

  it('key yang sudah punya TTL tidak ditulis ulang, jadi tidak memperpanjang', async () => {
    const client = new FakeRedis();
    const store = new RedisKeyValueStore(client);

    await store.increment('hitung', { ttlMs: 5_000 });
    client.calls.length = 0;

    await store.increment('hitung', { ttlMs: 60_000 });

    expect(client.calls.filter((call) => call.includes('set '))).toHaveLength(0);
  });

  it('delete memakai DEL dan mengembalikan tanpa error', async () => {
    const client = new FakeRedis();
    const store = new RedisKeyValueStore(client);

    await store.set('kunci', 'nilai');
    await store.delete('kunci');

    expect(await store.get('kunci')).toBeNull();
  });

  it('take memakai GETDEL atomik saat Redis mendukungnya', async () => {
    const client = new FakeRedisWithGetdel();
    const store = new RedisKeyValueStore(client);
    await store.set('kunci', 'nilai');

    expect(await store.take('kunci')).toBe('nilai');
    expect(client.calls).toContain('getdel kunci');
    expect(client.calls.filter((call) => call.startsWith('del '))).toHaveLength(0);
    expect(await store.take('kunci')).toBeNull();
  });

  it('take jatuh ke GET lalu DEL kalau Redis lama tidak punya GETDEL', async () => {
    const client = new FakeRedis();
    const store = new RedisKeyValueStore(client);
    await store.set('kunci', 'nilai');

    expect(await store.take('kunci')).toBe('nilai');
    expect(client.calls).toContain('get kunci');
    expect(client.calls).toContain('del kunci');
    expect(await store.get('kunci')).toBeNull();
  });

  it('take pada key yang tidak ada tidak mengirim DEL', async () => {
    const client = new FakeRedis();
    const store = new RedisKeyValueStore(client);

    expect(await store.take('hilang')).toBeNull();
    expect(client.calls.filter((call) => call.startsWith('del '))).toHaveLength(0);
  });

  it('close memanggil quit', async () => {
    const client = new FakeRedis();

    await new RedisKeyValueStore(client).close();

    expect(client.calls).toContain('quit');
  });

  it('kegagalan koneksi diteruskan, bukan ditelan diam-diam', async () => {
    const client = new FakeRedis();
    client.failNext = true;
    const store = new RedisKeyValueStore(client);

    await expect(store.get('kunci')).rejects.toThrow('ECONNRESET');
  });
});

describe('compareAndSet di store Redis', () => {
  it('memakai satu skrip Lua, bukan beberapa perintah terpisah', async () => {
    const client = new FakeRedisWithEval();
    const store = new RedisKeyValueStore(client);

    await store.compareAndSet('k', 'baru', { expectedValue: 'lama' });

    expect(client.evalCalls).toHaveLength(1);
    expect(client.evalCalls[0]?.numberOfKeys).toBe(1);
    // GET dulu lalu SET, semuanya dalam satu perintah.
    expect(client.evalCalls[0]?.script).toContain("redis.call('GET', KEYS[1])");
    expect(client.evalCalls[0]?.script).toContain("redis.call('SET', KEYS[1], ARGV[2]");
    // Tidak ada GET atau SET terpisah di luar skrip.
    expect(client.calls).toEqual(['eval']);
  });

  it('mengirim nilai yang diharapkan, nilai baru, TTL, dan penanda key kosong', async () => {
    const client = new FakeRedisWithEval();
    const store = new RedisKeyValueStore(client);

    await store.compareAndSet('k', 'baru', { expectedValue: 'lama', ttlMs: 60_000 });

    expect(client.evalCalls[0]?.args).toEqual(['k', 'lama', 'baru', '60000', '0']);
  });

  it('menandai key yang harus belum ada, supaya pembuatan baru tidak menimpa', async () => {
    const client = new FakeRedisWithEval();
    const store = new RedisKeyValueStore(client);

    await store.compareAndSet('k', 'baru', { expectedValue: null });

    expect(client.evalCalls[0]?.args).toEqual(['k', '', 'baru', '0', '1']);
  });

  it('mengembalikan true hanya kalau Redis menjawab angka 1', async () => {
    const client = new FakeRedisWithEval();
    const store = new RedisKeyValueStore(client);

    client.evalResult = 1;
    expect(await store.compareAndSet('k', 'baru', { expectedValue: 'lama' })).toBe(true);

    client.evalResult = 0;
    expect(await store.compareAndSet('k', 'baru', { expectedValue: 'lama' })).toBe(false);

    client.evalResult = '1';
    expect(await store.compareAndSet('k', 'baru', { expectedValue: 'lama' })).toBe(true);
  });

  it('jatuh ke baca-lalu-tulis tanpa EVAL, dan tetap mengatakannya terus terang', async () => {
    // Tanpa EVAL hasilnya benar untuk satu proses, tapi tidak atomik. Yang
    // penting di sini bukan menjanjikannya, tapi tidak berbohong soal itu.
    const client = new FakeRedis();
    const store = new RedisKeyValueStore(client);
    await client.set('k', 'lama');

    expect(await store.compareAndSet('k', 'baru', { expectedValue: 'lama' })).toBe(true);
    expect(await client.get('k')).toBe('baru');

    expect(await store.compareAndSet('k', 'lain', { expectedValue: 'lama' })).toBe(false);
    expect(await client.get('k')).toBe('baru');
  });
});

describe('cooldown lewat store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T00:00:00.000Z'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await resetCooldown('setelah-tes');
  });

  it('memakai store bersama yang diberikan', async () => {
    const client = new FakeRedis();
    setCooldownStore(new RedisKeyValueStore(client));

    expect(await checkCooldown('bersama', 5)).toBe(0);
    expect(await checkCooldown('bersama', 5)).toBe(5);
    expect(cooldownStoreName()).toBe('shared');
  });

  it('store bersama yang bermasalah tidak membuat perintah gagal', async () => {
    const client = new FakeRedis();
    client.failNext = true;
    setCooldownStore(new RedisKeyValueStore(client));

    // Pemanggilan pertama: store utama melempar, lalu dihitung dari cadangan.
    expect(await checkCooldown('gagal-di-store', 5)).toBe(0);

    // Konsekuensi jujurnya: panggilan berikutnya kembali ke store utama yang
    // belum tahu apa-apa, jadi satu pemakaian tambahan ikut diizinkan.
    // Rate limit yang hilang sesaat jauh lebih baik daripada perintah gagal,
    // dan begitu store pulih semuanya kembali normal.
    expect(await checkCooldown('gagal-di-store', 5)).toBe(0);
    expect(await checkCooldown('gagal-di-store', 5)).toBeGreaterThan(0);
  });

  it('durasi nol tetap tidak menyentuh store sama sekali', async () => {
    const client = new FakeRedis();
    setCooldownStore(new RedisKeyValueStore(client));

    expect(await checkCooldown('tanpa-cooldown', 0)).toBe(0);
    expect(client.calls).toHaveLength(0);
  });

  it('reset membersihkan key di store utama maupun cadangan', async () => {
    const client = new FakeRedis();
    const shared = new RedisKeyValueStore(client);
    setCooldownStore(shared);

    await checkCooldown('setelah-tes', 30);
    await resetCooldown('setelah-tes');

    expect(await checkCooldown('setelah-tes', 30)).toBe(0);
  });

  it('kembalinya ke store memori saat pemanggil mengatakannya begitu', async () => {
    setCooldownStore(new MemoryKeyValueStore());

    expect(cooldownStoreName()).toBe('shared');
  });
});