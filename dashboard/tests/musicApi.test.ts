import { describe, expect, it } from 'vitest';
import type { Playlist } from '@bot/modules/playlists/types.js';
import {
  failureStatus,
  parseMusicCommand,
  parseQuery,
  parseSearchSource,
} from '@/lib/musicApi.js';
import {
  parseMovePosition,
  parseTrackInput,
  playlistFailure,
  serializePlaylist,
} from '@/lib/playlists.js';

const OWNER = '222222222222222222';

function playlist(overrides: Partial<Playlist> = {}): Playlist {
  return {
    id: 4,
    guildId: '@personal',
    ownerId: OWNER,
    name: 'Lofi',
    tracks: [
      {
        title: 'Lagu Satu',
        author: 'Artis Satu',
        durationMs: 225_000,
        uri: 'https://www.youtube.com/watch?v=one',
        encoded: 'jangan-dikirim',
      },
      {
        title: 'Lagu Dua',
        author: 'Artis Dua',
        durationMs: 0,
        uri: null,
        encoded: null,
      },
    ],
    isPublic: false,
    scope: 'personal',
    createdAt: new Date('2026-11-23T00:00:00.000Z'),
    updatedAt: new Date('2026-11-23T01:00:00.000Z'),
    ...overrides,
  };
}

describe('validasi route musik', () => {
  it('hanya menerima kontrol yang memang diimplementasikan', () => {
    expect(parseMusicCommand({ kind: 'pause' })).toEqual({ kind: 'pause' });
    expect(parseMusicCommand({ kind: 'skip' })).toEqual({ kind: 'skip' });
    expect(parseMusicCommand({ kind: 'search', query: 'x', source: 'youtube' })).toBeNull();
    expect(parseMusicCommand({ kind: 'playlist', playlistId: 1 })).toBeNull();
    expect(parseMusicCommand({ kind: 'volume', level: 50 })).toEqual({ kind: 'volume', level: 50 });
    expect(parseMusicCommand({ kind: 'loop', mode: 'track' })).toEqual({ kind: 'loop', mode: 'track' });
    expect(parseMusicCommand({ kind: 'volume', level: 50.5 })).toBeNull();
    expect(parseMusicCommand({ kind: 'loop', mode: 'foo' })).toBeNull();
    expect(parseMusicCommand(null)).toBeNull();
  });

  it('merapikan query dan menolak query kosong atau terlalu panjang', () => {
    expect(parseQuery('  lofi  ')).toBe('lofi');
    expect(parseQuery('   ')).toBeNull();
    expect(parseQuery('x'.repeat(201))).toBeNull();
    expect(parseQuery(42)).toBeNull();
  });

  it('sumber yang tidak dikenal jatuh ke youtube, bukan diteruskan mentah', () => {
    expect(parseSearchSource('spotify')).toBe('spotify');
    expect(parseSearchSource('deezer')).toBeNull();
    expect(parseMusicCommand({ kind: 'play', query: 'lofi', source: 'deezer' })).toEqual({
      kind: 'play',
      query: 'lofi',
      source: 'youtube',
    });
  });
});

describe('status HTTP untuk kegagalan bot', () => {
  it('memetakan alasan otorisasi dan kepemilikan ke status yang tepat', () => {
    expect(failureStatus('need-dj-role')).toBe(403);
    expect(failureStatus('not-same-voice-channel')).toBe(403);
    expect(failureStatus('no-session')).toBe(401);
    expect(failureStatus('playlist-not-found')).toBe(404);
    expect(failureStatus('player-unavailable')).toBe(409);
    expect(failureStatus('shared-store-down')).toBe(503);
    expect(failureStatus('timeout')).toBe(504);
  });
});

describe('playlist personal dashboard', () => {
  it('serialisasi membuang encoded dan menomori lagu dari satu', () => {
    const serialized = serializePlaylist(playlist());

    expect(serialized.tracks.map((track) => track.position)).toEqual([1, 2]);
    expect(JSON.stringify(serialized)).not.toContain('jangan-dikirim');
    expect(serialized).toMatchObject({
      id: 4,
      name: 'Lofi',
      scope: 'personal',
      trackCount: 2,
      totalDurationMs: 225_000,
    });
  });

  it('menerima input lagu yang punya judul dan URL http', () => {
    const parsed = parseTrackInput([
      {
        title: '  Lagu Satu ',
        author: ' Artis ',
        durationMs: 225_000,
        uri: 'https://www.youtube.com/watch?v=one',
      },
    ]);

    expect(parsed).toHaveLength(1);
    expect(parsed?.[0]).toMatchObject({
      title: 'Lagu Satu',
      author: 'Artis',
      durationMs: 225_000,
      encoded: '',
    });
  });

  it('menolak encoded dari peramban dan URL non-http', () => {
    expect(
      parseTrackInput([{ title: 'Lagu', durationMs: 1, uri: 'javascript:alert(1)' }]),
    ).toBeNull();
    expect(parseTrackInput([{ title: 'Lagu', durationMs: 1, uri: 'https://x' }])).toHaveLength(1);
  });

  it('menolak input kosong atau melewati batas playlist', () => {
    expect(parseTrackInput([])).toBeNull();
    expect(parseTrackInput(null)).toBeNull();
    expect(
      parseTrackInput(
        Array.from({ length: 101 }, (_, index) => ({
          title: `Lagu ${index}`,
          durationMs: 1,
          uri: 'https://x',
        })),
      ),
    ).toBeNull();
  });

  it('hanya menerima posisi tujuan move yang valid', () => {
    expect(parseMovePosition(2)).toBe(2);
    expect(parseMovePosition(0)).toBeNull();
    expect(parseMovePosition(-1)).toBeNull();
    expect(parseMovePosition(1.5)).toBeNull();
    expect(parseMovePosition('2')).toBeNull();
  });

  it('memetakan kegagalan domain ke pesan yang bisa ditampilkan', () => {
    expect(playlistFailure({ kind: 'name-taken', name: 'Lofi' })).toMatchObject({
      status: 409,
      error: 'name-taken',
    });
    expect(playlistFailure({ kind: 'not-found' })).toMatchObject({ status: 404 });
    expect(playlistFailure({ kind: 'full', limit: 100 })).toMatchObject({ status: 422 });
  });
});
