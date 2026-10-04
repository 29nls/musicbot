import { readFileSync } from 'node:fs';
import type { EmbedBuilder } from 'discord.js';
import { describe, expect, it } from 'vitest';
import {
  PLAYLIST_TRACK_PREVIEW,
  PlaylistNameError,
  parsePlaylistName,
  playlistDetailEmbed,
  playlistListEmbed,
  playlistSummary,
  type Playlist,
  type StoredTrack,
} from '../src/modules/playlists/index.js';
import { translator } from '../src/modules/i18n/index.js';
import { listModuleFiles } from '../src/utils/moduleLoader.js';

const id = translator('id');
const en = translator('en');

interface EmbedData {
  title?: string;
  description?: string;
  footer?: { text?: string };
  fields?: Array<{ name?: string; value?: string }>;
}

/** Seluruh teks embed apa adanya, supaya tidak ada bagian yang lolos dari cek. */
function embedText(embed: EmbedBuilder): string {
  const data = embed.toJSON() as EmbedData;
  const parts: string[] = [];

  for (const key of ['title', 'description', 'footer'] as const) {
    const value = data[key];
    if (typeof value === 'string') parts.push(value);
    else if (value && typeof value === 'object' && 'text' in value) {
      parts.push(String((value as { text: unknown }).text));
    }
  }

  for (const field of data.fields ?? []) {
    parts.push(String(field.name ?? ''), String(field.value ?? ''));
  }

  return parts.join('\n');
}

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

function playlist(overrides: Partial<Playlist> = {}): Playlist {
  return {
    id: 1,
    guildId: 'guild-1',
    ownerId: 'owner-1',
    name: 'Lofi',
    tracks: [],
    isPublic: false,
    createdAt: new Date('2026-10-03T00:00:00.000Z'),
    updatedAt: new Date('2026-10-03T00:00:00.000Z'),
    ...overrides,
  };
}

describe('playlist dalam dua bahasa', () => {
  it('ringkasan memakai satuan bahasa server, termasuk bentuk tunggal', () => {
    expect(playlistSummary(playlist(), id)).toBe('kosong');
    expect(playlistSummary(playlist(), en)).toBe('empty');

    expect(playlistSummary(playlist({ tracks: [stored()] }), en)).toBe('1 track • 3:45');
    expect(playlistSummary(playlist({ tracks: [stored()] }), id)).toBe('1 lagu • 3:45');

    expect(
      playlistSummary(playlist({ tracks: [stored(), stored({ title: 'Lagu Dua' })] }), en),
    ).toBe('2 tracks • 7:30');
  });

  it('lagu live tetap dihitung terpisah dan ikut diterjemahkan', () => {
    const mixed = playlist({
      tracks: [stored(), stored({ title: 'Radio', durationMs: 0 })],
    });

    expect(playlistSummary(mixed, id)).toContain('1 live');
    expect(playlistSummary(mixed, en)).toContain('1 live');
  });

  it('daftar playlist memakai judul, nama kelompok, dan kaki halaman dari katalog', () => {
    const list = {
      playlists: [
        playlist({ id: 1 }),
        playlist({ id: 2, ownerId: 'owner-2', isPublic: true }),
      ],
      userId: 'owner-1',
    };

    const english = embedText(playlistListEmbed(list, en));
    expect(english).toContain(en('playlist.listTitle'));
    expect(english).toContain(en('playlist.listMine', { count: 1 }));
    expect(english).toContain(en('playlist.listShared', { count: 1 }));
    expect(english).toContain(en('playlist.listFooter'));

    const indonesian = embedText(playlistListEmbed(list, id));
    expect(indonesian).toContain(id('playlist.listMine', { count: 1 }));
    expect(english).not.toContain(id('playlist.listMine', { count: 1 }));
  });

  it('daftar kosong memberi tahu cara membuat playlist dalam bahasa server', () => {
    const english = embedText(playlistListEmbed({ playlists: [], userId: 'owner-1' }, en));

    expect(english).toContain('/playlist create');
    expect(english).toContain(en('playlist.listEmpty').slice(0, 20));
  });

  it('detail playlist memakai nama field dan nilai visibilitas dari katalog', () => {
    const private_ = embedText(playlistDetailEmbed(playlist({ tracks: [stored()] }), en));
    expect(private_).toContain(en('playlist.fieldContents'));
    expect(private_).toContain(en('playlist.fieldCreator'));
    expect(private_).toContain(en('playlist.fieldVisibility'));
    expect(private_).toContain(en('playlist.visibilityPrivate'));
    expect(private_).not.toContain(en('playlist.visibilityPublic'));

    const shared = embedText(playlistDetailEmbed(playlist({ isPublic: true }), en));
    expect(shared).toContain(en('playlist.visibilityPublic'));
  });

  it('playlist kosong dan playlist yang dipangkas punya kalimat sendiri', () => {
    expect(embedText(playlistDetailEmbed(playlist(), en))).toContain(en('playlist.detailEmpty'));

    const many = playlist({
      tracks: Array.from({ length: 30 }, (_, index) => stored({ title: `Lagu ${index}` })),
    });
    const english = embedText(playlistDetailEmbed(many, en));

    expect(english).toContain(
      en('playlist.detailMoreTracks', { count: 30 - PLAYLIST_TRACK_PREVIEW }),
    );
  });

  it('pemilik yang sudah dianonimkan tidak menampilkan mention ke user asli', () => {
    const english = embedText(
      playlistDetailEmbed(playlist({ ownerId: 'anon:abc123', tracks: [stored()] }), en),
    );

    expect(english).toContain(en('playlist.ownerAnonymized'));
    expect(english).not.toContain('anon:abc123');
  });

  it('nilai bawaannya tetap persis Bahasa Indonesia seperti sebelum ada i18n', () => {
    expect(playlistSummary(playlist({ tracks: [stored()] }))).toBe('1 lagu • 3:45');
    expect(playlistSummary(playlist())).toBe('kosong');
    expect(embedText(playlistListEmbed({ playlists: [], userId: 'owner-1' }))).toContain(
      '/playlist create',
    );
  });

  it('error nama playlist ber-kunci, bukan kalimat yang disimpan di service', () => {
    const empty = new PlaylistNameError('playlist.errNameEmpty');
    expect(empty.message).toBe(id('playlist.errNameEmpty'));
    expect(empty.key).toBe('playlist.errNameEmpty');

    expect(() => parsePlaylistName('   ')).toThrow(PlaylistNameError);
    try {
      parsePlaylistName('   ');
    } catch (error) {
      expect((error as PlaylistNameError).key).toBe('playlist.errNameEmpty');
      expect((error as PlaylistNameError).message).toBe(id('playlist.errNameEmpty'));
    }

    try {
      parsePlaylistName('x'.repeat(200));
    } catch (error) {
      const failure = error as PlaylistNameError;
      expect(failure.key).toBe('playlist.errNameTooLong');
      expect(failure.message).toContain(String(200));
    }
  });
});

describe('penjaga: tidak ada teks Indonesia yang tertinggal di modul playlists', () => {
  it('literal Bahasa Indonesia di berkas yang sudah diterjemahkan tidak ada', async () => {
    const offenders = await indonesianLiterals();

    expect(offenders).toEqual([]);
  });

  it('judul, isi, kaki halaman, dan nama field selalu lewat penerjemah', async () => {
    const offenders: string[] = [];

    for (const file of await listModuleFiles('src/modules/playlists')) {
      const name = basename(file);
      if (!SUDAH_DITERJEMAHKAN.includes(name)) continue;

      const code = stripComments(readFileSync(file, 'utf8'));
      const patterns = [
        /set(?:Title|Description|Footer|Placeholder)\(\s*'([^']*)'/g,
        /(?:name|title|description|text):\s*'([^']*)'/g,
      ];

      for (const pattern of patterns) {
        for (const match of code.matchAll(pattern)) {
          offenders.push(name + ' -> ' + match[0]);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('daftar berkas yang sudah diterjemahkan sama persis dengan kenyataan', async () => {
    const files = (await listModuleFiles('src/modules/playlists'))
      .map((file) => basename(file))
      .filter((name) => name.endsWith('.ts'));

    const covered = files.filter((name) => SUDAH_DITERJEMAHKAN.includes(name));
    expect([...covered].sort()).toEqual([...SUDAH_DITERJEMAHKAN].sort());
  });

  it('heuristiknya benar-benar menangkap kalimat Indonesia', () => {
    expect(looksIndonesian('Belum ada playlist, buat dulu dengan perintah create.')).toBe(true);
    expect(looksIndonesian('Nama playlist tidak boleh kosong untuk member ini.')).toBe(true);

    expect(looksIndonesian('You have no playlists yet.')).toBe(false);
    expect(looksIndonesian('playlist.listEmpty')).toBe(false);
    expect(looksIndonesian('Anonymous')).toBe(false);

    expect(looksCode('playlist.listEmpty')).toBe(true);
    expect(looksCode('https://example.com/1')).toBe(true);
    expect(looksCode('Belum ada playlist')).toBe(false);
  });
});

/**
 * Berkas modul playlists yang teks runtime-nya sudah ikut katalog.
 *
 * `repository.ts`, `mapping.ts`, `tracks.ts`, `singleton.ts`, dan `index.ts`
 * tidak masuk: mereka tidak menyusun teks untuk member. `service.ts` hanya
 * melempar kunci dari `validation.ts`, jadi tidak menyimpan kalimat sendiri.
 */
const SUDAH_DITERJEMAHKAN = ['embeds.ts', 'types.ts', 'validation.ts'];

interface OffendingFile {
  file: string;
  literal: string;
}

function basename(file: string): string {
  return file.split(/[\\/]/).pop() ?? file;
}

async function indonesianLiterals(): Promise<OffendingFile[]> {
  const files = await listModuleFiles('src/modules/playlists');
  const offenders: OffendingFile[] = [];

  for (const file of files) {
    const name = basename(file);
    if (!SUDAH_DITERJEMAHKAN.includes(name)) continue;

    const source = stripComments(readFileSync(file, 'utf8'));
    for (const literal of [...stringLiterals(source), ...templateFragments(source)]) {
      if (looksIndonesian(literal)) offenders.push({ file, literal });
    }
  }

  return offenders;
}

/** Buang komentar baris dan blok, sisakan string yang benar-benar dipakai. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** String literal satu maupun dua kutip, apa adanya isinya. */
function stringLiterals(source: string): string[] {
  const found: string[] = [];

  for (const match of source.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)) {
    const value = match[1] ?? match[2];
    if (value) found.push(value);
  }

  return found;
}

/**
 * Bagian statis dari template literal, dipecah per baris.
 *
 * Ekspresi `${…}` dibuang karena kalimat yang bocor ke template literal
 * biasanya pieces-nya yang salah, bukan keseluruhan template-nya.
 */
function templateFragments(source: string): string[] {
  const found: string[] = [];

  for (const match of source.matchAll(/`([^`]*)`/g)) {
    const body = match[1];
    if (!body) continue;

    for (const fragment of body.replace(/\$\{[^}]*\}/g, '\n').split('\n')) {
      const trimmed = fragment.trim();
      if (trimmed) found.push(trimmed);
    }
  }

  return found;
}

/** Kunci katalog dan URL bukan kalimat, meski isinya huruf. */
function looksCode(literal: string): boolean {
  return /^https?:\/\//.test(literal) || /^[\w.:/<>-]+$/.test(literal);
}

/** Kata penanda kalimat Bahasa Indonesia. */
const STOPWORDS = [
  ' tidak ',
  ' sudah ',
  ' belum ',
  ' dengan ',
  ' untuk ',
  ' harus ',
  ' dari ',
  ' yang ',
  ' bisa ',
  ' atau ',
  ' sebelum ',
  ' dan ',
  ' tanpa ',
  ' tentang ',
  ' member ',
  ' server ',
  ' di sini',
];

/** Heuristik kasar "kayaknya kalimat Bahasa Indonesia". */
function looksIndonesian(literal: string): boolean {
  if (literal.length < 15) return false;
  if (looksCode(literal)) return false;
  if (!literal.includes(' ')) return false;

  const lower = ` ${literal.toLowerCase()} `;
  const hits = STOPWORDS.filter((word) => lower.includes(word.toLowerCase())).length;

  return hits >= 2;
}