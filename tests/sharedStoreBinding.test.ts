import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { CustomCommandRepository } from '../src/modules/customcommands/repository.js';
import { CustomCommandService } from '../src/modules/customcommands/service.js';
import type { CustomCommand } from '../src/modules/customcommands/types.js';
import { PlayerOwnership, playerOwnerKey } from '../src/modules/music/ownership.js';
import { SearchSessionStore, sessionKey } from '../src/modules/music/searchSession.js';
import { SharedMusicState, sharedStateKey } from '../src/modules/music/sharedState.js';
import type { TrackInfo } from '../src/modules/music/types.js';
import { getKeyValueStore, MemoryKeyValueStore, setKeyValueStore } from '../src/services/kvStore.js';

const GUILD = '1107624713720709122';

/**
 * Modul state bersama mengambil store saat dipakai, bukan saat dibangun.
 *
 * Modul-modul ini dibangun **sebelum** store kunci-nilai proses selesai dibuat.
 * Kalau salah satu menangkap store-nya di konstruktor, yang tertangkap adalah
 * store memori bawaan: bot tetap jalan, fiturnya tetap berfungsi, dan tidak ada
 * satu pun pesan error yang menyebut bahwa state-nya tidak pernah keluar dari
 * satu proses — padahal itu satu-satunya alasan semua store ini dibangun.
 */
describe('modul state bersama mengambil store saat dipakai', () => {
  let processStore: MemoryKeyValueStore | undefined;

  afterEach(() => {
    setKeyValueStore({ store: new MemoryKeyValueStore(), driver: 'memory' });
    processStore = undefined;
  });

  function installProcessStore(): MemoryKeyValueStore {
    processStore = new MemoryKeyValueStore();
    setKeyValueStore({ store: processStore, driver: 'memory' });
    return processStore;
  }

  it('SearchSessionStore yang dibangun lebih dulu menulis ke store yang dipasang belakangan', async () => {
    const sessions = new SearchSessionStore();
    const store = installProcessStore();

    const session = await sessions.put({
      guildId: GUILD,
      requesterId: '1',
      query: 'lagu',
      tracks: [],
    });

    expect(session).not.toBeNull();
    expect(await store.get(sessionKey(session!.token))).not.toBeNull();
  });

  it('SharedMusicState yang dibangun lebih dulu menulis ke store yang dipasang belakangan', async () => {
    const state = new SharedMusicState({ capacity: 10 });
    const store = installProcessStore();

    // Antrean kosong ke antrean kosong sengaja tidak ditulis ulang, jadi
    // percobaannya harus benar-benar mengubah state.
    await state.add(GUILD, [track('lagu-1')]);

    expect(await store.get(sharedStateKey(GUILD))).not.toBeNull();
  });

  it('CustomCommandService yang dibangun lebih dulu menulis ke store yang dipasang belakangan', async () => {
    const service = new CustomCommandService(emptyRepository());
    const store = installProcessStore();

    await service.find(GUILD, 'ping');

    expect(await store.get(`harmony:customcommands:${GUILD}`)).not.toBeNull();
  });

  it('PlayerOwnership yang dibangun lebih dulu mengklaim ke store yang dipasang belakangan', async () => {
    const ownership = new PlayerOwnership(() => getKeyValueStore(), 'proses-a');
    const store = installProcessStore();

    expect(await ownership.claim(GUILD)).toBe('acquired');
    expect(await store.get(playerOwnerKey(GUILD))).toBe('proses-a');
  });

  it('store yang disuntikkan eksplisit tetap menang atas store proses', async () => {
    const own = new MemoryKeyValueStore();
    const sessions = new SearchSessionStore({ store: own });
    const store = installProcessStore();

    const session = await sessions.put({
      guildId: GUILD,
      requesterId: '1',
      query: 'lagu',
      tracks: [],
    });

    const key = sessionKey(session!.token);
    expect(await own.get(key)).not.toBeNull();
    expect(await store.get(key)).toBeNull();
  });
});

describe('startup memasang store proses', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/index.ts', import.meta.url)), 'utf8');

  it('setKeyValueStore dipanggil, bukan hanya setCooldownStore', () => {
    // Tanpa panggilan ini, setiap modul yang membaca `getKeyValueStore()`
    // mendapat store memori bawaan apa pun soal urutan startup.
    expect(source).toMatch(/setKeyValueStore\(keyValueStore\)/);
  });

  it('store dibuat sebelum modul apa pun yang membutuhkannya', () => {
    const storeAt = source.indexOf('await createKeyValueStore()');
    const musicAt = source.indexOf('initMusic(client)');

    expect(storeAt).toBeGreaterThan(-1);
    expect(musicAt).toBeGreaterThan(-1);
    expect(storeAt).toBeLessThan(musicAt);
  });
});

/** Lagu minimal; isi `encoded` yang dipakai perbandingan "apakah antrean berubah". */
function track(encoded: string): TrackInfo {
  return {
    encoded,
    title: encoded,
    author: 'penyanyi',
    durationMs: 1_000,
    uri: null,
    artworkUrl: null,
    isStream: false,
    requesterId: '1',
  };
}

/** Repository yang selalu kosong; cache tetap bisa diperiksa tanpa Prisma. */
function emptyRepository(): CustomCommandRepository {
  return {
    create: async () => {
      throw new Error('tidak dipakai tes ini');
    },
    findByName: async () => null,
    list: async (): Promise<CustomCommand[]> => [],
    updateResponse: async () => null,
    deleteByName: async () => null,
    countByCreator: async () => 0,
    anonymizeCreator: async () => 0,
  } as unknown as CustomCommandRepository;
}