import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MiniRedis } from './support/miniRedis.js';

/**
 * Jalur "Redis hidup" dengan ioredis sungguhan.
 *
 * Tes ini melengkapi `kvStoreBootstrap.test.ts`: di sana ioredis diganti tiruan
 * supaya jalur gagalnya bisa dipatahkan secara sengaja, sedangkan di sini yang
 * diuji justru ioredis aslinya — perintah yang dikirim, urutan handshake, dan
 * balasan Redis yang dipakai store. Server-nya di dalam proses (lihat
 * `support/miniRedis.ts`), jadi tidak perlu Redis terpasang maupun Docker.
 *
 * Yang dijaga: value benar-benar tersimpan di server, TTL dipasang pada key
 * baru dan tidak diperpanjang pada penekanan berikutnya, dan `GETDEL`
 * (dipakai session select menu) tetap menyisakan key dalam keadaan habis.
 */

let mini: MiniRedis;
let port = 0;

beforeAll(async () => {
  mini = new MiniRedis();
  port = await mini.listen();
  process.env.REDIS_URL = `redis://127.0.0.1:${port}`;
});

afterAll(async () => {
  await mini.close();
});

async function freshStore(): Promise<{
  driver: 'redis' | 'memory';
  warning?: string;
  store: import('../src/services/kvStore.js').KeyValueStore;
}> {
  // `getEnv()` meng-memoize hasil parse-nya, jadi tanpa reset modul modul ini
  // masih memegang REDIS_URL dari `tests/setup.ts` (localhost:6379) dan
  // bootstrap akan menunggu retries sampai timeout, bukan bicara ke server uji.
  vi.resetModules();
  const { createKeyValueStore } = await import('../src/services/kvStore.js');
  return createKeyValueStore();
}

describe('store kunci-nilai dengan Redis hidup (ioredis sungguhan)', () => {
  it('bootstrap memakai Redis, bukan fallback memori', async () => {
    const handle = await freshStore();

    expect(handle.driver).toBe('redis');
    expect(handle.warning).toBeUndefined();

    // Probe startup benar-benar sampai ke server, bukan hanya "tidak melempar".
    expect(mini.ttlOf('harmony:kvstore:probe')).not.toBeNull();

    await handle.store.close();
  });

  it('increment memasang TTL pada key baru', async () => {
    const { store } = await freshStore();

    const first = await store.increment('test:ttl-baru', { ttlMs: 60_000 });
    const second = await store.increment('test:ttl-baru', { ttlMs: 60_000 });

    expect(first).toBe(1);
    expect(second).toBe(2);
    const ttl = mini.ttlOf('test:ttl-baru');
    expect(ttl).not.toBeNull();
    expect(ttl ?? 0).toBeGreaterThan(0);
    expect(ttl ?? 0).toBeLessThanOrEqual(60_000);

    await store.close();
  });

  it('increment berikutnya tidak memperpanjang TTL yang sudah ada', async () => {
    const { store } = await freshStore();

    await store.increment('test:ttl-tetap', { ttlMs: 5_000 });
    const ttlAwal = mini.ttlOf('test:ttl-tetap');

    // Penjaga: tanpa ini, dua nilai -1 (key ada tanpa masa berlaku) akan
    // membuat perbandingan di bawah lolos tanpa benar-benar menguji TTL.
    expect(ttlAwal).not.toBeNull();
    expect(ttlAwal ?? 0).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 25));
    await store.increment('test:ttl-tetap', { ttlMs: 5_000 });
    const ttlAkhir = mini.ttlOf('test:ttl-tetap') ?? 0;

    // Kalau TTL diperpanjang tiap penekanan, rate limit tidak akan pernah
    // berhenti untuk pengguna yang aktif.
    expect(ttlAkhir).toBeLessThanOrEqual(ttlAwal ?? 0);

    await store.close();
  });

  it('get dan take bekerja untuk state yang hanya boleh diklaim sekali', async () => {
    const { store } = await freshStore();

    await store.set('test:session', 'lagu-1', { ttlMs: 30_000 });
    expect(await store.get('test:session')).toBe('lagu-1');

    // take dipakai session select menu: klik kedua tidak boleh dapat lagu yang sama.
    expect(await store.take('test:session')).toBe('lagu-1');
    expect(await store.take('test:session')).toBeNull();

    await store.close();
  });

  it('delete Removes key, jadi cooldown yang dicoret hilang', async () => {
    const { store } = await freshStore();

    await store.set('test:hapus', 'nilai', { ttlMs: 30_000 });
    await store.delete('test:hapus');

    expect(await store.get('test:hapus')).toBeNull();

    await store.close();
  });

  it('port yang dipakai benar-benar port server uji', () => {
    // Penjaga kalau pengaiman REDIS_URL di test lain menggeser port: tes ini
    // hanya berarti kalau memang talking ke server di dalam proses.
    expect(port).toBeGreaterThan(0);
    expect(process.env.REDIS_URL).toBe(`redis://127.0.0.1:${port}`);
  });
});