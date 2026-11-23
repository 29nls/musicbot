import { describe, expect, it, vi } from 'vitest';
import { MemoryKeyValueStore } from '../src/services/kvStore.js';
import {
  dashboardResultKey,
  decodeDashboardResult,
  encodeDashboardMusicCommand,
  MAX_DASHBOARD_COMMAND_AGE_MS,
  type DashboardCommand,
  type DashboardTrack,
} from '../src/modules/music/dashboard.js';
import {
  handleDashboardMusicCommand,
  type DashboardMusicDeps,
  type DashboardMusicPort,
} from '../src/modules/music/dashboardService.js';
import type { TrackInfo } from '../src/modules/music/types.js';

const GUILD = '111111111111111111';
const USER = '222222222222222222';
const BOT_VOICE = '333333333333333333';
const OTHER_VOICE = '444444444444444444';
const NOW = 1_700_000_000_000;

function track(overrides: Partial<TrackInfo> = {}): TrackInfo {
  return {
    encoded: 'encoded-1',
    title: 'Lagu Satu',
    author: 'Artis Satu',
    durationMs: 200_000,
    uri: 'https://www.youtube.com/watch?v=one',
    artworkUrl: null,
    isStream: false,
    requesterId: USER,
    ...overrides,
  };
}

function dashboardTrack(overrides: Partial<DashboardTrack> = {}): DashboardTrack {
  return {
    title: 'Lagu Satu',
    author: 'Artis Satu',
    durationMs: 200_000,
    uri: 'https://www.youtube.com/watch?v=one',
    artworkUrl: null,
    isStream: false,
    metadataSource: 'lavalink',
    audioSource: 'www.youtube.com',
    ...overrides,
  };
}

function raw(command: DashboardCommand, requestId = 'request-1234567890abcdef'): string {
  return encodeDashboardMusicCommand({
    guildId: GUILD,
    userId: USER,
    requestId,
    createdAt: NOW,
    command,
  });
}

interface Overrides {
  ownsGuild?: boolean;
  configMusic?: boolean;
  djRoleId?: string | null;
  membership?: {
    canManageGuild: boolean;
    memberRoleIds: readonly string[];
    voiceChannelId: string | null;
  } | null;
  botVoice?: string | null;
  search?: DashboardMusicDeps['search'];
  loadPlaylist?: DashboardMusicDeps['loadPlaylist'];
}

function makeDeps(overrides: Overrides = {}) {
  const store = new MemoryKeyValueStore();
  const music: DashboardMusicPort = {
    botVoiceChannelId: vi.fn(() => (overrides.botVoice === undefined ? BOT_VOICE : overrides.botVoice)),
    isConnected: true,
    play: vi.fn(async () => ({
      kind: 'added' as const,
      tracks: [track()],
      started: true,
      position: 0,
      skipped: 0,
    })),
    enqueue: vi.fn(async () => ({
      kind: 'added' as const,
      tracks: [track()],
      started: true,
      position: 0,
      skipped: 0,
    })),
    setPaused: vi.fn(async () => true),
    skip: vi.fn(async () => ({ skipped: track(), next: null })),
    stop: vi.fn(async () => track()),
    setLoopMode: vi.fn(async () => 'off' as const),
    setVolume: vi.fn(async () => 100),
  };

  const deps: DashboardMusicDeps = {
    ownsGuild: () => overrides.ownsGuild ?? true,
    music: () => music,
    getConfig: async () => ({
      modules: { music: overrides.configMusic ?? true },
      djRoleId: overrides.djRoleId ?? null,
    }),
    search: overrides.search ?? (async () => ({ kind: 'ok', tracks: [dashboardTrack()] })),
    canControl:
      overrides.membership === undefined
        ? async () => ({
            canManageGuild: false,
            memberRoleIds: [],
            voiceChannelId: BOT_VOICE,
          })
        : async () => overrides.membership ?? null,
    loadPlaylist:
      overrides.loadPlaylist ??
      (async () => ({
        kind: 'ok',
        playlistName: 'Lofi',
        tracks: [track()],
        failed: 1,
        total: 2,
      })),
    shardIdForGuild: () => 0,
    store: () => store,
    owner: () => 'bot-a',
    now: () => NOW,
  };

  return { deps, music, store };
}

async function readResult(store: MemoryKeyValueStore, requestId: string) {
  return decodeDashboardResult(await store.get(dashboardResultKey(requestId)));
}

describe('dispatch perintah musik dashboard', () => {
  it('mengabaikan perintah untuk guild yang bukan milik proses ini', async () => {
    const { deps, music, store } = makeDeps({ ownsGuild: false });
    const message = raw({ kind: 'pause' });

    expect(await handleDashboardMusicCommand(deps, message, NOW)).toBeNull();
    expect(music.setPaused).not.toHaveBeenCalled();
    expect(await store.get(dashboardResultKey('request-1234567890abcdef'))).toBeNull();
  });

  it('menolak pesan yang terlalu tua tanpa menyentuh player', async () => {
    const { deps, music } = makeDeps();
    const message = raw({ kind: 'stop' });

    expect(
      await handleDashboardMusicCommand(deps, message, NOW + MAX_DASHBOARD_COMMAND_AGE_MS + 1),
    ).toBeNull();
    expect(music.stop).not.toHaveBeenCalled();
  });

  it('menjalankan pause dan menulis hasil yang bisa dibaca dashboard', async () => {
    const { deps, music, store } = makeDeps();

    const handled = await handleDashboardMusicCommand(
      deps,
      raw({ kind: 'pause' }, 'request-aaaaaaaaaaaaaaaa'),
      NOW,
    );

    expect(music.setPaused).toHaveBeenCalledWith(GUILD, true);
    expect(handled?.result).toEqual({ action: 'pause', ok: true });
    expect(await readResult(store, 'request-aaaaaaaaaaaaaaaa')).toEqual({
      action: 'pause',
      ok: true,
    });
  });

  it('menjalankan requestId yang sama hanya sekali', async () => {
    const { deps, music } = makeDeps();
    const message = raw({ kind: 'skip' }, 'request-bbbbbbbbbbbbbbbb');

    const first = await handleDashboardMusicCommand(deps, message, NOW);
    const second = await handleDashboardMusicCommand(deps, message, NOW);

    expect(first?.result.ok).toBe(true);
    expect(second).toBeNull();
    expect(music.skip).toHaveBeenCalledTimes(1);
  });

  it('menolak play saat user tidak berada di voice channel', async () => {
    const { deps, music, store } = makeDeps({
      botVoice: null,
      membership: { canManageGuild: false, memberRoleIds: [], voiceChannelId: null },
    });

    const handled = await handleDashboardMusicCommand(
      deps,
      raw({ kind: 'play', query: 'lofi', source: 'youtube' }, 'request-cccccccccccccccc'),
      NOW,
    );

    expect(handled?.result).toMatchObject({ ok: false, reason: 'no-voice' });
    expect(music.play).not.toHaveBeenCalled();
    expect(await readResult(store, 'request-cccccccccccccccc')).toMatchObject({ ok: false });
  });

  it('menolak kontrol saat user berada di voice channel yang berbeda', async () => {
    const { deps, music } = makeDeps({
      membership: { canManageGuild: false, memberRoleIds: [], voiceChannelId: OTHER_VOICE },
    });

    const handled = await handleDashboardMusicCommand(deps, raw({ kind: 'pause' }), NOW);

    expect(handled?.result).toMatchObject({ ok: false, reason: 'not-same-voice-channel' });
    expect(music.setPaused).not.toHaveBeenCalled();
  });

  it('menolak pengguna tanpa role DJ saat server mengatur role DJ', async () => {
    const { deps, music } = makeDeps({
      djRoleId: '555555555555555555',
      membership: { canManageGuild: false, memberRoleIds: [], voiceChannelId: BOT_VOICE },
    });

    const handled = await handleDashboardMusicCommand(deps, raw({ kind: 'pause' }), NOW);

    expect(handled?.result).toMatchObject({ ok: false, reason: 'need-dj-role' });
    expect(music.setPaused).not.toHaveBeenCalled();
  });

  it('pemegang role DJ boleh mengontrol walau tidak punya Manage Server', async () => {
    const djRole = '555555555555555555';
    const { deps } = makeDeps({
      djRoleId: djRole,
      membership: {
        canManageGuild: false,
        memberRoleIds: [djRole],
        voiceChannelId: BOT_VOICE,
      },
    });

    const handled = await handleDashboardMusicCommand(deps, raw({ kind: 'pause' }), NOW);

    expect(handled?.result).toEqual({ action: 'pause', ok: true });
  });

  it('menolak pause saat tidak ada player aktif', async () => {
    const { deps } = makeDeps({ botVoice: null });

    const handled = await handleDashboardMusicCommand(deps, raw({ kind: 'pause' }), NOW);

    expect(handled?.result).toMatchObject({ ok: false, reason: 'player-unavailable' });
  });

  it('meneruskan play ke MusicService dengan userId dari session', async () => {
    const { deps, music } = makeDeps();

    await handleDashboardMusicCommand(
      deps,
      raw({ kind: 'play', query: '  lofi  ', source: 'spotify' }, 'request-dddddddddddddddd'),
      NOW,
    );

    expect(music.play).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: GUILD,
        query: 'lofi',
        requesterId: USER,
        voiceChannelId: BOT_VOICE,
      }),
    );
  });

  it('mengembalikan hasil pencarian tanpa encoded', async () => {
    const { deps } = makeDeps({
      search: async () => ({ kind: 'ok', tracks: [dashboardTrack()] }),
    });

    const handled = await handleDashboardMusicCommand(
      deps,
      raw({ kind: 'search', query: 'lofi', source: 'youtube' }),
      NOW,
    );

    expect(handled?.result).toMatchObject({ action: 'search', ok: true });
    if (handled?.result.ok && handled.result.action === 'search') {
      expect(handled.result.tracks[0]).not.toHaveProperty('encoded');
    }
  });

  it('melaporkan jumlah gagal saat playlist dimuat sebagian', async () => {
    const { deps } = makeDeps();

    const handled = await handleDashboardMusicCommand(
      deps,
      raw({ kind: 'playlist', playlistId: 7 }, 'request-eeeeeeeeeeeeeeee'),
      NOW,
    );

    expect(handled?.result).toEqual({
      action: 'playlist',
      ok: true,
      started: true,
      added: 1,
      failed: 1,
      total: 2,
    });
  });

  it('menolak playlist kosong sebelum membuat player', async () => {
    const { deps, music } = makeDeps({
      loadPlaylist: async () => ({ kind: 'ok', playlistName: 'Kosong', tracks: [], failed: 0, total: 0 }),
    });

    const handled = await handleDashboardMusicCommand(
      deps,
      raw({ kind: 'playlist', playlistId: 8 }),
      NOW,
    );

    expect(handled?.result).toMatchObject({ ok: false, reason: 'empty' });
    expect(music.enqueue).not.toHaveBeenCalled();
  });

  it('menolak saat modul musik dimatikan', async () => {
    const { deps, music } = makeDeps({ configMusic: false });

    const handled = await handleDashboardMusicCommand(deps, raw({ kind: 'pause' }), NOW);

    expect(handled?.result).toMatchObject({ ok: false, reason: 'music-disabled' });
    expect(music.setPaused).not.toHaveBeenCalled();
  });

  it('menolak saat keanggotaan tidak bisa dibaca gateway', async () => {
    const { deps } = makeDeps({ membership: null });

    const handled = await handleDashboardMusicCommand(deps, raw({ kind: 'pause' }), NOW);

    expect(handled?.result).toMatchObject({ ok: false, reason: 'permission-unknown' });
  });
});
