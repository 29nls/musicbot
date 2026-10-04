import { describe, expect, it } from 'vitest';
import type { Client } from 'discord.js';
import {
  MusicService,
  PlayerOwnedElsewhereError,
  PlayerOwnership,
  type MusicNodeOptions,
} from '../src/modules/music/index.js';
import { MemoryKeyValueStore } from '../src/services/kvStore.js';

const GUILD = 'guild-1';
const CHANNEL = 'channel-1';

/**
 * Klien Discord palsu.
 *
 * Shoukaku menyimpan connector saat dibangun dan memasang listener di manager,
 * bukan memutar apa pun — sama seperti yang dipakai `tests/lavalinkNodes.test.ts`.
 */
function fakeClient(): Client {
  return {
    options: { intents: [] },
    on: () => undefined,
    once: () => undefined,
    emit: () => true,
    ws: { ping: 0 },
  } as unknown as Client;
}

/** Player Lavalink palsu: yang dipakai `attachPlayerLogging` dan mode 24/7. */
function fakePlayer(guildId: string) {
  return {
    guildId,
    on: () => undefined,
    setGlobalVolume: async () => undefined,
    destroy: async () => undefined,
  };
}

interface StubbableManager {
  joinVoiceChannel: (options: { guildId: string; channelId: string; shardId: number }) => Promise<unknown>;
  leaveVoiceChannel: (guildId: string) => Promise<unknown>;
}

/**
 * Ganti dua metode manager dengan versi palsu.
 *
 * Dijalankan lewat cast karena `manager` memang `private`: yang diuji adalah
 * keputusan rummas bot (klaim lease sebelum join, lepas setelah leave), bukan
 * interaksi dengan Lavalink — itu sudah punya tesnya sendiri.
 */
function stubVoice(service: MusicService): void {
  const manager = (service as unknown as { manager: StubbableManager }).manager;

  manager.joinVoiceChannel = async (options) => fakePlayer(options.guildId);
  manager.leaveVoiceChannel = async () => undefined;
}

function buildService(ownership?: PlayerOwnership): MusicService {
  const nodes: MusicNodeOptions[] = [{ host: 'lava', port: 2333, password: 'rahasia' }];

  return new MusicService(fakeClient(), {
    getConfig: () => Promise.reject(new Error('volume bawaan tidak dipakai di tes ini')),
    nodes,
    maxQueueSize: 10,
    ownership,
  });
}

describe('MusicService dan kepemilikan player (§5.3)', () => {
  it('menolak guild yang sedang dipegang proses lain, sebelum menyentuh voice', async () => {
    const shared = new MemoryKeyValueStore();
    const other = new PlayerOwnership(shared, 'proses-b');
    await other.claim(GUILD);

    const service = buildService(new PlayerOwnership(shared, 'proses-a'));
    stubVoice(service);

    await expect(service.joinStayChannel(GUILD, CHANNEL, 0)).rejects.toBeInstanceOf(
      PlayerOwnedElsewhereError,
    );
  });

  it('melewati guild yang memang dipegang proses ini', async () => {
    const shared = new MemoryKeyValueStore();
    const ownership = new PlayerOwnership(shared, 'proses-a');

    const service = buildService(ownership);
    stubVoice(service);

    await expect(service.joinStayChannel(GUILD, CHANNEL, 0)).resolves.toBeUndefined();
    expect(await ownership.ownerOf(GUILD)).toBe('proses-a');
  });

  it('melepas lease saat keluar dari voice, supaya guild bisa diambil proses lain', async () => {
    const shared = new MemoryKeyValueStore();
    const ownership = new PlayerOwnership(shared, 'proses-a');
    const other = new PlayerOwnership(shared, 'proses-b');

    const service = buildService(ownership);
    stubVoice(service);

    await service.joinStayChannel(GUILD, CHANNEL, 0);
    expect(await other.claim(GUILD)).toBe('foreign');

    await service.disconnect(GUILD);
    expect(await ownership.ownerOf(GUILD)).toBeNull();
    expect(await other.claim(GUILD)).toBe('acquired');
  });

  it('tanpa ownership injected, MusicService tidak memblokir apa pun', async () => {
    const service = buildService(undefined);
    stubVoice(service);

    await expect(service.joinStayChannel(GUILD, CHANNEL, 0)).resolves.toBeUndefined();
  });

  it('store yang tidak bisa menegakkan satu pemilik tidak memblokir apa pun', async () => {
    const shared = new MemoryKeyValueStore();
    const bare = {
      get: (key: string) => shared.get(key),
      set: (key: string, value: string, options?: { ttlMs?: number }) =>
        shared.set(key, value, options),
      delete: (key: string) => shared.delete(key),
      take: (key: string) => shared.take(key),
      increment: (key: string, options?: { ttlMs?: number }) => shared.increment(key, options),
      close: () => shared.close(),
    };

    const service = buildService(new PlayerOwnership(bare, 'proses-a'));
    stubVoice(service);

    await expect(service.joinStayChannel(GUILD, CHANNEL, 0)).resolves.toBeUndefined();
  });
});