import { describe, expect, it } from 'vitest';
import {
  MAX_OPTION_DESCRIPTION_LENGTH,
  MAX_OPTION_LABEL_LENGTH,
  SEARCH_RESULT_LIMIT,
  SearchSessionStore,
  clampOptionText,
  formatSeconds,
  parseSearchCustomId,
  parseSearchOptionValue,
  searchOptionDescription,
  searchOptionLabel,
  searchOptionValue,
  searchSelectCustomId,
  SEARCH_SELECT_PREFIX,
} from '../src/modules/music/searchSession.js';
import type { TrackInfo } from '../src/modules/music/types.js';

function track(overrides: Partial<TrackInfo> = {}): TrackInfo {
  return {
    encoded: 'encoded-1',
    title: 'Lagu Satu',
    author: 'Artis Satu',
    durationMs: 210_000,
    uri: null,
    artworkUrl: null,
    isStream: false,
    requesterId: '123456789012345678',
    ...overrides,
  };
}

function tracks(count: number): TrackInfo[] {
  return Array.from({ length: count }, (_, index) =>
    track({ encoded: `encoded-${index}`, title: `Lagu ${index}` }),
  );
}

/**
 * Store dengan waktu dan token yang bisa dikendalikan tes.
 *
 * `advance` menggerakkan jam internal supaya kedaluwarsa bisa diuji tanpa
 * menunggu-menunggu waktu asli.
 */
function makeStore(options: { maxSessions?: number } = {}) {
  let clock = 1_000;
  let counter = 0;

  const store = new SearchSessionStore({
    now: () => clock,
    maxSessions: options.maxSessions,
    tokenFactory: () => `0000${(counter += 1).toString(16).padStart(3, '0')}`,
  });

  return { store, advance: (ms: number) => (clock += ms) };
}

const GUILD = 'guild-1';
const USER = 'user-1';

describe('SearchSessionStore.put', () => {
  it('menyimpan hasil pencarian dengan query yang sudah dirapikan', () => {
    const { store } = makeStore();

    const session = store.put({
      guildId: GUILD,
      requesterId: USER,
      query: '  jazz/vietnam  ',
      tracks: tracks(1),
    });

    expect(session.query).toBe('jazz/vietnam');
    expect(session.tracks).toHaveLength(1);
    expect(store.peek(session.token)).toBeDefined();
  });

  it('memotong hasil jadi batas PRD lima', () => {
    const { store } = makeStore();

    const session = store.put({
      guildId: GUILD,
      requesterId: USER,
      query: 'panjang',
      tracks: tracks(12),
    });

    expect(SEARCH_RESULT_LIMIT).toBe(5);
    expect(session.tracks).toHaveLength(SEARCH_RESULT_LIMIT);
  });

  it('memberi token berbeda untuk setiap pencarian', () => {
    const { store } = makeStore();

    const first = store.put({ guildId: GUILD, requesterId: USER, query: 'a', tracks: tracks(1) });
    const second = store.put({ guildId: GUILD, requesterId: USER, query: 'b', tracks: tracks(1) });

    expect(first.token).not.toBe(second.token);
  });

  it('membuang session tertua saat melewati batas kapasitas', () => {
    const { store } = makeStore({ maxSessions: 2 });

    const first = store.put({ guildId: GUILD, requesterId: USER, query: 'a', tracks: tracks(1) });
    store.put({ guildId: GUILD, requesterId: USER, query: 'b', tracks: tracks(1) });
    const third = store.put({ guildId: GUILD, requesterId: USER, query: 'c', tracks: tracks(1) });

    expect(store.size).toBe(2);
    expect(store.peek(first.token)).toBeUndefined();
    expect(store.peek(third.token)).toBeDefined();
  });
});

describe('SearchSessionStore masa hidup', () => {
  it('menyapuan session yang sudah melewati TTL', () => {
    const { store, advance } = makeStore();

    const session = store.put({ guildId: GUILD, requesterId: USER, query: 'a', tracks: tracks(1) });
    const before = store.peek(session.token);
    expect(before).toBeDefined();

    advance(15 * 60_000 + 1);

    expect(store.peek(session.token)).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('session tepat di batas TTL sudah dianggap kedaluwarsa', () => {
    const { store, advance } = makeStore();

    const session = store.put({ guildId: GUILD, requesterId: USER, query: 'a', tracks: tracks(1) });
    advance(15 * 60_000);

    expect(store.peek(session.token)).toBeUndefined();
  });

  it('session yang belum melewati TTL masih bisa dipakai', () => {
    const { store, advance } = makeStore();

    const session = store.put({ guildId: GUILD, requesterId: USER, query: 'a', tracks: tracks(1) });
    advance(15 * 60_000 - 1);

    expect(store.take({ token: session.token, guildId: GUILD, userId: USER, index: 0 }).kind).toBe('ok');
  });

  it('prune mengembalikan jumlah session yang dibuang', () => {
    const { store, advance } = makeStore();

    store.put({ guildId: GUILD, requesterId: USER, query: 'a', tracks: tracks(1) });
    store.put({ guildId: GUILD, requesterId: USER, query: 'b', tracks: tracks(1) });
    advance(15 * 60_000 + 1);

    expect(store.prune()).toBe(2);
    expect(store.size).toBe(0);
  });

  it('clear mengosongkan semua session', () => {
    const { store } = makeStore();

    store.put({ guildId: GUILD, requesterId: USER, query: 'a', tracks: tracks(1) });
    store.clear();

    expect(store.size).toBe(0);
  });
});

describe('SearchSessionStore.take', () => {
  it('mengembalikan lagu yang dipilih', () => {
    const { store } = makeStore();
    const list = tracks(3);
    const session = store.put({
      guildId: GUILD,
      requesterId: USER,
      query: 'a',
      tracks: list,
    });

    const selection = store.take({ token: session.token, guildId: GUILD, userId: USER, index: 1 });

    expect(selection).toEqual({ kind: 'ok', track: list[1] });
  });

  it('membuang session setelah dipakai supaya tidak bisa dipilih dua kali', () => {
    const { store } = makeStore();
    const session = store.put({
      guildId: GUILD,
      requesterId: USER,
      query: 'a',
      tracks: tracks(2),
    });

    expect(store.take({ token: session.token, guildId: GUILD, userId: USER, index: 0 }).kind).toBe('ok');

    const second = store.take({ token: session.token, guildId: GUILD, userId: USER, index: 0 });
    expect(second.kind).toBe('expired');
    expect(store.size).toBe(0);
  });

  it('menolak user lain', () => {
    const { store } = makeStore();
    const session = store.put({
      guildId: GUILD,
      requesterId: USER,
      query: 'a',
      tracks: tracks(2),
    });

    const selection = store.take({ token: session.token, guildId: GUILD, userId: 'user-2', index: 0 });

    expect(selection.kind).toBe('not-owner');
  });

  it('menolak guild lain', () => {
    const { store } = makeStore();
    const session = store.put({
      guildId: GUILD,
      requesterId: USER,
      query: 'a',
      tracks: tracks(2),
    });

    const selection = store.take({ token: session.token, guildId: 'guild-2', userId: USER, index: 0 });

    expect(selection.kind).toBe('other-guild');
  });

  it('menolak indeks di luar daftar', () => {
    const { store } = makeStore();
    const session = store.put({
      guildId: GUILD,
      requesterId: USER,
      query: 'a',
      tracks: tracks(2),
    });

    const selection = store.take({ token: session.token, guildId: GUILD, userId: USER, index: 9 });

    expect(selection.kind).toBe('bad-index');
  });

  it('session yang ditolak karena salah pemilik masih bisa dipakai pemiliknya', () => {
    const { store } = makeStore();
    const list = tracks(2);
    const session = store.put({
      guildId: GUILD,
      requesterId: USER,
      query: 'a',
      tracks: list,
    });

    store.take({ token: session.token, guildId: GUILD, userId: 'user-2', index: 0 });

    const ok = store.take({ token: session.token, guildId: GUILD, userId: USER, index: 0 });
    expect(ok).toEqual({ kind: 'ok', track: list[0] });
  });

  it('token yang tidak dikenal dianggap kedaluwarsa', () => {
    const { store } = makeStore();

    const selection = store.take({ token: 'deadbeef', guildId: GUILD, userId: USER, index: 0 });

    expect(selection.kind).toBe('expired');
  });
});

describe('parseSearchCustomId', () => {
  it('membaca kembali token yang dibuat', () => {
    const token = '0a1b2c3d4e5f6071';

    expect(searchSelectCustomId(token)).toBe(`${SEARCH_SELECT_PREFIX}${token}`);
    expect(parseSearchCustomId(searchSelectCustomId(token))).toBe(token);
  });

  it('menolak customId milik fitur lain', () => {
    for (const customId of ['rr:panel-1', 'ticket:create', 'musicsearch:', 'panel-1']) {
      expect(parseSearchCustomId(customId)).toBeNull();
    }
  });

  it('menolak token yang bukan hex', () => {
    expect(parseSearchCustomId(`${SEARCH_SELECT_PREFIX}zzz`)).toBeNull();
    expect(parseSearchCustomId(`${SEARCH_SELECT_PREFIX}abc123`)).toBeNull();
  });
});

describe('parseSearchOptionValue', () => {
  it('membaca indeks dari nilai opsi', () => {
    expect(parseSearchOptionValue(searchOptionValue(0))).toBe(0);
    expect(parseSearchOptionValue(searchOptionValue(4))).toBe(4);
  });

  it('menolak nilai yang rusak supaya indeks NaN tidak pernah sampai ke antrean', () => {
    for (const value of ['', 'abc', '-1', '1.5', 'NaN', undefined, null]) {
      expect(parseSearchOptionValue(value)).toBeNull();
    }
  });
});

describe('opsi select menu', () => {
  it('label memakai judul lagu', () => {
    expect(searchOptionLabel(track({ title: 'Judul Lagu' }))).toBe('Judul Lagu');
  });

  it('label memotong judul yang terlalu panjang ke batas Discord', () => {
    const label = searchOptionLabel(track({ title: 'x'.repeat(300) }));

    expect(label.length).toBeLessThanOrEqual(MAX_OPTION_LABEL_LENGTH);
    expect(label.endsWith('…')).toBe(true);
  });

  it('description memuat artis dan durasi', () => {
    expect(searchOptionDescription(track({ author: 'Artis', durationMs: 225_000 }))).toBe(
      'Artis • 3:45',
    );
  });

  it('description tanpa artis tetap menampilkan durasi', () => {
    expect(searchOptionDescription(track({ author: '  ', durationMs: 60_000 }))).toBe('1:00');
  });

  it('description menulis live untuk durasi nol', () => {
    expect(searchOptionDescription(track({ author: 'Radio', durationMs: 0 }))).toBe('Radio • live');
  });

  it('description dipotong ke batas Discord', () => {
    const description = searchOptionDescription(
      track({ author: 'y'.repeat(300), durationMs: 1000 }),
    );

    expect(description.length).toBeLessThanOrEqual(MAX_OPTION_DESCRIPTION_LENGTH);
  });
});

describe('formatSeconds', () => {
  it('format menit dan detik', () => {
    expect(formatSeconds(3_000)).toBe('0:03');
    expect(formatSeconds(225_000)).toBe('3:45');
  });

  it('format jam ketika durasi melewati satu jam', () => {
    expect(formatSeconds(3_723_000)).toBe('1:02:03');
  });

  it('durasi nol atau tidak valid menjadi live', () => {
    expect(formatSeconds(0)).toBe('live');
    expect(formatSeconds(-5)).toBe('live');
    expect(formatSeconds(Number.NaN)).toBe('live');
  });
});

describe('clampOptionText', () => {
  it('memangkas teks panjang dan menambahkan elipsis', () => {
    const result = clampOptionText('abcdefghij', 5);

    expect(result).toBe('abcd…');
    expect(result.length).toBe(5);
  });

  it('tidak mengubah teks yang sudah cukup pendek', () => {
    expect(clampOptionText('  pendek  ', 50)).toBe('pendek');
  });
});