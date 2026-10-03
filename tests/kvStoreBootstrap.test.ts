import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Bootstrap store kunci-nilai (`createKeyValueStore`).
 *
 * Fungsi ini menentukan apakah bot memakai Redis atau jatuh ke memori, jadi
 * dua jalurnya diuji langsung — bukan hanya kelas store-nya. Yang dijaga di sini
 * adalah hal yang terlihat di log operator:
 *
 * - listener 'error' harus dipasang SEBELUM `connect()`, karena error pertama
 *   justru datang dari `connect()` itu sendiri dan tanpa listener ioredis
 *   mencetak "[ioredis] Unhandled error event" ke stderr;
 * - klien yang gagal tidak boleh ditinggal hidup (socket + timer reconnect),
 *   karena proses justru ikut hidup lama di store memori.
 */

class FakeRedis {
  static instances: FakeRedis[] = [];
  /** Urutan kejadian, dipakai untuk membuktikan urutan listener vs connect. */
  static timeline: string[] = [];

  /**
   * Kegagalan yang harus disimulasikan untuk instance BERIKUTNYA.
   *
   * Disimpan secara statis, bukan sebagai field instance: field instance
   * diinisialisasi ulang di tiap konstruktor, jadi nilai yang dipasang di
   * prototype akan langsung ditimpa `null` dan tesnya jadi lolos tanpa
   * benar-benar menguji jalur gagal.
   */
  static nextConnectError: Error | null = null;
  static nextDisconnectError: Error | null = null;

  public readonly url: string;
  public disconnectCalls = 0;
  public connectCalls = 0;
  public incrCalls: string[] = [];
  public setCalls: Array<[string, string, 'PX', number]> = [];

  private readonly handlers = new Map<string, (error: Error) => void>();
  private counter = 0;

  constructor(url: string) {
    this.url = url;
    FakeRedis.instances.push(this);
    FakeRedis.timeline.push('construct');
  }

  on(event: string, listener: (error: Error) => void): this {
    this.handlers.set(event, listener);
    FakeRedis.timeline.push('on:' + event);
    return this;
  }

  async connect(): Promise<void> {
    this.connectCalls += 1;
    FakeRedis.timeline.push('connect');
    if (FakeRedis.nextConnectError) throw FakeRedis.nextConnectError;
  }

  async incr(key: string): Promise<number> {
    this.incrCalls.push(key);
    this.counter += 1;
    return this.counter;
  }

  /** -2 = key belum ada; itu yang membuat store memasang TTL baru. */
  async pttl(_key: string): Promise<number> {
    return -2;
  }

  async set(key: string, value: string, mode: 'PX', ttlMs: number): Promise<unknown> {
    this.setCalls.push([key, value, mode, ttlMs]);
    return 'OK';
  }

  disconnect(): void {
    this.disconnectCalls += 1;
    FakeRedis.timeline.push('disconnect');
    if (FakeRedis.nextDisconnectError) throw FakeRedis.nextDisconnectError;
  }

  /** Pancarkan error seperti yang ioredis lakukan saat koneksi ditolak. */
  emitError(error: Error): void {
    const listener = this.handlers.get('error');
    if (!listener) throw new Error('tidak ada listener error — ioredis akan mencetak ke stderr');
    listener(error);
  }

  get hasErrorListener(): boolean {
    return this.handlers.has('error');
  }
}

vi.mock('ioredis', () => ({ default: FakeRedis }));

async function loadModule(): Promise<typeof import('../src/services/kvStore.js')> {
  vi.resetModules();
  return import('../src/services/kvStore.js');
}

/** Nyalakan kegagalan `connect()` untuk satu blok tes, lalu (selalu) matikan lagi. */
async function withFailingConnect(
  run: () => Promise<void>,
  disconnectError: Error | null = null,
): Promise<void> {
  FakeRedis.nextConnectError = new Error('ECONNREFUSED 127.0.0.1:6379');
  FakeRedis.nextDisconnectError = disconnectError;
  try {
    await run();
  } finally {
    FakeRedis.nextConnectError = null;
    FakeRedis.nextDisconnectError = null;
  }
}

describe('createKeyValueStore', () => {
  beforeEach(() => {
    FakeRedis.instances = [];
    FakeRedis.timeline = [];
    FakeRedis.nextConnectError = null;
    FakeRedis.nextDisconnectError = null;
  });

  it('memakai Redis kalau koneksi dan probe pertama berhasil', async () => {
    const { createKeyValueStore } = await loadModule();

    const handle = await createKeyValueStore();

    expect(handle.driver).toBe('redis');
    expect(handle.warning).toBeUndefined();
    const client = FakeRedis.instances[0];
    expect(client?.url).toBe('redis://localhost:6379');
    // Probe benar-benar naik ke server, bukan cuma "tidak melempar".
    expect(client?.incrCalls).toEqual(['harmony:kvstore:probe']);
    // Klien yang sehat dibiarkan hidup; tidak ada disconnect.
    expect(client?.disconnectCalls).toBe(0);
  });

  it('jatuh ke memori dengan peringatan yang menyebut konsekuensinya', async () => {
    const { createKeyValueStore } = await loadModule();

    await withFailingConnect(async () => {
      const handle = await createKeyValueStore();

      expect(handle.driver).toBe('memory');
      expect(handle.warning).toContain('Rate limit kembali per proses');
      expect(handle.warning).toContain('sharding');
    });
  });

  it('listener error dipasang sebelum connect(), kalau tidak noise ioredis muncul lagi', async () => {
    const { createKeyValueStore } = await loadModule();

    await withFailingConnect(async () => {
      await createKeyValueStore();

      const client = FakeRedis.instances[0];
      expect(client?.hasErrorListener).toBe(true);
      expect(FakeRedis.timeline.indexOf('on:error')).toBeLessThan(
        FakeRedis.timeline.indexOf('connect'),
      );
    });
  });

  it('error dari ioredis tidak lagi mencetak ke stderr karena ada listener', async () => {
    const { createKeyValueStore } = await loadModule();

    await createKeyValueStore();

    // Melempar dari dalam listener akan gagal kalau tidak ada listener error,
    // dan itulah persis kondisi yang sebelumnya menghasilkan "[ioredis]
    // Unhandled error event".
    expect(() => FakeRedis.instances[0]?.emitError(new Error('ECONNRESET'))).not.toThrow();
  });

  it('klien yang gagal ditutup, supaya tidak ada socket & timer yang menggantung', async () => {
    const { createKeyValueStore } = await loadModule();

    await withFailingConnect(async () => {
      await createKeyValueStore();

      expect(FakeRedis.instances[0]?.disconnectCalls).toBe(1);
    });
  });

  it('error dari disconnect tidak menutupi kegagalan yang asli', async () => {
    const { createKeyValueStore } = await loadModule();

    await withFailingConnect(
      async () => {
        const handle = await createKeyValueStore();

        // Bot tetap jalan dengan memori; yang penting bukan ikut gagal.
        expect(handle.driver).toBe('memory');
        expect(handle.warning).toContain('Rate limit kembali per proses');
      },
      new Error('socket sudah tertutup'),
    );
  });
});