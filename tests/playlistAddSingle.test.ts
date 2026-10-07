import { beforeEach, describe, expect, it, vi } from 'vitest';
import { foundTracks, type RawTrack, type TrackInfo } from '../src/modules/music/index.js';
import { defaultTranslator } from '../src/modules/i18n/index.js';

/**
 * Regresi: `/playlist add <nama> <kata kunci>` menyimpan **semua** hasil
 * `ytsearch:` (±25 lagu), bukan satu lagu terbaik seperti yang dimaksud user.
 *
 * Yang dijaga di sini adalah jumlah track yang benar-benar diserahkan ke
 * `PlaylistService.addTracks`, bukan cuma teks embednya — playlist yang
 * kebanjiran 25 lagu jauh lebih sulit dibersihkan daripada salah tulis pesan.
 *
 * Yang diuji lewat badan `execute` perintah, karena keputusan "berapa lagu yang
 * disimpan" tinggal di sana: gerbang voice, layanan playlist, dan penerjemah
 * diganti tiruan supaya tidak ada Lavalink maupun database yang tersentuh.
 */

const mocks = vi.hoisted(() => ({
  gateMusicCommand: vi.fn(),
  addTracks: vi.fn(),
  resolve: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock('../src/modules/i18n/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/i18n/index.js')>();
  return { ...actual, translatorFor: async () => actual.defaultTranslator };
});

vi.mock('../src/modules/playlists/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/playlists/index.js')>();
  return { ...actual, getPlaylistService: () => ({ addTracks: mocks.addTracks }) };
});

vi.mock('../src/commands/music/_shared.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/commands/music/_shared.js')>();
  return { ...actual, gateMusicCommand: mocks.gateMusicCommand };
});

const GUILD_ID = '111111111111111111';
const USER_ID = '222222222222222222';
const PLAYLIST_NAME = 'Lofi';

/** Track mentah Lavalink secukupnya untuk `toTrackInfo`. */
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

function trackInfo(id: number): TrackInfo {
  return {
    encoded: `encoded-${id}`,
    title: `Lagu ${id}`,
    author: 'Penyanyi',
    durationMs: 180_000,
    uri: `https://example.test/watch?v=${id}`,
    artworkUrl: null,
    isStream: false,
    requesterId: USER_ID,
  };
}

/** Interaksi palsu untuk satu subcommand `add`. */
function fakeInteraction(query: string | null) {
  const edits: unknown[] = [];
  const followUps: unknown[] = [];

  const interaction = {
    guildId: GUILD_ID,
    user: { id: USER_ID },
    guild: { shardId: 0 },
    inCachedGuild: () => true,
    deferReply: async () => undefined,
    deleteReply: async () => undefined,
    editReply: async (payload: unknown) => {
      edits.push(payload);
    },
    followUp: async (payload: unknown) => {
      followUps.push(payload);
    },
    options: {
      getSubcommand: () => 'add',
      getString: (name: string) => (name === 'name' ? PLAYLIST_NAME : query),
    },
  };

  return { interaction: interaction as never, edits, followUps };
}

function embedText(values: unknown[]): string {
  const parts: string[] = [];

  for (const value of values) {
    for (const embed of (value as { embeds?: unknown[] })?.embeds ?? []) {
      const data = (embed as { toJSON(): Record<string, unknown> }).toJSON();
      parts.push(String(data.title ?? ''), String(data.description ?? ''));
    }
  }

  return parts.join('\n');
}

/** Track yang diterima `addTracks` pada kasus yang baru saja dijalankan. */
function storedTracks(): TrackInfo[] {
  const call = mocks.addTracks.mock.calls.at(-1);
  if (!call) throw new Error('addTracks tidak pernah dipanggil');

  return call[3] as TrackInfo[];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gateMusicCommand.mockResolvedValue({
    ok: true,
    ctx: {
      music: { resolve: mocks.resolve, snapshot: mocks.snapshot },
      voiceChannelId: 'voice-1',
      config: {},
      memberRoleIds: [],
      canManageGuild: false,
      t: defaultTranslator,
    },
  });
  mocks.addTracks.mockImplementation(
    async (_guildId: string, _userId: string, name: string, tracks: TrackInfo[]) => ({
      ok: true,
      value: {
        playlist: { name, tracks },
        added: tracks.length,
        skippedDuplicates: 0,
      },
    }),
  );
});

describe('/playlist add menyimpan tepat satu lagu untuk kata kunci', () => {
  it('kata kunci: hanya hasil terbaik yang masuk playlist', async () => {
    const playlist = (await import('../src/commands/music/playlist.js')).default;
    // `ytsearch:` kembali dengan ±25 hasil.
    const outcome = foundTracks([1, 2, 3, 4, 5, 6, 7].map(rawTrack));
    mocks.resolve.mockResolvedValue(outcome);
    const { interaction, edits } = fakeInteraction('hujan nadin');

    await playlist.execute(interaction, {} as never);

    const stored = storedTracks();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.title).toBe('Lagu 1');
    expect(embedText(edits)).toContain('**1** lagu ditambahkan');
    expect(embedText(edits)).toContain(`**${PLAYLIST_NAME}**`);
  });

  it('URL playlist tetap disimpan utuh: itu memang tujuan /playlist add', async () => {
    const playlist = (await import('../src/commands/music/playlist.js')).default;
    mocks.resolve.mockResolvedValue(foundTracks([1, 2, 3].map(rawTrack), 'Album Lengkap'));
    const { interaction, edits } = fakeInteraction('https://www.youtube.com/playlist?list=PL1');

    await playlist.execute(interaction, {} as never);

    expect(storedTracks().map((track) => track.title)).toEqual(['Lagu 1', 'Lagu 2', 'Lagu 3']);
    expect(embedText(edits)).toContain('**3** lagu ditambahkan');
  });

  it('tanpa query: lagu yang sedang diputar yang disimpan', async () => {
    const playlist = (await import('../src/commands/music/playlist.js')).default;
    mocks.snapshot.mockResolvedValue({ current: trackInfo(9), upcoming: [] });
    const { interaction, edits } = fakeInteraction(null);

    await playlist.execute(interaction, {} as never);

    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(storedTracks().map((track) => track.title)).toEqual(['Lagu 9']);
    expect(embedText(edits)).toContain('**1** lagu ditambahkan');
  });

  it('kata kunci tanpa hasil: tidak menyimpan apa pun dan menjelaskannya', async () => {
    const playlist = (await import('../src/commands/music/playlist.js')).default;
    // `LoadType.SEARCH` kosong: daftar kosong, bukan `kind: 'empty'`.
    mocks.resolve.mockResolvedValue(foundTracks([]));
    const { interaction, edits } = fakeInteraction('lagu yang tidak ada');

    await playlist.execute(interaction, {} as never);

    expect(mocks.addTracks).not.toHaveBeenCalled();
    expect(embedText(edits)).toContain('Tidak menemukan apa pun');
  });
});
