import { describe, expect, it } from 'vitest';
import {
  MAX_OPTION_DESCRIPTION_LENGTH,
  MAX_OPTION_LABEL_LENGTH,
  SEARCH_SESSION_TTL_MS,
  SearchSessionStore,
  clampOptionText,
  formatSeconds,
  parseSearchCustomId,
  parseSearchOptionValue,
  searchOptionDescription,
  searchOptionLabel,
  searchOptionValue,
  searchSelectCustomId,
  sessionKey,
  SEARCH_SELECT_PREFIX,
} from '../src/modules/music/searchSession.js';
import { SEARCH_RESULT_LIMIT } from '../src/modules/music/selection.js';
import { decodeSearchSession } from '../src/modules/music/searchSessionCodec.js';
import { MemoryKeyValueStore, type KeyValueStore } from '../src/services/kvStore.js';
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

/** Store yang selalu gagal, untuk menguji jalur error tanpa Redis sungguhan. */
class BrokenStore implements KeyValueStore {
  async get(): Promise<string | null> {
    throw new Error('store mati');
  }

  async set(): Promise<void> {
    throw new Error('store mati');
  }

  async delete(): Promise<void> {
    throw new Error('store mati');
  }

  async take(): Promise<string | null> {
    throw new Error('store mati');
  }

  async increment(): Promise<number> {
    throw new Error('store mati');
  }

  async close(): Promise<void> {
    // Tidak ada koneksi yang perlu ditutup.
  }
}

/** Store yang bisa dibaca tapi gagal tepat saat session diklaim. */
class FlakyClaimStore extends MemoryKeyValueStore {
  override async take(): Promise<string | null> {
    throw new Error('klaim gagal');
  }
}

/**
 * Store dengan jam dan token yang bisa dikendalikan tes.
 *
 * Jam disuntik supaya kedaluwarsa bisa diuji tanpa menunggu-menunggu waktu asli,
 * dan `kv` bisa diganti untuk membuktikan session benar-benar hidup di store
 * bersama (bukan di memori proses) — syarat agar select menu tetap bekerja
 * begitu bot di-sharding.
 */
function makeStore(options: { ttlMs?: number; kv?: KeyValueStore } = {}) {
  let clock = 1_000;
  let counter = 0;
  const kv = options.kv ?? new MemoryKeyValueStore();

  const store = new SearchSessionStore({
    store: kv,
    now: () => clock,
    ttlMs: options.ttlMs ?? 15 * 60_000,
    tokenFactory: () => `0000${(counter += 1).toString(16).padStart(3, '0')}`,
  });

  return { store, kv, advance: (ms: number) => (clock += ms) };
}

const GUILD = 'guild-1';
const USER = 'user-1';

interface PutOverrides {
  guildId?: string;
  requesterId?: string;
  query?: string;
  tracks?: readonly TrackInfo[];
}

/** Simpan session; `null` di test berarti ada yang salah, bukan keadaan normal. */
async function put(store: SearchSessionStore, overrides: PutOverrides = {}) {
  const session = await store.put({
    guildId: GUILD,
    requesterId: USER,
    query: 'a',
    tracks: tracks(1),
    ...overrides,
  });

  if (!session) throw new Error('session tidak tersimpan');
  return session;
}

describe('SearchSessionStore.put', () => {
  it('menyimpan hasil pencarian dengan query yang sudah dirapikan', async () => {
    const { store } = makeStore();

    const session = await put(store, { query: '  jazz/vietnam  ' });

    expect(session.query).toBe('jazz/vietnam');
    expect(session.tracks).toHaveLength(1);
    expect(await store.peek(session.token)).toBeDefined();
  });

  it('memotong hasil jadi batas PRD lima', async () => {
    const { store } = makeStore();

    const session = await put(store, { query: 'panjang', tracks: tracks(12) });

    expect(SEARCH_RESULT_LIMIT).toBe(5);
    expect(session.tracks).toHaveLength(SEARCH_RESULT_LIMIT);
  });

  it('memberi token berbeda untuk setiap pencarian', async () => {
    const { store } = makeStore();

    const first = await put(store, { query: 'a' });
    const second = await put(store, { query: 'b' });

    expect(first.token).not.toBe(second.token);
  });

  it('menulis session ke store bersama dengan masa berlaku', async () => {
    const kv = new MemoryKeyValueStore();
    const writes: { key: string; ttlMs: number | undefined }[] = [];
    const store = new SearchSessionStore({
      store: {
        get: (key) => kv.get(key),
        set: (key, value, options) => {
          writes.push({ key, ttlMs: options?.ttlMs });
          return kv.set(key, value, options);
        },
        delete: (key) => kv.delete(key),
        take: (key) => kv.take(key),
        increment: (key, options) => kv.increment(key, options),
        close: () => kv.close(),
      },
      tokenFactory: () => 'aabbccdd',
    });

    const session = await put(store);

    expect(writes[0]?.key).toBe('harmony:searchsession:aabbccdd');
    expect(writes[0]?.ttlMs).toBe(SEARCH_SESSION_TTL_MS);

    const raw = await kv.get(sessionKey(session.token));
    expect(decodeSearchSession(raw)).toEqual(session);
  });

  it('berhasil null saat store bermasalah, jadi pemanggil meminta user mengulang', async () => {
    const store = new SearchSessionStore({ store: new BrokenStore() });

    const session = await store.put({
      guildId: GUILD,
      requesterId: USER,
      query: 'a',
      tracks: tracks(1),
    });

    expect(session).toBeNull();
    expect(store.size).toBe(0);
  });

  it('session dibaca proses lain yang memakai store yang sama', async () => {
    const kv = new MemoryKeyValueStore();
    const writer = new SearchSessionStore({ store: kv, tokenFactory: () => 'aabbccdd' });
    const reader = new SearchSessionStore({ store: kv, tokenFactory: () => '11223344' });

    const session = await put(writer);

    const seen = await reader.peek(session.token);
    expect(seen?.tracks).toEqual(session.tracks);
  });
});

describe('SearchSessionStore masa hidup', () => {
  it('session hilang setelah melewati TTL', async () => {
    const { store, kv, advance } = makeStore();

    const session = await put(store);
    expect(await store.peek(session.token)).toBeDefined();

    advance(15 * 60_000 + 1);

    expect(await store.peek(session.token)).toBeUndefined();
    expect(store.size).toBe(0);
    expect(await kv.get(sessionKey(session.token))).toBeNull();
  });

  it('session tepat di batas TTL sudah dianggap kedaluwarsa', async () => {
    const { store, advance } = makeStore();

    const session = await put(store);
    advance(15 * 60_000);

    expect(await store.peek(session.token)).toBeUndefined();
  });

  it('session yang belum melewati TTL masih bisa dipakai', async () => {
    const { store, advance } = makeStore();

    const session = await put(store);
    advance(15 * 60_000 - 1);

    const selection = await store.take({
      token: session.token,
      guildId: GUILD,
      userId: USER,
      index: 0,
    });

    expect(selection.kind).toBe('ok');
  });

  it('umur session mengikuti TTL yang disuntik, bukan konstanta module', async () => {
    const { store, advance } = makeStore({ ttlMs: 1_000 });

    const session = await put(store);
    advance(999);

    expect(await store.peek(session.token)).toBeDefined();

    advance(2);

    expect(await store.peek(session.token)).toBeUndefined();
  });

  it('prune mengembalikan jumlah session yang dibuang', async () => {
    const { store, advance } = makeStore();

    await put(store, { query: 'a' });
    await put(store, { query: 'b' });
    advance(15 * 60_000 + 1);

    expect(await store.prune()).toBe(2);
    expect(store.size).toBe(0);
  });

  it('clear mengosongkan semua session, termasuk di store', async () => {
    const { store, kv } = makeStore();

    const session = await put(store);
    await store.clear();

    expect(store.size).toBe(0);
    expect(await kv.get(sessionKey(session.token))).toBeNull();
  });

  it('clear tidak melempar saat store sedang bermasalah', async () => {
    const store = new SearchSessionStore({ store: new FlakyClaimStore() });

    await put(store);
    await expect(store.clear()).resolves.toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('delete membuang satu session dari store', async () => {
    const { store, kv } = makeStore();

    const session = await put(store);
    await store.delete(session.token);

    expect(await store.peek(session.token)).toBeUndefined();
    expect(await kv.get(sessionKey(session.token))).toBeNull();
  });

  it('daftar token disapu sendiri secara berkala', async () => {
    const { store, advance } = makeStore();

    for (let index = 0; index < 64; index += 1) await put(store);
    advance(15 * 60_000 + 1);
    for (let index = 0; index < 64; index += 1) await put(store);

    // Penyapuan sengaja tidak di-await (nilai kembaliannya tidak dipakai), jadi
    // tes menunggu antrean microtask selesai dulu sebelum menghitung.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Tanpa penyapuan, daftar akan berisi 128 token lama dan baru.
    expect(store.size).toBe(64);
  });

  it('daftar token tidak pernah tumbuh tanpa batas', async () => {
    const { store } = makeStore();

    for (let index = 0; index < 210; index += 1) await put(store);

    expect(store.size).toBeLessThanOrEqual(200);
  });
});

describe('SearchSessionStore.take', () => {
  it('mengembalikan lagu yang dipilih', async () => {
    const { store } = makeStore();
    const list = tracks(3);
    const session = await put(store, { tracks: list });

    const selection = await store.take({
      token: session.token,
      guildId: GUILD,
      userId: USER,
      index: 1,
    });

    expect(selection).toEqual({ kind: 'ok', track: list[1] });
  });

  it('membuang session setelah dipakai supaya tidak bisa dipilih dua kali', async () => {
    const { store } = makeStore();
    const session = await put(store, { tracks: tracks(2) });

    const first = await store.take({
      token: session.token,
      guildId: GUILD,
      userId: USER,
      index: 0,
    });
    expect(first.kind).toBe('ok');

    const second = await store.take({
      token: session.token,
      guildId: GUILD,
      userId: USER,
      index: 0,
    });
    expect(second.kind).toBe('expired');
    expect(store.size).toBe(0);
  });

  it('hanya satu proses yang bisa memakai session yang sama', async () => {
    const kv = new MemoryKeyValueStore();
    const shardA = new SearchSessionStore({ store: kv, tokenFactory: () => 'aabbccdd' });
    const shardB = new SearchSessionStore({ store: kv, tokenFactory: () => '11223344' });
    const session = await put(shardA);

    // Dua klik yang sama-sama diproses dua proses(shard) berbeda.
    const [first, second] = await Promise.all([
      shardA.take({ token: session.token, guildId: GUILD, userId: USER, index: 0 }),
      shardB.take({ token: session.token, guildId: GUILD, userId: USER, index: 0 }),
    ]);

    const kinds = [first.kind, second.kind].sort();
    expect(kinds).toEqual(['expired', 'ok']);
  });

  it('menolak user lain', async () => {
    const { store } = makeStore();
    const session = await put(store, { tracks: tracks(2) });

    const selection = await store.take({
      token: session.token,
      guildId: GUILD,
      userId: 'user-2',
      index: 0,
    });

    expect(selection.kind).toBe('not-owner');
  });

  it('menolak guild lain', async () => {
    const { store } = makeStore();
    const session = await put(store, { tracks: tracks(2) });

    const selection = await store.take({
      token: session.token,
      guildId: 'guild-2',
      userId: USER,
      index: 0,
    });

    expect(selection.kind).toBe('other-guild');
  });

  it('menolak indeks di luar daftar', async () => {
    const { store } = makeStore();
    const session = await put(store, { tracks: tracks(2) });

    const selection = await store.take({
      token: session.token,
      guildId: GUILD,
      userId: USER,
      index: 9,
    });

    expect(selection.kind).toBe('bad-index');
  });

  it('session yang ditolak karena salah pemilik masih bisa dipakai pemiliknya', async () => {
    const { store } = makeStore();
    const list = tracks(2);
    const session = await put(store, { tracks: list });

    await store.take({ token: session.token, guildId: GUILD, userId: 'user-2', index: 0 });

    const ok = await store.take({
      token: session.token,
      guildId: GUILD,
      userId: USER,
      index: 0,
    });
    expect(ok).toEqual({ kind: 'ok', track: list[0] });
  });

  it('token yang tidak dikenal dianggap kedaluwarsa', async () => {
    const { store } = makeStore();

    const selection = await store.take({
      token: 'deadbeef',
      guildId: GUILD,
      userId: USER,
      index: 0,
    });

    expect(selection.kind).toBe('expired');
  });

  it('session rusak di store dianggap kedaluwarsa, bukan error', async () => {
    const { store, kv } = makeStore();
    await kv.set(sessionKey('deadbeef'), '{bukan json');

    const selection = await store.take({
      token: 'deadbeef',
      guildId: GUILD,
      userId: USER,
      index: 0,
    });

    expect(selection.kind).toBe('expired');
  });

  it('store bermasalah tidak pernah menggagalkan select menu', async () => {
    const broken = new SearchSessionStore({ store: new BrokenStore() });

    const selection = await broken.take({
      token: 'deadbeef',
      guildId: GUILD,
      userId: USER,
      index: 0,
    });

    expect(selection.kind).toBe('expired');
  });

  it('gagal saat mengklaim session diperlakukan sebagai sudah dipakai', async () => {
    const store = new SearchSessionStore({ store: new FlakyClaimStore() });
    const session = await put(store);

    const selection = await store.take({
      token: session.token,
      guildId: GUILD,
      userId: USER,
      index: 0,
    });

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