import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PLAYER_OWNER_TTL_MS,
  PlayerOwnedElsewhereError,
  PlayerOwnership,
  playerOwnerKey,
} from '../src/modules/music/ownership.js';
import { MemoryKeyValueStore, type KeyValueStore } from '../src/services/kvStore.js';

const GUILD = 'guild-1';
const OTHER_GUILD = 'guild-2';

function store(): MemoryKeyValueStore {
  return new MemoryKeyValueStore();
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
  };
}

describe('kepemilikan player per guild', () => {
  let shared: MemoryKeyValueStore;

  beforeEach(() => {
    shared = store();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('guild yang belum dipegang bisa diklaim, lalu pemilik kedua ditolak', async () => {
    const first = new PlayerOwnership(shared, 'proses-a');
    const second = new PlayerOwnership(shared, 'proses-b');

    expect(await first.claim(GUILD)).toBe('acquired');
    expect(await first.ownerOf(GUILD)).toBe('proses-a');

    expect(await second.claim(GUILD)).toBe('foreign');
    expect(await second.ownerOf(GUILD)).toBe('proses-a');
  });

  it('klaim ulang oleh pemilik yang sama memperpanjang, bukan mengambil ulang', async () => {
    const owner = new PlayerOwnership(shared, 'proses-a');

    expect(await owner.claim(GUILD)).toBe('acquired');
    expect(await owner.claim(GUILD)).toBe('renewed');

    const other = new PlayerOwnership(shared, 'proses-b');
    expect(await other.claim(GUILD)).toBe('foreign');
  });

  it('guild berbeda tidak saling mengganggu', async () => {
    const first = new PlayerOwnership(shared, 'proses-a');
    const second = new PlayerOwnership(shared, 'proses-b');

    expect(await first.claim(GUILD)).toBe('acquired');
    expect(await second.claim(OTHER_GUILD)).toBe('acquired');
  });

  it('assertOwned melempar hanya kalau guild dipegang proses lain', async () => {
    const first = new PlayerOwnership(shared, 'proses-a');
    const second = new PlayerOwnership(shared, 'proses-b');

    // Guild tanpa lease bukan milik siapa pun: belum ada yang perlu diurus.
    await expect(second.assertOwned(GUILD)).resolves.toBeUndefined();

    await first.claim(GUILD);
    await expect(first.assertOwned(GUILD)).resolves.toBeUndefined();

    await expect(second.assertOwned(GUILD)).rejects.toBeInstanceOf(PlayerOwnedElsewhereError);
    try {
      await second.assertOwned(GUILD);
      expect.unreachable('harus melempar');
    } catch (error) {
      const failure = error as PlayerOwnedElsewhereError;
      expect(failure.guildId).toBe(GUILD);
      expect(failure.ownerId).toBe('proses-a');
    }
  });

  it('release hanya menghapus lease milik sendiri', async () => {
    const owner = new PlayerOwnership(shared, 'proses-a');
    const other = new PlayerOwnership(shared, 'proses-b');

    await owner.claim(GUILD);

    // Proses lain tidak boleh melepas lease yang bukan miliknya.
    await other.release(GUILD);
    expect(await owner.ownerOf(GUILD)).toBe('proses-a');

    await owner.release(GUILD);
    expect(await owner.ownerOf(GUILD)).toBeNull();

    // Setelah dilepas, guild boleh diambil proses lain.
    expect(await other.claim(GUILD)).toBe('acquired');
  });

  it('lease yang kedaluwarsa bisa diambil proses lain, jadi proses mati tidak mengunci guild', async () => {
    vi.useFakeTimers();

    const dead = new PlayerOwnership(shared, 'proses-mati');
    const survivor = new PlayerOwnership(shared, 'proses-hidup');

    expect(await dead.claim(GUILD)).toBe('acquired');
    expect(await survivor.claim(GUILD)).toBe('foreign');

    vi.setSystemTime(Date.now() + PLAYER_OWNER_TTL_MS + 1_000);

    expect(await survivor.claim(GUILD)).toBe('acquired');
    expect(await survivor.ownerOf(GUILD)).toBe('proses-hidup');
  });

  it('store tanpa compareAndSet tidak mengarang jaminan: tidak memblokir, tapi juga tidak ada yang bisa diverifikasi', async () => {
    const bare = withoutCompareAndSet(shared);
    const ownership = new PlayerOwnership(bare, 'proses-a');

    expect(ownership.available).toBe(false);
    expect(await ownership.claim(GUILD)).toBe('renewed');

    // Tidak ada lease yang ditulis, jadi tidak ada yang bisa di-takeover juga.
    expect(await ownership.ownerOf(GUILD)).toBeNull();
    await expect(ownership.assertOwned(GUILD)).resolves.toBeUndefined();
    await expect(ownership.release(GUILD)).resolves.toBeUndefined();
  });

  it('key lease punya awalan sendiri supaya tidak bentrok dengan state lain', () => {
    expect(playerOwnerKey(GUILD)).toBe(`harmony:player-owner:${GUILD}`);
    expect(playerOwnerKey(GUILD)).not.toContain('harmony:musicstate');
  });
});