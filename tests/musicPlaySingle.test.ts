import { describe, expect, it, vi } from 'vitest';
import type { Client } from 'discord.js';
import type { GuildConfig } from '../src/modules/config/index.js';
import {
  MusicService,
  foundTracks,
  type MusicNodeOptions,
  type PlayOutcome,
  type RawTrack,
} from '../src/modules/music/index.js';

// Store state musik default (`getKeyValueStore()`) adalah singleton per
// proses, jadi record per guild bertahan antar kasus tes. Tiap tes memakai
// guildnya sendiri supaya antreannya tidak bocor ke tes berikutnya.
const CHANNEL = 'channel-play';
const USER = 'user-play';

/**
 * Regresi untuk PRD US-01: `/play` harus memutar **tepat satu** lagu —
 * hasil terbaik. Bug yang pernah terjadi: seluruh hasil `ytsearch:` (±25)
 * dan playlist dari URL YouTube ber-`&list=` masuk ke antrean sekaligus,
 * jadi satu `/play` memutar banyak lagu berturut-turut.
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

function rawTrack(id: number): RawTrack {
  return {
    encoded: `encoded-${id}`,
    info: {
      identifier: String(id),
      isSeekable: true,
      author: 'Penyanyi',
      length: 180_000,
      isStream: false,
      position: 0,
      title: `Lagu ${id}`,
      uri: `https://example.test/watch?v=${id}`,
      artworkUrl: null,
    },
    pluginInfo: {},
    userData: {},
  } as unknown as RawTrack;
}

interface JoinOptions {
  guildId: string;
  channelId: string;
  shardId: number;
}

interface ManagerLike {
  joinVoiceChannel: (options: JoinOptions) => Promise<unknown>;
  players: Map<string, unknown>;
  connections: Map<string, { channelId: string }>;
}

function buildService(): MusicService {
  const nodes: MusicNodeOptions[] = [{ host: 'lava', port: 2333, password: 'rahasia' }];

  return new MusicService(fakeClient(), {
    getConfig: async () => ({ defaultVolume: 100 }) as unknown as GuildConfig,
    nodes,
    maxQueueSize: 10,
  });
}

/**
 * Ganti join voice dengan player palsu yang mendaftarkan dirinya sendiri ke
 * `manager.players`/`manager.connections` — persis yang dilakukan shoukaku,
 * supaya panggilan `/play` kedua melihat player yang sudah ada (jalur
 * "sudah berbunyi → antre") alih-alih join ulang.
 */
function stubVoice(service: MusicService) {
  const manager = (service as unknown as { manager: ManagerLike }).manager;
  const created: ReturnType<typeof fakePlayer>[] = [];

  manager.joinVoiceChannel = async (options) => {
    const player = fakePlayer(options.guildId);
    manager.players.set(options.guildId, player);
    manager.connections.set(options.guildId, { channelId: options.channelId });
    created.push(player);
    return player;
  };

  return created;
}

function fakePlayer(guildId: string) {
  return {
    guildId,
    volume: 100,
    paused: false,
    position: 0,
    on: () => undefined,
    setGlobalVolume: vi.fn(async () => undefined),
    setFilters: vi.fn(async () => undefined),
    playTrack: vi.fn(async () => undefined),
    stopTrack: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
  };
}

function added(outcome: PlayOutcome): Extract<PlayOutcome, { kind: 'added' }> {
  if (outcome.kind !== 'added') {
    throw new Error(`expected kind 'added', got '${outcome.kind}'`);
  }
  return outcome;
}

describe('/play selalu tepat satu lagu (PRD US-01)', () => {
  it('kata kunci: memutar hasil terbaik saja, bukan semua hasil pencarian', async () => {
    const GUILD = 'guild-play-search';
    const service = buildService();
    const players = stubVoice(service);
    const outcome = foundTracks([rawTrack(1), rawTrack(2), rawTrack(3), rawTrack(4), rawTrack(5)]);
    service.resolve = async () => outcome;

    const result = added(
      await service.play({
        guildId: GUILD,
        query: 'sama saja',
        voiceChannelId: CHANNEL,
        shardId: 0,
        requesterId: USER,
      }),
    );

    expect(result.started).toBe(true);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]?.title).toBe('Lagu 1');

    // Bukan cuma embednya yang bilang satu: player benar-benar hanya
    // memutar satu track, dan antrean tidak kebanjiran sisa hasil.
    expect(players[0]?.playTrack).toHaveBeenCalledTimes(1);
    expect(players[0]?.playTrack).toHaveBeenCalledWith({ track: { encoded: 'encoded-1' } });

    const snap = await service.snapshot(GUILD);
    expect(snap.current?.title).toBe('Lagu 1');
    expect(snap.upcoming).toHaveLength(0);
  });

  it('saat sudah berbunyi, /play menambah tepat satu lagu ke antrean', async () => {
    const GUILD = 'guild-play-queue';
    const service = buildService();
    stubVoice(service);
    service.resolve = async () => foundTracks([rawTrack(1), rawTrack(2), rawTrack(3)]);

    const playRequest = {
      guildId: GUILD,
      query: 'rama kaki patah',
      voiceChannelId: CHANNEL,
      shardId: 0,
      requesterId: USER,
    };

    expect((await service.play(playRequest)).kind).toBe('added');

    const second = added(await service.play(playRequest));
    expect(second.started).toBe(false);
    expect(second.tracks).toHaveLength(1);

    const snap = await service.snapshot(GUILD);
    expect(snap.current?.title).toBe('Lagu 1');
    expect(snap.upcoming).toHaveLength(1);
    expect(snap.upcoming[0]?.title).toBe('Lagu 1');
  });

  it('URL playlist/radio YouTube juga hanya memutar satu lagu, tanpa judul playlist', async () => {
    const GUILD = 'guild-play-playlist';
    const service = buildService();
    const players = stubVoice(service);
    // LoadType.PLAYLIST: `watch?v=...&list=RD...` (radio) dan URL playlist
    // biasa kembali dengan seluruh isi playlist + namanya.
    service.resolve = async () =>
      foundTracks([rawTrack(1), rawTrack(2), rawTrack(3), rawTrack(4), rawTrack(5)], 'Radio MIX');

    const result = added(
      await service.play({
        guildId: GUILD,
        query: 'https://www.youtube.com/watch?v=1&list=RD1&start_radio=1',
        voiceChannelId: CHANNEL,
        shardId: 0,
        requesterId: USER,
      }),
    );

    expect(result.tracks).toHaveLength(1);
    expect(result.playlistName).toBeUndefined();
    expect(players[0]?.playTrack).toHaveBeenCalledTimes(1);
    expect(players[0]?.playTrack).toHaveBeenCalledWith({ track: { encoded: 'encoded-1' } });

    const snap = await service.snapshot(GUILD);
    expect(snap.current?.title).toBe('Lagu 1');
    expect(snap.upcoming).toHaveLength(0);
  });

  it('hasil pencarian kosong tetap dijawab "empty", bukan error', async () => {
    const GUILD = 'guild-play-empty';
    const service = buildService();
    stubVoice(service);
    service.resolve = async () => foundTracks([]);

    await expect(
      service.play({
        guildId: GUILD,
        query: 'tidak ada hasil',
        voiceChannelId: CHANNEL,
        shardId: 0,
        requesterId: USER,
      }),
    ).resolves.toEqual({ kind: 'empty' });
  });
});
