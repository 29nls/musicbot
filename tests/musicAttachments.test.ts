import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'discord.js';
import type { GuildConfig } from '../src/modules/config/index.js';
import {
  AttachmentStore,
  MusicService,
  attachmentTitle,
  foundTracks,
  nowPlayingEmbed,
  renderPlayOutcome,
  type MusicNodeOptions,
  type PlayOutcome,
  type RawTrack,
} from '../src/modules/music/index.js';
import { MAX_ATTACHMENT_BYTES } from '../src/modules/music/limits.js';
import { defaultTranslator } from '../src/modules/i18n/index.js';

const CHANNEL = 'channel-attachment';
const USER = 'user-attachment';

const temporaryDirs: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'harmony-attachment-'));
  temporaryDirs.push(dir);
  return dir;
}

/** Fetch palsu yang selalu mengembalikan audio kecil. */
function fakeFetch(bytes = Buffer.from('audio')) {
  return vi.fn(async () => new Response(bytes)) as unknown as typeof fetch;
}

/** Semua file di bawah folder, untuk memastikan pembersihan benar-benar terjadi. */
async function filesIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
}

describe('attachmentTitle', () => {
  it('membuang ekstensi dan memakai nama file sebagai judul', () => {
    expect(attachmentTitle('Rekaman Rapat.m4a', 'cadangan')).toBe('Rekaman Rapat');
  });

  it('memakai judul cadangan kalau nama file kosong', () => {
    expect(attachmentTitle('.mp3', 'File audio')).toBe('File audio');
  });
});

describe('AttachmentStore', () => {
  it('menolak file di atas batas tanpa mengunduhnya', async () => {
    const fetchImpl = fakeFetch();
    const store = new AttachmentStore({ dir: await temporaryDir(), fetchImpl });

    const result = await store.save({
      url: 'https://cdn.test/besar.mp3',
      name: 'besar.mp3',
      size: MAX_ATTACHMENT_BYTES + 1,
    });

    expect(result).toEqual({ ok: false, reason: 'too-large' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('menyimpan file dengan path bot dan path Lavalink yang menunjuk file sama', async () => {
    const dir = await temporaryDir();
    const store = new AttachmentStore({
      dir,
      lavalinkDir: '/opt/Lavalink/attachments',
      fetchImpl: fakeFetch(Buffer.from('isi audio')),
    });

    const result = await store.save({
      url: 'https://cdn.test/lagu.mp3',
      name: 'Lagu Asli.MP3',
      size: 10,
    });

    if (!result.ok) throw new Error('penyimpanan seharusnya berhasil');

    expect(result.stored.path.startsWith(dir)).toBe(true);
    expect(result.stored.path.endsWith('.mp3')).toBe(true);
    expect(result.stored.lavalinkPath.startsWith('/opt/Lavalink/attachments/')).toBe(true);
    expect(result.stored.lavalinkPath.endsWith('.mp3')).toBe(true);
    expect(await filesIn(dir)).toEqual([result.stored.path]);
  });

  it('menghapus file saat track dilepas', async () => {
    const dir = await temporaryDir();
    const store = new AttachmentStore({ dir, fetchImpl: fakeFetch() });
    const saved = await store.save({ url: 'https://cdn.test/a.mp3', name: 'a.mp3', size: 5 });
    if (!saved.ok) throw new Error('penyimpanan seharusnya berhasil');

    store.register('encoded-a', saved.stored.path);
    await store.release(['encoded-a']);

    expect(await filesIn(dir)).toEqual([]);
  });

  it('menyapu file yang lewat TTL dan mempertahankan yang masih baru', async () => {
    const dir = await temporaryDir();
    const now = Date.now();
    const store = new AttachmentStore({ dir, ttlMs: 60_000, now: () => now, fetchImpl: fakeFetch() });

    const saved = await store.save({ url: 'https://cdn.test/b.mp3', name: 'b.mp3', size: 5 });
    if (!saved.ok) throw new Error('penyimpanan seharusnya berhasil');

    // File dari proses yang mati mendadak: tidak terdaftar di proses ini.
    const staleDir = join(dir, 'proses-lama');
    await mkdir(staleDir, { recursive: true });
    const staleFile = join(staleDir, 'lama.mp3');
    await writeFile(staleFile, 'x', { mode: 0o644 });
    await utimes(staleFile, new Date(now - 120_000), new Date(now - 120_000));

    expect(await store.sweep(now)).toBe(1);
    expect(await filesIn(dir)).toEqual([saved.stored.path]);
  });
});

function fakeClient(): Client {
  return {
    options: { intents: [] },
    on: () => undefined,
    once: () => undefined,
    emit: () => true,
    ws: { ping: 0 },
  } as unknown as Client;
}

function rawTrack(): RawTrack {
  return {
    encoded: 'encoded-attachment',
    info: {
      author: 'Tidak diketahui',
      length: 120_000,
      isStream: false,
      title: 'UUID tanpa arti',
      uri: undefined,
      artworkUrl: null,
    },
  } as unknown as RawTrack;
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

function buildService(store: AttachmentStore): MusicService {
  const nodes: MusicNodeOptions[] = [{ host: 'lava', port: 2333, password: 'rahasia' }];
  const service = new MusicService(fakeClient(), {
    getConfig: async () => ({ defaultVolume: 100 }) as unknown as GuildConfig,
    nodes,
    maxQueueSize: 10,
    attachments: store,
  });

  const manager = (service as unknown as {
    manager: {
      joinVoiceChannel: (options: { guildId: string; channelId: string }) => Promise<unknown>;
      players: Map<string, unknown>;
      connections: Map<string, { channelId: string }>;
    };
  }).manager;

  manager.joinVoiceChannel = async (options) => {
    const player = fakePlayer(options.guildId);
    manager.players.set(options.guildId, player);
    manager.connections.set(options.guildId, { channelId: options.channelId });
    return player;
  };

  return service;
}

function added(outcome: PlayOutcome): Extract<PlayOutcome, { kind: 'added' }> {
  if (outcome.kind !== 'added') throw new Error(`expected added, got ${outcome.kind}`);
  return outcome;
}

describe('/play file: alur lampiran', () => {
  it('memutar lampiran dengan judul asli, lalu menghapus file saat /stop', async () => {
    const dir = await temporaryDir();
    const store = new AttachmentStore({ dir, fetchImpl: fakeFetch() });
    const service = buildService(store);
    service.resolveLocal = async () => foundTracks([rawTrack()]);

    const outcome = added(
      await service.playAttachment({
        guildId: 'guild-attachment-play',
        voiceChannelId: CHANNEL,
        shardId: 0,
        requesterId: USER,
        attachment: { url: 'https://cdn.test/a.mp3', name: 'Rekaman Rapat.mp3', size: 5 },
        title: attachmentTitle('Rekaman Rapat.mp3', 'File audio'),
        author: 'Lampiran',
      }),
    );

    expect(outcome.tracks[0]?.title).toBe('Rekaman Rapat');
    expect(outcome.tracks[0]?.author).toBe('Lampiran');
    // Lavalink mengisi uri dengan path file; itu bukan URL dan tidak boleh ikut
    // dikirim ke Discord (embed.url hanya menerima http/https).
    expect(outcome.tracks[0]?.uri).toBeNull();
    expect(await filesIn(dir)).toHaveLength(1);

    await service.stop('guild-attachment-play');

    expect(await filesIn(dir)).toEqual([]);
  });

  it('menghapus file kalau Lavalink tidak bisa memutarnya', async () => {
    const dir = await temporaryDir();
    const service = buildService(new AttachmentStore({ dir, fetchImpl: fakeFetch() }));
    service.resolveLocal = async () => ({ kind: 'empty' });

    const outcome = await service.playAttachment({
      guildId: 'guild-attachment-unsupported',
      voiceChannelId: CHANNEL,
      shardId: 0,
      requesterId: USER,
      attachment: { url: 'https://cdn.test/a.txt', name: 'catatan.txt', size: 5 },
      title: 'catatan',
      author: 'Lampiran',
    });

    expect(outcome).toEqual({ kind: 'attachment-failed', reason: 'unsupported' });
    expect(await filesIn(dir)).toEqual([]);
  });

  it('tidak memasang path file sebagai URL embed', () => {
    const track = {
      encoded: 'encoded-lokal',
      title: 'Lagu dari disk',
      author: 'Lampiran',
      durationMs: 1_000,
      uri: '/opt/Lavalink/attachments/x/lagu.wav',
      artworkUrl: null,
      isStream: false,
      requesterId: USER,
    };

    const added = renderPlayOutcome(
      { kind: 'added', tracks: [track], started: true, position: 0, skipped: 0 },
      defaultTranslator,
    ).toJSON();
    const nowPlaying = nowPlayingEmbed(
      track,
      {
        guildId: 'guild-embed',
        current: track,
        upcoming: [],
        upcomingDurationMs: 0,
        paused: false,
        positionMs: 0,
        volume: 100,
        idleRemainingMs: null,
        loopMode: 'off',
        filterMode: 'off',
      },
      defaultTranslator,
    ).toJSON();

    expect(added.url).toBeUndefined();
    expect(nowPlaying.url).toBeUndefined();
  });

  it('pesan batas ukuran memakai angka yang bisa dibaca', async () => {
    const embed = renderPlayOutcome(
      { kind: 'attachment-failed', reason: 'too-large', size: 30 * 1024 * 1024 },
      defaultTranslator,
    );

    const text = JSON.stringify(embed.toJSON());
    expect(text).toContain('30 MB');
    expect(text).toContain('25 MB');
  });
});
