import { describe, expect, it } from 'vitest';
import type { DashboardTrack } from '@bot/modules/music/dashboard.js';
import { PLAYER_STATE_TTL_MS, type PlayerSnapshot } from '@bot/modules/music/playerState.js';
import type { TrackInfo } from '@bot/modules/music/types.js';
import {
  buildMusicState,
  formatDuration,
  interpolatePosition,
  isSnapshotFresh,
} from '@/lib/musicState.js';

const GUILD = '111111111111111111';
const OWNER = 'bot-a';
const NOW = 1_700_000_000_000;

function track(overrides: Partial<TrackInfo> = {}): TrackInfo {
  return {
    encoded: 'encoded-secret',
    title: 'Lagu Satu',
    author: 'Artis Satu',
    durationMs: 200_000,
    uri: 'https://www.youtube.com/watch?v=one',
    artworkUrl: 'https://i.ytimg.com/one.jpg',
    isStream: false,
    requesterId: '222222222222222222',
    ...overrides,
  };
}

function snapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    guildId: GUILD,
    owner: OWNER,
    state: 'playing',
    current: {
      title: 'Lagu Satu',
      author: 'Artis Satu',
      durationMs: 200_000,
      uri: 'https://www.youtube.com/watch?v=one',
      artworkUrl: null,
      isStream: false,
    },
    positionMs: 10_000,
    volume: 80,
    loopMode: 'off',
    lavalinkConnected: true,
    voiceChannelId: '333333333333333333',
    queueSize: 1,
    queue: [],
    capturedAt: NOW,
    ...overrides,
  };
}

const queue: TrackInfo[] = [track({ encoded: 'rahasia', title: 'Berikutnya' })];

describe('snapshot pemutar', () => {
  it('menerima snapshot yang segar dan dimiliki lease saat ini', () => {
    const result = buildMusicState({
      guildId: GUILD,
      snapshot: snapshot(),
      leaseOwner: OWNER,
      queue,
      loopMode: 'queue',
      now: NOW + 1_000,
    });

    expect(result.degraded).toBe(false);
    expect(result.player?.current?.title).toBe('Lagu Satu');
    expect(result.queue.loopMode).toBe('queue');
  });

  it('tidak membocorkan encoded ke peramban', () => {
    const result = buildMusicState({
      guildId: GUILD,
      snapshot: snapshot(),
      leaseOwner: OWNER,
      queue,
      loopMode: 'off',
      now: NOW,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('rahasia');
    expect((result.queue.tracks[0] as DashboardTrack & { encoded?: string }).encoded).toBeUndefined();
  });

  it('snapshot yang lebih tua dari TTL dianggap basi', () => {
    const result = buildMusicState({
      guildId: GUILD,
      snapshot: snapshot(),
      leaseOwner: OWNER,
      queue,
      loopMode: 'off',
      now: NOW + PLAYER_STATE_TTL_MS + 1,
    });

    expect(result.degraded).toBe(true);
    expect(result.reason).toBe('stale');
    expect(result.player).toBeNull();
    expect(isSnapshotFresh(snapshot(), NOW + PLAYER_STATE_TTL_MS)).toBe(true);
  });

  it('snapshot milik proses lain tidak ditampilkan sebagai player aktif', () => {
    const result = buildMusicState({
      guildId: GUILD,
      snapshot: snapshot({ owner: 'bot-lama' }),
      leaseOwner: OWNER,
      queue,
      loopMode: 'off',
      now: NOW,
    });

    expect(result.degraded).toBe(true);
    expect(result.reason).toBe('owner-mismatch');
    expect(result.player).toBeNull();
  });

  it('lease yang hilang juga berarti snapshot tidak boleh dipercaya', () => {
    const result = buildMusicState({
      guildId: GUILD,
      snapshot: snapshot(),
      leaseOwner: null,
      queue,
      loopMode: 'off',
      now: NOW,
    });

    expect(result.reason).toBe('owner-mismatch');
  });

  it('snapshot untuk guild lain ditolak meski belum kedaluwarsa', () => {
    const result = buildMusicState({
      guildId: GUILD,
      snapshot: snapshot({ guildId: '999999999999999999' }),
      leaseOwner: OWNER,
      queue,
      loopMode: 'off',
      now: NOW,
    });

    expect(result.reason).toBe('stale');
    expect(result.player).toBeNull();
  });

  it('store yang mati dilaporkan degraded, bukan sebagai player kosong biasa', () => {
    const result = buildMusicState({
      guildId: GUILD,
      snapshot: snapshot(),
      leaseOwner: OWNER,
      queue,
      loopMode: 'off',
      storeDown: true,
      now: NOW,
    });

    expect(result.degraded).toBe(true);
    expect(result.reason).toBe('shared-store-down');
    expect(result.player).toBeNull();
    expect(result.queue.tracks).toEqual([]);
  });

  it('tanpa snapshot berarti tidak ada player, bukan degraded', () => {
    const result = buildMusicState({
      guildId: GUILD,
      snapshot: null,
      leaseOwner: null,
      queue: [],
      loopMode: 'off',
      now: NOW,
    });

    expect(result.degraded).toBe(false);
    expect(result.reason).toBeNull();
    expect(result.player).toBeNull();
  });
});

describe('interpolasi progres', () => {
  it('menambahkan waktu berjalan sejak capturedAt', () => {
    expect(interpolatePosition(snapshot(), NOW + 5_000)).toBe(15_000);
  });

  it('membekukan posisi saat pause', () => {
    expect(interpolatePosition(snapshot({ state: 'paused' }), NOW + 5_000)).toBe(10_000);
  });

  it('tidak pernah melewati durasi lagu', () => {
    expect(interpolatePosition(snapshot({ positionMs: 199_500 }), NOW + 5_000)).toBe(200_000);
  });

  it('siaran langsung tidak dipotong durasinya', () => {
    const live = snapshot({
      current: { ...snapshot().current!, durationMs: 0, isStream: true },
    });

    expect(interpolatePosition(live, NOW + 5_000)).toBe(15_000);
  });

  it('idle atau tanpa lagu menampilkan nol', () => {
    expect(interpolatePosition(snapshot({ current: null, state: 'idle' }), NOW + 5_000)).toBe(0);
    expect(interpolatePosition(snapshot({ state: 'none', current: null }), NOW)).toBe(0);
  });

  it('format durasi menolak angka yang tidak bisa ditampilkan', () => {
    expect(formatDuration(0)).toBe('-');
    expect(formatDuration(Number.NaN)).toBe('-');
    expect(formatDuration(225_000)).toBe('3:45');
  });
});
