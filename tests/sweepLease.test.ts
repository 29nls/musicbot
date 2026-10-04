import { describe, expect, it } from 'vitest';
import { MemoryKeyValueStore, type KeyValueStore } from '../src/services/kvStore.js';
import { processInstanceId, resetProcessInstanceId } from '../src/services/instanceId.js';
import { startRetentionJob } from '../src/services/retentionJob.js';
import {
  SWEEP_LEASE_KEY_PREFIX,
  SweepLease,
  sweepLeaseKey,
} from '../src/services/sweepLease.js';

const NAME = 'retention';
const TTL = 60_000;

function lease(shared: KeyValueStore, holderId: string): SweepLease {
  return new SweepLease(shared, NAME, holderId, TTL);
}

/** Store yang sengaja tidak bisa menegakkan satu pemilik. */
function withoutCompareAndSet(inner: KeyValueStore): KeyValueStore {
  return {
    get: (key) => inner.get(key),
    set: (key, value, options) => inner.set(key, value, options),
    delete: (key) => inner.delete(key),
    take: (key) => inner.take(key),
    increment: (key, options) => inner.increment(key, options),
    close: () => inner.close(),
  } as KeyValueStore;
}

describe('sweepLeaseKey', () => {
  it('punya awalan sendiri supaya tidak bentrok dengan state lain', () => {
    expect(sweepLeaseKey(NAME)).toBe(`${SWEEP_LEASE_KEY_PREFIX}${NAME}`);
    expect(sweepLeaseKey(NAME)).not.toContain('harmony:musicstate');
    expect(sweepLeaseKey(NAME)).not.toContain('harmony:player-owner');
  });

  it('nama job berbeda tidak saling ikut', () => {
    expect(sweepLeaseKey('retention')).not.toBe(sweepLeaseKey('panel-expiry'));
  });
});

describe('SweepLease', () => {
  it('proses pertama boleh dipakai, proses kedua harus dilewati', async () => {
    const shared = new MemoryKeyValueStore();
    const first = lease(shared, 'proses-a');
    const second = lease(shared, 'proses-b');

    expect(await first.claim()).toBe('acquired');
    expect(await second.claim()).toBe('foreign');
    expect(await first.holder()).toBe('proses-a');
  });

  it('proses yang sama memperpanjang, jadi bisa menjalankan sapuan berikutnya', async () => {
    const shared = new MemoryKeyValueStore();
    const owner = lease(shared, 'proses-a');

    expect(await owner.claim()).toBe('acquired');
    expect(await owner.claim()).toBe('renewed');
  });

  it('lease yang kedaluwarsa bisa diambil proses lain, jadi proses mati tidak memblokir selamanya', async () => {
    const shared = new MemoryKeyValueStore();
    const survivor = lease(shared, 'proses-hidup');

    // Lease proses yang mati dicicil lewat store yang sama supaya ambang
    // waktunya benar-benar lewat tanpa menunggu waktu nyata.
    //
    // TTL-nya 60 ms, bukan 1 ms. Dengan 1 ms, satu `await` saja sudah cukup
    // untuk membuat ambang lewat di mesin yang sedang sibuk, jadi tesnya
    // gagal tanpa ada yang salah. Kegagalan seperti itu paling mahal karena
    // tidak ada yang menyuruh mencari penyebabnya di tes ini. Yang diuji
    // tetap sama: lease masih dipegang pada saat pertama, lalu diambil
    // proses lain setelah umurnya lewat.
    const shortLived = new SweepLease(shared, NAME, 'proses-mati', 60);
    await shortLived.claim();

    expect(await survivor.claim()).toBe('foreign');
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(await survivor.claim()).toBe('acquired');
  });

  it('store tanpa compareAndSet tidak mengarang jaminan: tidak memblokir, tapi juga tidak menahan apa pun', async () => {
    const bare = withoutCompareAndSet(new MemoryKeyValueStore());
    const guard = new SweepLease(bare, NAME, 'proses-a', TTL);

    expect(guard.available).toBe(false);
    expect(await guard.claim()).toBe('renewed');
    expect(await guard.holder()).toBeNull();
  });

  it('store diambil saat dipakai, bukan saat objek dibuat', async () => {
    let current: KeyValueStore = new MemoryKeyValueStore();
    const guard = new SweepLease(() => current, NAME, 'proses-a', TTL);
    const replacement = new MemoryKeyValueStore();

    expect(await guard.claim()).toBe('acquired');
    expect(await current.get(sweepLeaseKey(NAME))).toBe('proses-a');

    current = replacement;
    expect(await guard.claim()).toBe('acquired');
    expect(await replacement.get(sweepLeaseKey(NAME))).toBe('proses-a');
  });
});

describe('job retensi hanya berjalan di satu proses', () => {
  function runner() {
    const calls: number[] = [];
    return {
      calls,
      purgeExpired: async () => {
        calls.push(1);
        return { cutoff: new Date('2020-01-01T00:00:00Z'), warnings: 0, cases: 0 };
      },
    };
  }

  const emptyTicketRunner = { purgeExpired: async () => ({ cutoff: new Date(), ticketsDeleted: 0 }) };
  const emptyLogRunner = { purgeExpired: async () => ({ cutoff: new Date(), logs: 0 }) };

  it('proses yang kalah lease tidak memanggil penghapusan sama sekali', async () => {
    const shared = new MemoryKeyValueStore();
    await new SweepLease(shared, NAME, 'proses-lain', TTL).claim();

    const mine = runner();
    const job = startRetentionJob(mine, {
      runOnStart: false,
      lease: new SweepLease(shared, NAME, 'proses-a', TTL),
      ticketRunner: emptyTicketRunner,
      logRunner: emptyLogRunner,
    });

    expect(await job.runOnce()).toBeNull();
    expect(mine.calls).toHaveLength(0);
    job.stop();
  });

  it('proses yang menang lease menjalankan penghapusan', async () => {
    const shared = new MemoryKeyValueStore();
    const mine = runner();
    const job = startRetentionJob(mine, {
      runOnStart: false,
      lease: new SweepLease(shared, NAME, 'proses-a', TTL),
      ticketRunner: emptyTicketRunner,
      logRunner: emptyLogRunner,
    });

    expect(await job.runOnce()).not.toBeNull();
    expect(mine.calls).toHaveLength(1);
    job.stop();
  });

  it('tanpa lease, job tetap jalan di semua proses supaya satu shard tidak ikut berubah', async () => {
    const mine = runner();
    const job = startRetentionJob(mine, { runOnStart: false });

    expect(await job.runOnce()).not.toBeNull();
    expect(mine.calls).toHaveLength(1);
    job.stop();
  });
});

describe('processInstanceId', () => {
  it('stabil selama proses hidup, karena lease membandingkan nilainya', () => {
    resetProcessInstanceId();
    const first = processInstanceId();

    expect(processInstanceId()).toBe(first);
    resetProcessInstanceId();
    expect(processInstanceId()).not.toBe(first);
    resetProcessInstanceId();
  });
});