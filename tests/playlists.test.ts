import { describe, expect, it } from 'vitest';
import { PlaylistService } from '../src/modules/playlists/service.js';
import type { PlaylistRepository } from '../src/modules/playlists/repository.js';
import {
  MAX_PLAYLIST_TRACKS,
  type CreatePlaylistInput,
  type Playlist,
  type StoredTrack,
} from '../src/modules/playlists/types.js';
import {
  parseStoredTracks,
  resolveStoredTracks,
  serializeTracks,
  toStoredTrack,
} from '../src/modules/playlists/tracks.js';
import { isSamePlaylistName, parsePlaylistName, PlaylistNameError } from '../src/modules/playlists/validation.js';
import { playlistDetailEmbed, playlistListEmbed, playlistSummary } from '../src/modules/playlists/embeds.js';
import { foundTracks } from '../src/modules/music/selection.js';
import type { SearchOutcome, TrackInfo } from '../src/modules/music/types.js';

const GUILD = '111111111111111111';
const OWNER = '222222222222222222';
const STRANGER = '333333333333333333';

function stored(overrides: Partial<StoredTrack> = {}): StoredTrack {
  return {
    title: 'Lagu Satu',
    author: 'Artis Satu',
    durationMs: 225_000,
    uri: 'https://youtu.be/one',
    encoded: 'encoded-one',
    ...overrides,
  };
}

function track(overrides: Partial<TrackInfo> = {}): TrackInfo {
  return {
    encoded: 'encoded-one',
    title: 'Lagu Satu',
    author: 'Artis Satu',
    durationMs: 225_000,
    uri: 'https://youtu.be/one',
    artworkUrl: null,
    isStream: false,
    requesterId: OWNER,
    ...overrides,
  };
}

function playlist(overrides: Partial<Playlist> = {}): Playlist {
  return {
    id: 1,
    guildId: GUILD,
    ownerId: OWNER,
    name: 'Lofi',
    tracks: [],
    isPublic: false,
    createdAt: new Date('2026-10-03T00:00:00.000Z'),
    updatedAt: new Date('2026-10-03T00:00:00.000Z'),
    ...overrides,
  };
}

/** Repository palsu: menyimpan baris di memori dengan aturan yang sama. */
class FakePlaylistRepository implements PlaylistRepository {
  public readonly rows: Playlist[] = [];
  private nextId = 1;

  async create(input: CreatePlaylistInput, now: Date): Promise<Playlist> {
    const created = playlist({
      id: this.nextId++,
      guildId: input.guildId,
      ownerId: input.ownerId,
      name: input.name,
      tracks: [],
      createdAt: now,
      updatedAt: now,
    });

    this.rows.push(created);
    return { ...created };
  }

  async findByName(guildId: string, ownerId: string, name: string): Promise<Playlist | null> {
    const found = this.rows.find(
      (row) => row.guildId === guildId && row.ownerId === ownerId && isSamePlaylistName(row.name, name),
    );

    return found ? { ...found } : null;
  }

  async findPublicByName(guildId: string, name: string): Promise<Playlist | null> {
    const found = this.rows.find(
      (row) => row.guildId === guildId && row.isPublic && isSamePlaylistName(row.name, name),
    );

    return found ? { ...found } : null;
  }

  async listOwned(guildId: string, ownerId: string, take: number): Promise<Playlist[]> {
    return this.rows
      .filter((row) => row.guildId === guildId && row.ownerId === ownerId)
      .slice(0, take)
      .map((row) => ({ ...row }));
  }

  async listPublic(guildId: string, take: number): Promise<Playlist[]> {
    return this.rows
      .filter((row) => row.guildId === guildId && row.isPublic)
      .slice(0, take)
      .map((row) => ({ ...row }));
  }

  async appendTracks(id: number, tracks: readonly StoredTrack[]): Promise<Playlist | null> {
    return this.mutate(id, (row) => ({ ...row, tracks: [...row.tracks, ...serializeTracks(tracks)] }));
  }

  async removeTrackAt(id: number, index: number): Promise<Playlist | null> {
    return this.mutate(id, (row) => ({
      ...row,
      tracks: row.tracks.filter((_, i) => i !== index),
    }));
  }

  async setPublic(id: number, isPublic: boolean): Promise<Playlist | null> {
    return this.mutate(id, (row) => ({ ...row, isPublic }));
  }

  async delete(id: number): Promise<boolean> {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index === -1) return false;

    this.rows.splice(index, 1);
    return true;
  }

  async countByOwner(guildId: string, ownerId: string): Promise<number> {
    return this.rows.filter((row) => row.guildId === guildId && row.ownerId === ownerId).length;
  }

  async anonymizeOwner(guildId: string, ownerId: string, pseudonym: string): Promise<number> {
    const affected = this.rows.filter((row) => row.guildId === guildId && row.ownerId === ownerId);
    for (const row of affected) row.ownerId = pseudonym;

    return affected.length;
  }

  private async mutate(id: number, change: (row: Playlist) => Playlist): Promise<Playlist | null> {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index === -1) return null;

    const updated = change(this.rows[index] as Playlist);
    this.rows[index] = updated;
    return { ...updated };
  }
}

function service() {
  const repository = new FakePlaylistRepository();
  return { repository, playlists: new PlaylistService(repository) };
}

/** Hasilkan `ok` atau lempar kegagalan — biar tes tetap pendek. */
function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(`diharapkan berhasil, dapat: ${JSON.stringify(result.error)}`);

  return result.value;
}

describe('parsePlaylistName', () => {
  it('meratakan spasi berulang dan memangkas tepi', () => {
    expect(parsePlaylistName('  lofi   beat  ')).toBe('lofi beat');
  });

  it('menolak nama kosong', () => {
    expect(() => parsePlaylistName('   ')).toThrow(PlaylistNameError);
  });

  it('menolak nama terlalu panjang dengan menyebut panjangnya', () => {
    try {
      parsePlaylistName('x'.repeat(80));
      expect.unreachable('nama sepanjang itu harus ditolak');
    } catch (error) {
      expect(error).toBeInstanceOf(PlaylistNameError);
      expect((error as Error).message).toContain('80');
    }
  });

  it('nama dengan huruf besar-kecil berbeda dianggap sama', () => {
    expect(isSamePlaylistName('Lofi', 'lofi')).toBe(true);
    expect(isSamePlaylistName('Lofi', 'LOFI BEAT')).toBe(false);
  });
});

describe('parseStoredTracks', () => {
  it('membaca JSON yang sehat', () => {
    const parsed = parseStoredTracks([
      { title: 'Lagu', author: 'Artis', durationMs: 1000, uri: 'https://x', encoded: 'e' },
    ]);

    expect(parsed).toEqual([
      { title: 'Lagu', author: 'Artis', durationMs: 1000, uri: 'https://x', encoded: 'e' },
    ]);
  });

  it('kolom yang bukan array dianggap playlist kosong, bukan error', () => {
    for (const value of [null, undefined, 42, 'teks', { tracks: [] }]) {
      expect(parseStoredTracks(value)).toEqual([]);
    }
  });

  it('membuang entri tanpa judul, bukan membatalkan seluruh playlist', () => {
    const parsed = parseStoredTracks([
      { title: 'Yang Baik', uri: 'https://a' },
      { title: '' },
      { title: null },
      'bukan objek',
      null,
    ]);

    expect(parsed.map((item) => item.title)).toEqual(['Yang Baik']);
  });

  it('durasi rusak dianggap tidak diketahui, bukan dianggap bisa dijumlahkan', () => {
    const parsed = parseStoredTracks([
      { title: 'A', durationMs: 'banyak' },
      { title: 'B', durationMs: -5 },
    ]);

    expect(parsed.map((item) => item.durationMs)).toEqual([0, 0]);
  });

  it('uri dan encoded kosong menjadi null', () => {
    const parsed = parseStoredTracks([{ title: 'A', uri: '', encoded: '' }]);

    expect(parsed[0]?.uri).toBeNull();
    expect(parsed[0]?.encoded).toBeNull();
  });
});

describe('serializeTracks', () => {
  it('memotong daftar ke batas maksimum playlist', () => {
    const many = Array.from({ length: MAX_PLAYLIST_TRACKS + 20 }, (_, i) =>
      stored({ title: `Lagu ${i}` }),
    );

    expect(serializeTracks(many)).toHaveLength(MAX_PLAYLIST_TRACKS);
  });
});

describe('toStoredTrack', () => {
  it('menyimpan durasi 0 untuk siaran langsung', () => {
    expect(toStoredTrack(track({ isStream: true, durationMs: 999 })).durationMs).toBe(0);
  });
});

describe('resolveStoredTracks', () => {
  const raw = (encoded: string, title: string) => ({
    encoded,
    info: { title, author: 'Artis', length: 1000, isStream: false, uri: 'https://x' },
  });

  it('resolve lewat uri, bukan memakai encoded yang tersimpan', async () => {
    const seen: string[] = [];
    const resolve = async (uri: string): Promise<SearchOutcome> => {
      seen.push(uri);
      return foundTracks([raw('fresh', 'Judul Baru')]);
    };

    const result = await resolveStoredTracks([stored({ encoded: 'lama' })], resolve, OWNER);

    expect(seen).toEqual(['https://youtu.be/one']);
    expect(result.tracks[0]?.encoded).toBe('fresh');
    expect(result.failed).toBe(0);
  });

  it('encoded basi tidak membuat playlist gagal — urioloads ulang metadata', async () => {
    const resolve = async (): Promise<SearchOutcome> =>
      foundTracks([raw('encoded-baru', 'Judul dari Lavalink')]);

    const result = await resolveStoredTracks(
      [stored({ uri: 'https://youtu.be/one', encoded: 'encoded-basi' })],
      resolve,
      OWNER,
    );

    expect(result.tracks[0]?.title).toBe('Judul dari Lavalink');
    expect(result.tracks[0]?.encoded).toBe('encoded-baru');
  });

  it('memakai encoded hanya saat uri tidak ada, tanpa memanggil Lavalink', async () => {
    let calls = 0;
    const resolve = async (): Promise<SearchOutcome> => {
      calls += 1;
      return { kind: 'empty' };
    };

    const result = await resolveStoredTracks([stored({ uri: null, encoded: 'saja' })], resolve, OWNER);

    expect(calls).toBe(0);
    expect(result.tracks[0]?.encoded).toBe('saja');
    expect(result.failed).toBe(0);
  });

  it('entri tanpa uri dan tanpa encoded dihitung gagal', async () => {
    const result = await resolveStoredTracks(
      [stored({ uri: null, encoded: null })],
      async () => foundTracks([raw('x', 'x')]),
      OWNER,
    );

    expect(result.tracks).toHaveLength(0);
    expect(result.failed).toBe(1);
  });

  it('menghitung lagu yang ditolak Lavalink sebagai gagal, bukan memutar diam-diam', async () => {
    const resolve = async (uri: string): Promise<SearchOutcome> =>
      uri.includes('gagal') ? { kind: 'error', message: 'dibatasi sumber' } : foundTracks([raw('ok', 'Lagu')]);

    const result = await resolveStoredTracks(
      [stored({ uri: 'https://youtu.be/oke' }), stored({ uri: 'https://youtu.be/gagal' })],
      resolve,
      OWNER,
    );

    expect(result.tracks).toHaveLength(1);
    expect(result.failed).toBe(1);
  });

  it('urutan antrean tetap sama seperti urutan playlist, walau resolve paralel', async () => {
    const entries = Array.from({ length: 12 }, (_, i) =>
      stored({ title: `Lagu ${i}`, uri: `https://youtu.be/${i}` }),
    );

    const resolve = async (uri: string): Promise<SearchOutcome> => {
      await new Promise((done) => setTimeout(done, uri.endsWith('0') ? 8 : 0));
      return foundTracks([raw(`e-${uri}`, uri)]);
    };

    const result = await resolveStoredTracks(entries, resolve, OWNER);

    expect(result.tracks.map((item) => item.encoded)).toEqual(
      entries.map((entry) => `e-${entry.uri}`),
    );
  });

  it('URL playlist hanya mengambil track pertamanya — satu entri = satu lagu', async () => {
    const resolve = async (): Promise<SearchOutcome> =>
      foundTracks([raw('pertama', 'Satu'), raw('kedua', 'Dua')]);

    const result = await resolveStoredTracks([stored()], resolve, OWNER);

    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]?.encoded).toBe('pertama');
  });

  it('playlist kosong menghasilkan nol tanpa error', async () => {
    const result = await resolveStoredTracks([], async () => ({ kind: 'empty' }), OWNER);

    expect(result).toEqual({ tracks: [], failed: 0 });
  });
});

describe('PlaylistService.create', () => {
  it('menyimpan nama yang sudah dirapikan', async () => {
    const { playlists } = service();

    const created = unwrap(await playlists.create({ guildId: GUILD, ownerId: OWNER, name: '  Lofi   Beat ' }));

    expect(created.name).toBe('Lofi Beat');
    expect(created.tracks).toEqual([]);
    expect(created.isPublic).toBe(false);
  });

  it('menolak nama yang sudah dipakai, bedakan huruf besar-kecil', async () => {
    const { playlists } = service();
    unwrap(await playlists.create({ guildId: GUILD, ownerId: OWNER, name: 'Lofi' }));

    const again = await playlists.create({ guildId: GUILD, ownerId: OWNER, name: 'lofi' });

    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toEqual({ kind: 'name-taken', name: 'Lofi' });
  });

  it('nama yang sama milik orang lain tetap boleh dipakai', async () => {
    const { playlists } = service();
    unwrap(await playlists.create({ guildId: GUILD, ownerId: OWNER, name: 'Lofi' }));

    const other = await playlists.create({ guildId: GUILD, ownerId: STRANGER, name: 'Lofi' });

    expect(other.ok).toBe(true);
  });

  it('nama tidak valid ditolak tanpa menyentuh database', async () => {
    const { repository, playlists } = service();

    const result = await playlists.create({ guildId: GUILD, ownerId: OWNER, name: '   ' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('name-invalid');
    expect(repository.rows).toHaveLength(0);
  });
});

describe('PlaylistService.addTracks', () => {
  it('menambah lagu di akhir playlist', async () => {
    const { playlists } = service();
    unwrap(await playlists.create({ guildId: GUILD, ownerId: OWNER, name: 'Lofi' }));

    const result = unwrap(
      await playlists.addTracks(GUILD, OWNER, 'Lofi', [track(), track({ encoded: 'e2', title: 'Lagu Dua' })]),
    );

    expect(result.added).toBe(2);
    expect(result.playlist.tracks.map((item) => item.title)).toEqual(['Lagu Satu', 'Lagu Dua']);
  });

  it('lagu yang sudah ada tidak digandakan, dan jumlahnya dilaporkan', async () => {
    const { playlists } = service();
    unwrap(await playlists.create({ guildId: GUILD, ownerId: OWNER, name: 'Lofi' }));
    unwrap(await playlists.addTracks(GUILD, OWNER, 'Lofi', [track()]));

    const result = unwrap(await playlists.addTracks(GUILD, OWNER, 'Lofi', [track()]));

    expect(result.added).toBe(0);
    expect(result.skippedDuplicates).toBe(1);
    expect(result.playlist.tracks).toHaveLength(1);
  });

  it('lagu tanpa uri dicocokkan lewat judul dan artis', async () => {
    const { playlists } = service();
    unwrap(await playlists.create({ guildId: GUILD, ownerId: OWNER, name: 'Lofi' }));
    unwrap(
      await playlists.addTracks(GUILD, OWNER, 'Lofi', [
        track({ uri: null, encoded: 'lama', title: 'Lagu Satu', author: 'Artis Satu' }),
      ]),
    );

    const result = unwrap(
      await playlists.addTracks(GUILD, OWNER, 'Lofi', [
        track({ uri: null, encoded: 'lain', title: 'lagu satu', author: 'artis satu' }),
      ]),
    );

    expect(result.added).toBe(0);
    expect(result.skippedDuplicates).toBe(1);
  });

  it('playlist yang sudah penuh menolak satu lagu tambahan', async () => {
    const { repository, playlists } = service();
    unwrap(await playlists.create({ guildId: GUILD, ownerId: OWNER, name: 'Penuh' }));
    repository.rows[0]!.tracks = Array.from({ length: MAX_PLAYLIST_TRACKS }, (_, i) =>
      stored({ title: `Lagu ${i}`, uri: `https://youtu.be/${i}` }),
    );

    const result = await playlists.addTracks(GUILD, OWNER, 'Penuh', [track()]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'full', limit: MAX_PLAYLIST_TRACKS });
    expect(repository.rows[0]!.tracks).toHaveLength(MAX_PLAYLIST_TRACKS);
  });

  it('playlist milik orang lain tidak bisa ditambah', async () => {
    const { playlists } = service();
    unwrap(await playlists.create({ guildId: GUILD, ownerId: OWNER, name: 'Lofi' }));

    const result = await playlists.addTracks(GUILD, STRANGER, 'Lofi', [track()]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('not-found');
  });
});

describe('PlaylistService.removeTrack', () => {
  it('menghapus berdasarkan posisi dimulai dari satu', async () => {
    const { playlists } = service();
    unwrap(await playlists.create({ guildId: GUILD, ownerId: OWNER, name: 'Lofi' }));
    unwrap(
      await playlists.addTracks(GUILD, OWNER, 'Lofi', [
        track(),
        track({ encoded: 'e2', title: 'Lagu Dua', uri: 'https://youtu.be/two' }),
      ]),
    );

    const result = unwrap(await playlists.removeTrack(GUILD, OWNER, 'Lofi', 1));

    expect(result.tracks.map((item) => item.title)).toEqual(['Lagu Dua']);
  });

  it('posisi di luar jangkauan menyebut jumlah lagu playlist', async () => {
    const { playlists } = service();
    unwrap(await playlists.create({ guildId: GUILD, ownerId: OWNER, name: 'Lofi' }));
    unwrap(await playlists.addTracks(GUILD, OWNER, 'Lofi', [track()]));

    const result = await playlists.removeTrack(GUILD, OWNER, 'Lofi', 5);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'out-of-range', count: 1 });
  });

  it('playlist kosong memberi tahu jumlah nol, bukan error(position) yang membingungkan', async () => {
    const { playlists } = service();
    unwrap(await playlists.create({ guildId: GUILD, ownerId: OWNER, name: 'Kosong' }));

    const result = await playlists.removeTrack(GUILD, OWNER, 'Kosong', 1);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'out-of-range', count: 0 });
  });
});

describe('PlaylistService.findPlayable', () => {
  it('menemukan playlist milik sendiri', async () => {
    const { playlists } = service();
    unwrap(await playlists.create({ guildId: GUILD, ownerId: OWNER, name: 'Lofi' }));

    const found = unwrap(await playlists.findPlayable(GUILD, OWNER, 'lofi'));

    expect(found.ownerId).toBe(OWNER);
  });

  it('playlist publik orang lain bisa diputar', async () => {
    const { playlists } = service();
    unwrap(await playlists.create({ guildId: GUILD, ownerId: OWNER, name: 'Party' }));
    unwrap(await playlists.setVisibility(GUILD, OWNER, 'Party', true));

    const found = unwrap(await playlists.findPlayable(GUILD, STRANGER, 'Party'));

    expect(found.ownerId).toBe(OWNER);
  });

  it('playlist privat orang lain tidak ditemukan meski namanya ditebak', async () => {
    const { playlists } = service();
    unwrap(await playlists.create({ guildId: GUILD, ownerId: OWNER, name: 'Rahasia' }));

    const found = await playlists.findPlayable(GUILD, STRANGER, 'Rahasia');

    expect(found.ok).toBe(false);
  });
});

describe('PlaylistService.setVisibility & remove', () => {
  it('playlist orang lain dilaporkan tidak ada, bukan "bukan milikmu"', async () => {
    const { playlists } = service();
    unwrap(await playlists.create({ guildId: GUILD, ownerId: OWNER, name: 'Lofi' }));

    const result = await playlists.setVisibility(GUILD, STRANGER, 'Lofi', true);

    // Membalas "bukan milikmu" membocorkan bahwa playlist itu ada.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('not-found');
  });

  it('playlist yang sudah publik bisa diprivatkan lagi', async () => {
    const { playlists } = service();
    unwrap(await playlists.create({ guildId: GUILD, ownerId: OWNER, name: 'Lofi' }));
    unwrap(await playlists.setVisibility(GUILD, OWNER, 'Lofi', true));

    const result = unwrap(await playlists.setVisibility(GUILD, OWNER, 'Lofi', false));

    expect(result.isPublic).toBe(false);
  });

  it('hapus playlist milik sendiri dan mengembalikan barisnya', async () => {
    const { repository, playlists } = service();
    unwrap(await playlists.create({ guildId: GUILD, ownerId: OWNER, name: 'Lofi' }));

    const result = unwrap(await playlists.remove(GUILD, OWNER, 'Lofi'));

    expect(result.name).toBe('Lofi');
    expect(repository.rows).toHaveLength(0);
  });

  it('playlist orang lain tidak bisa dihapus', async () => {
    const { repository, playlists } = service();
    unwrap(await playlists.create({ guildId: GUILD, ownerId: OWNER, name: 'Lofi' }));

    const result = await playlists.remove(GUILD, STRANGER, 'Lofi');

    expect(result.ok).toBe(false);
    expect(repository.rows).toHaveLength(1);
  });
});

describe('PlaylistService.list', () => {
  it('playlist sendiri dan playlist publik digabung tanpa duplikat', async () => {
    const { playlists } = service();
    unwrap(await playlists.create({ guildId: GUILD, ownerId: OWNER, name: 'Milikku' }));
    unwrap(await playlists.create({ guildId: GUILD, ownerId: OWNER, name: 'Dibagikan' }));
    unwrap(await playlists.setVisibility(GUILD, OWNER, 'Dibagikan', true));
    unwrap(await playlists.create({ guildId: GUILD, ownerId: STRANGER, name: 'Milik Orang Lain' }));
    unwrap(await playlists.setVisibility(GUILD, STRANGER, 'Milik Orang Lain', true));

    const list = await playlists.list(GUILD, OWNER, { includePublic: true });
    const names = list.map((item) => item.name);

    expect(names).toContain('Milikku');
    expect(names).toContain('Milik Orang Lain');
    expect(names.filter((name) => name === 'Dibagikan')).toHaveLength(1);
  });

  it('tanpa includePublic hanya playlist sendiri', async () => {
    const { playlists } = service();
    unwrap(await playlists.create({ guildId: GUILD, ownerId: OWNER, name: 'Milikku' }));
    unwrap(await playlists.create({ guildId: GUILD, ownerId: STRANGER, name: 'Shared' }));
    unwrap(await playlists.setVisibility(GUILD, STRANGER, 'Shared', true));

    const list = await playlists.list(GUILD, OWNER);

    expect(list.map((item) => item.name)).toEqual(['Milikku']);
  });
});

describe('PlaylistService.loadForPlay', () => {
  it('laporan jumlah gagal agar angka diputar tidak pernah lebih besar dari kenyataan', async () => {
    const { playlists } = service();
    const list = playlist({
      tracks: [
        stored({ uri: 'https://youtu.be/oke' }),
        stored({ uri: 'https://youtu.be/hilang', title: 'Lagu Hilang' }),
      ],
    });

    const resolve = async (uri: string): Promise<SearchOutcome> =>
      uri.includes('hilang')
        ? { kind: 'empty' }
        : foundTracks([
            { encoded: 'ok', info: { title: 'Oke', author: 'A', length: 1000, isStream: false } },
          ]);

    const result = await playlists.loadForPlay(list, resolve, OWNER);

    expect(result.tracks).toHaveLength(1);
    expect(result.failed).toBe(1);
  });
});

describe('embed playlist', () => {
  it('ringkasan menghitung jumlah lagu dan total durasi', () => {
    const summary = playlistSummary(
      playlist({ tracks: [stored({ durationMs: 225_000 }), stored({ durationMs: 135_000 })] }),
    );

    expect(summary).toBe('2 lagu • 6:00');
  });

  it('lagu live dihitung terpisah, bukan dijumlahkan sebagai nol detik', () => {
    const summary = playlistSummary(
      playlist({ tracks: [stored({ durationMs: 60_000 }), stored({ durationMs: 0, title: 'Radio' })] }),
    );

    expect(summary).toContain('1 live');
  });

  it('playlist kosong ditulis sebagai "kosong", bukan 0 lagu', () => {
    expect(playlistSummary(playlist())).toBe('kosong');
  });

  it('detail playlist milik yang sudah dianonimkan tidak menampilkan mention ke user asli', () => {
    const embed = playlistDetailEmbed(playlist({ ownerId: 'anon:abc123' }));
    const text = JSON.stringify(embed.data);

    expect(text).toContain('Anonim');
    expect(text).not.toContain('anon:abc123');
  });

  it('daftar kosong memberi tahu cara membuat playlist', () => {
    const embed = playlistListEmbed({ playlists: [], userId: OWNER });

    expect(embed.data.description ?? '').toContain('/playlist create');
  });
});