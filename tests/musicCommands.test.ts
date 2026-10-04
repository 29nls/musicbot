import { MessageFlags } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import disconnect from '../src/commands/music/disconnect.js';
import nowplaying from '../src/commands/music/nowplaying.js';
import pause from '../src/commands/music/pause.js';
import queue from '../src/commands/music/queue.js';
import resume from '../src/commands/music/resume.js';
import shuffle from '../src/commands/music/shuffle.js';
import skip from '../src/commands/music/skip.js';
import stop from '../src/commands/music/stop.js';
import help from '../src/commands/core/help.js';
import ping from '../src/commands/core/ping.js';
import { defaultTranslator } from '../src/modules/i18n/index.js';
import type { QueueSnapshot, TrackInfo } from '../src/modules/music/types.js';
import type { MusicContext } from '../src/commands/music/_shared.js';

/**
 * Badan `execute` sepuluh perintah yang belum pernah dieksekusi tes.
 *
 * Gerbang musik (`gateMusicCommand`) sudah punya tesnya sendiri; yang diuji di
 * sini adalah apa yang terjadi **setelah** gerbang itu lolos, dan apa yang
 * terjadi kalau gerbang menolak. Yang dijaga:
 *
 * 1. **Perintah tidak pernah mengklaim berhasil tanpa mengubah apa pun.**
 *    `/shuffle` dengan satu lagu, `/disconnect` saat bot sudah di luar, dan
 *    `/pause` tanpa apa yang bisa dijeda semuanya harus jujur, bukan melaporkan
 *    berhasil. Bot yang berbohong tentang hasilnya lebih buruk daripada diam.
 * 2. **Penolakan gerbang selalu privat.** Semua perintah musik `deferReply`
 *    dulu, jadi kesalahan harus lewat `followUp` ephemeral; kalau tidak, pesan
 *    "tidak ada lagu" menempel di channel untuk semua orang.
 * 3. **Error tak terduga tidak pernah keluar mentah.** Handler tidak punya
 *    try/catch dari pemanggil.
 */

const mocks = vi.hoisted(() => ({
  gateMusicCommand: vi.fn(),
  handleMusicFailure: vi.fn(),
  replyEphemeralError: vi.fn(),
}));

vi.mock('../src/commands/music/_shared.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/commands/music/_shared.js')>();
  return {
    ...actual,
    gateMusicCommand: mocks.gateMusicCommand,
    handleMusicFailure: mocks.handleMusicFailure,
    replyEphemeralError: mocks.replyEphemeralError,
  };
});

const GUILD_ID = '111111111111111111';

function track(overrides: Partial<TrackInfo> = {}): TrackInfo {
  return {
    encoded: 'encoded-1',
    title: 'Lagu Satu',
    author: 'Artis',
    durationMs: 200_000,
    uri: null,
    artworkUrl: null,
    isStream: false,
    requesterId: GUILD_ID,
    ...overrides,
  };
}

function snapshot(overrides: Partial<QueueSnapshot> = {}): QueueSnapshot {
  return {
    guildId: GUILD_ID,
    current: null,
    upcoming: [],
    upcomingDurationMs: 0,
    paused: false,
    positionMs: 0,
    volume: 100,
    idleRemainingMs: null,
    loopMode: 'off',
    filterMode: 'off',
    ...overrides,
  };
}

/** Interaksi palsu yang mencatat seluruh balasannya. */
function fakeInteraction() {
  const deferred: unknown[] = [];
  const edits: unknown[] = [];
  const followUps: unknown[] = [];
  const deleted: boolean[] = [];

  const interaction = {
    guildId: GUILD_ID,
    user: { id: '222222222222222222' },
    deferReply: async () => {
      deferred.push(true);
    },
    editReply: async (payload: unknown) => {
      edits.push(payload);
    },
    followUp: async (payload: unknown) => {
      followUps.push(payload);
    },
    deleteReply: async () => {
      deleted.push(true);
    },
  };

  return { interaction: interaction as never, deferred, edits, followUps, deleted };
}

/** Konteks musik palsu dengan modul yang bisa ditimpa per kasus. */
function musicContext(overrides: Partial<Record<string, unknown>> = {}): MusicContext {
  return {
    guild: { id: GUILD_ID },
    guildId: GUILD_ID,
    config: { idleTimeoutSec: 300 },
    music: {
      setPaused: vi.fn(async () => true),
      snapshot: vi.fn(async () => snapshot()),
      skip: vi.fn(async () => ({ skipped: null, next: null })),
      stop: vi.fn(async () => null),
      shuffle: vi.fn(async () => 0),
      disconnect: vi.fn(async () => undefined),
      botVoiceChannelId: vi.fn(() => 'voice-1'),
      ...overrides,
    },
    voiceChannelId: 'voice-1',
    canManageGuild: false,
    memberRoleIds: [],
    t: defaultTranslator,
  } as unknown as MusicContext;
}

/**
 * Semua teks embed dari sekumpulan argumen, digabung jadi satu string.
 *
 * Dua bentuk muncul di berkas ini: `editReply({ embeds })` dan
 * `replyEphemeralError(interaction, embed)` yang menerima embed langsung.
 * Dua bentuk argumen itu ditangani satu kali supaya pemeriksaan teks rapi.
 */
function embedText(values: unknown[]): string {
  const parts: string[] = [];

  const push = (embed: unknown): void => {
    const data = (embed as { toJSON(): Record<string, unknown> }).toJSON();
    parts.push(String(data.title ?? ''));
    parts.push(String(data.description ?? ''));
    for (const field of (data.fields as Array<{ name?: string; value?: string }>) ?? []) {
      parts.push(String(field.name ?? ''), String(field.value ?? ''));
    }
  };

  for (const value of values.flat()) {
    if (typeof (value as { toJSON?: unknown })?.toJSON === 'function') {
      push(value);
      continue;
    }
    for (const embed of (value as { embeds?: unknown[] })?.embeds ?? []) {
      push(embed);
    }
  }

  return parts.join('\n');
}

const client = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gateMusicCommand.mockResolvedValue({ ok: true, ctx: musicContext() });
});

describe('penolakan gerbang selalu privat dan tidak mengubah apa pun', () => {
  const commands = [
    { name: 'pause', run: (i: never) => pause.execute(i, client) },
    { name: 'resume', run: (i: never) => resume.execute(i, client) },
    { name: 'skip', run: (i: never) => skip.execute(i, client) },
    { name: 'stop', run: (i: never) => stop.execute(i, client) },
    { name: 'shuffle', run: (i: never) => shuffle.execute(i, client) },
    { name: 'disconnect', run: (i: never) => disconnect.execute(i, client) },
    { name: 'nowplaying', run: (i: never) => nowplaying.execute(i, client) },
    { name: 'queue', run: (i: never) => queue.execute(i, client) },
  ];

  for (const { name, run } of commands) {
    it(`/${name} berhenti saat gerbang menolak`, async () => {
      const gateEmbed = { toJSON: () => ({ title: 'ditolak' }) };
      mocks.gateMusicCommand.mockResolvedValue({ ok: false, embed: gateEmbed });
      const { interaction, edits } = fakeInteraction();

      await run(interaction);

      // Semua perintah musik menunda balasan dulu, jadi penolakan harus lewat
      // replyEphemeralError — kalau tidak, "tidak ada lagu" menempel di channel.
      expect(mocks.replyEphemeralError).toHaveBeenCalledTimes(1);
      expect(mocks.replyEphemeralError.mock.calls[0]?.[1]).toBe(gateEmbed);
      expect(edits).toHaveLength(0);
    });

    it(`/${name} menunda balasan sebelum bekerja`, async () => {
      const { interaction, deferred } = fakeInteraction();

      await run(interaction);

      // Tanpa defer, Discord gagal pada interaksi yang tidak menjawab dalam 3
      // detik — dan setiap perintah musik bisa melewati itu.
      expect(deferred).toHaveLength(1);
    });
  }
});

describe('/pause dan /resume: jujur soal tidak ada yang bisa diubah', () => {
  it('/pause melaporkan tidak ada yang bisa dijeda', async () => {
    const ctx = musicContext();
    (ctx.music as unknown as { setPaused: ReturnType<typeof vi.fn> }).setPaused = vi.fn(async () => false);
    mocks.gateMusicCommand.mockResolvedValue({ ok: true, ctx });
    const { interaction } = fakeInteraction();

    await pause.execute(interaction, client);

    // Klaim berhasil padahal tidak ada yang dijeda akan membuat user menekan
    // lagi berkali-kali.
    expect(embedText(mocks.replyEphemeralError.mock.calls)).toContain(
      defaultTranslator('music.control.nothingToPause'),
    );
  });

  it('/pause menyebut lagu yang dijeda', async () => {
    const ctx = musicContext();
    (ctx.music as unknown as { snapshot: ReturnType<typeof vi.fn> }).snapshot = vi.fn(
      async () => snapshot({ current: track() }),
    );
    mocks.gateMusicCommand.mockResolvedValue({ ok: true, ctx });
    const { interaction, edits } = fakeInteraction();

    await pause.execute(interaction, client);

    expect(embedText(edits)).toContain('Lagu Satu');
  });

  it('/resume melaporkan tidak ada yang bisa dilanjutkan', async () => {
    const ctx = musicContext();
    (ctx.music as unknown as { setPaused: ReturnType<typeof vi.fn> }).setPaused = vi.fn(async () => false);
    mocks.gateMusicCommand.mockResolvedValue({ ok: true, ctx });
    const { interaction } = fakeInteraction();

    await resume.execute(interaction, client);

    expect(embedText(mocks.replyEphemeralError.mock.calls)).toContain(
      defaultTranslator('music.control.nothingToResume'),
    );
  });

  it('/pause tidak menulis ke channel saat tidak ada yang bisa dijeda', async () => {
    const ctx = musicContext();
    (ctx.music as unknown as { setPaused: ReturnType<typeof vi.fn> }).setPaused = vi.fn(async () => false);
    mocks.gateMusicCommand.mockResolvedValue({ ok: true, ctx });
    const { interaction, edits, followUps } = fakeInteraction();

    await pause.execute(interaction, client);

    // Kesalahan harus lewat jalur privat. `editReply` menimpa balasan yang
    // everyone bisa lihat, jadi memakainya di sini membuat "tidak ada lagu"
    // menempel di channel.
    expect(edits).toHaveLength(0);
    expect(followUps).toHaveLength(0);
  });
});

describe('/skip, /stop, /disconnect: laporan hasil yang jujur', () => {
  it('/skip menyebut antrean kosong saat tidak ada lagu berikutnya', async () => {
    const ctx = musicContext();
    (ctx.music as unknown as { skip: ReturnType<typeof vi.fn> }).skip = vi.fn(async () => ({
      skipped: track(),
      next: null,
    }));
    mocks.gateMusicCommand.mockResolvedValue({ ok: true, ctx });
    const { interaction, edits } = fakeInteraction();

    await skip.execute(interaction, client);

    const text = embedText(edits);
    expect(text).toContain('Lagu Satu');
    expect(text).toContain(defaultTranslator('music.control.queueEmpty'));
  });

  it('/skip tetap benar saat tidak ada yang dilewati maupun berikutnya', async () => {
    const ctx = musicContext();
    (ctx.music as unknown as { skip: ReturnType<typeof vi.fn> }).skip = vi.fn(async () => ({
      skipped: null,
      next: null,
    }));
    mocks.gateMusicCommand.mockResolvedValue({ ok: true, ctx });
    const { interaction, edits } = fakeInteraction();

    await skip.execute(interaction, client);

    expect(embedText(edits)).toContain(defaultTranslator('music.control.queueEmpty'));
  });

  it('/stop menyebutkan bahwa antrean dibersihkan', async () => {
    const ctx = musicContext();
    (ctx.music as unknown as { stop: ReturnType<typeof vi.fn> }).stop = vi.fn(async () => track());
    mocks.gateMusicCommand.mockResolvedValue({ ok: true, ctx });
    const { interaction, edits } = fakeInteraction();

    await stop.execute(interaction, client);

    expect(embedText(edits)).toContain('Lagu Satu');
  });

  it('/disconnect bilang benar saat bot memang sedang tersambung', async () => {
    const ctx = musicContext();
    (ctx.music as unknown as { botVoiceChannelId: ReturnType<typeof vi.fn> }).botVoiceChannelId = vi.fn(
      () => 'voice-1',
    );
    mocks.gateMusicCommand.mockResolvedValue({ ok: true, ctx });
    const { interaction, edits } = fakeInteraction();

    await disconnect.execute(interaction, client);

    expect(embedText(edits)).toContain(defaultTranslator('music.disconnect.left'));
  });

  it('/disconnect tidak mengklaim keluar saat bot sudah di luar', async () => {
    const ctx = musicContext();
    (ctx.music as unknown as { botVoiceChannelId: ReturnType<typeof vi.fn> }).botVoiceChannelId = vi.fn(
      () => null,
    );
    mocks.gateMusicCommand.mockResolvedValue({ ok: true, ctx });
    const { interaction, edits } = fakeInteraction();

    await disconnect.execute(interaction, client);

    // `disconnect` sengaja idempoten, tapi tetap harus menyatakan tidak ada yang
    // terjadi daripada mengklaim berhasil mengubah sesuatu.
    expect(embedText(edits)).toContain(defaultTranslator('music.disconnect.nowhere'));
    expect(embedText(edits)).not.toContain(defaultTranslator('music.disconnect.left'));
  });
});

describe('/shuffle: tidak mengacak yang tidak bisa diacak', () => {
  it('satu lagu dilaporkan terlalu pendek, bukan berhasil', async () => {
    const ctx = musicContext();
    (ctx.music as unknown as { shuffle: ReturnType<typeof vi.fn> }).shuffle = vi.fn(async () => 1);
    mocks.gateMusicCommand.mockResolvedValue({ ok: true, ctx });
    const { interaction, edits } = fakeInteraction();

    await shuffle.execute(interaction, client);

    expect(embedText(edits)).toContain(defaultTranslator('music.shuffle.tooShortBody'));
  });

  it('antrean kosong dilaporkan terlalu pendek', async () => {
    const ctx = musicContext();
    (ctx.music as unknown as { shuffle: ReturnType<typeof vi.fn> }).shuffle = vi.fn(async () => 0);
    mocks.gateMusicCommand.mockResolvedValue({ ok: true, ctx });
    const { interaction, edits } = fakeInteraction();

    await shuffle.execute(interaction, client);

    expect(embedText(edits)).toContain(defaultTranslator('music.shuffle.tooShortBody'));
  });

  it('mengacak yang berhasil melaporkan jumlahnya', async () => {
    const ctx = musicContext();
    (ctx.music as unknown as { shuffle: ReturnType<typeof vi.fn> }).shuffle = vi.fn(async () => 5);
    mocks.gateMusicCommand.mockResolvedValue({ ok: true, ctx });
    const { interaction, edits } = fakeInteraction();

    await shuffle.execute(interaction, client);

    expect(embedText(edits)).toContain(defaultTranslator('music.shuffle.done', { count: '5' }));
  });
});

describe('/nowplaying dan /queue: keadaan kosong dijelaskan', () => {
  it('/nowplaying menjelaskan tidak ada yang diputar', async () => {
    const ctx = musicContext();
    mocks.gateMusicCommand.mockResolvedValue({ ok: true, ctx });
    const { interaction, edits } = fakeInteraction();

    await nowplaying.execute(interaction, client);

    expect(embedText(edits)).toContain(defaultTranslator('music.nowPlaying.nothingBody'));
  });

  it('/nowplaying menampilkan lagu yang sedang berjalan', async () => {
    const ctx = musicContext();
    (ctx.music as unknown as { snapshot: ReturnType<typeof vi.fn> }).snapshot = vi.fn(
      async () => snapshot({ current: track(), upcoming: [track({ encoded: 'e2', title: 'Lagu Dua' })] }),
    );
    mocks.gateMusicCommand.mockResolvedValue({ ok: true, ctx });
    const { interaction, edits } = fakeInteraction();

    await nowplaying.execute(interaction, client);

    expect(embedText(edits)).toContain('Lagu Satu');
  });

  it('/queue menjelaskan antrean kosong', async () => {
    const ctx = musicContext();
    mocks.gateMusicCommand.mockResolvedValue({ ok: true, ctx });
    const { interaction, edits } = fakeInteraction();

    await queue.execute(interaction, client);

    expect(embedText(edits)).toContain(defaultTranslator('music.queue.emptyHint'));
  });

  it('/queue menampilkan isi antrean', async () => {
    const ctx = musicContext();
    (ctx.music as unknown as { snapshot: ReturnType<typeof vi.fn> }).snapshot = vi.fn(
      async () => snapshot({ upcoming: [track({ encoded: 'e2', title: 'Lagu Dua' })] }),
    );
    mocks.gateMusicCommand.mockResolvedValue({ ok: true, ctx });
    const { interaction, edits } = fakeInteraction();

    await queue.execute(interaction, client);

    expect(embedText(edits)).toContain('Lagu Dua');
  });
});

describe('error tak terduga ditangani, tidak pernah keluar mentah', () => {
  const cases = [
    { name: '/pause', run: (i: never) => pause.execute(i, client) },
    { name: '/resume', run: (i: never) => resume.execute(i, client) },
    { name: '/skip', run: (i: never) => skip.execute(i, client) },
    { name: '/stop', run: (i: never) => stop.execute(i, client) },
    { name: '/shuffle', run: (i: never) => shuffle.execute(i, client) },
    { name: '/disconnect', run: (i: never) => disconnect.execute(i, client) },
    { name: '/nowplaying', run: (i: never) => nowplaying.execute(i, client) },
    { name: '/queue', run: (i: never) => queue.execute(i, client) },
  ];

  for (const { name, run } of cases) {
    it(`${name} meneruskan error ke handleMusicFailure`, async () => {
      const boom = new Error('Lavalink tidak merespons');
      mocks.gateMusicCommand.mockRejectedValue(boom);
      const { interaction } = fakeInteraction();

      await expect(run(interaction)).resolves.toBeUndefined();

      // Handler event tidak punya try/catch dari pemanggil, jadi error mentah
      // akan menjadi unhandled rejection.
      expect(mocks.handleMusicFailure).toHaveBeenCalledWith(interaction, boom, expect.any(String));
    });
  }
});

describe('/help dan /ping', () => {
  /** Client palsu untuk `/help` dan `/ping`. */
  function commandClient(overrides: Record<string, unknown> = {}) {
    return {
      commands: {
        size: 3,
        filter: (fn: (command: { category: string }) => boolean) => [
          { category: 'core', data: { toJSON: () => ({ name: 'help' }) } },
          { category: 'music', data: { toJSON: () => ({ name: 'play' }) } },
          { category: 'admin', data: { toJSON: () => ({ name: 'ban' }) } },
        ].filter(fn),
      },
      ws: { ping: 42.4 },
      uptime: 3_723_000,
      guilds: { cache: { size: 7 } },
      ...overrides,
    };
  }

  /** Interaksi biasa yang mencatat reply dan edit. */
  function plainInteraction(guildId: string | null = GUILD_ID) {
    const replies: Array<{ content?: string; flags?: number; embeds?: unknown[] }> = [];
    const edits: Array<{ content?: string | null; embeds?: unknown[] }> = [];

    return {
      replies,
      edits,
      interaction: {
        guildId,
        reply: async (payload: (typeof replies)[number]) => {
          replies.push(payload);
        },
        editReply: async (payload: (typeof edits)[number]) => {
          edits.push(payload);
        },
      } as never,
    };
  }

  it('/help mengelompokkan perintah per kategori', async () => {
    const { interaction, replies } = plainInteraction();

    await help.execute(interaction, commandClient() as never);

    const text = embedText(replies);
    // Tiga kategori, masing-masing dengan emoji dan label berkatalog.
    expect(text).toContain('help');
    expect(text).toContain('play');
    expect(text).toContain('ban');
    expect(text).toContain(defaultTranslator('help.category.music'));
  });

  it('/help membayar jumlah perintah sesuai cache client', async () => {
    const { interaction, replies } = plainInteraction();

    await help.execute(interaction, commandClient() as never);

    expect(embedText(replies)).toContain(defaultTranslator('help.embed.intro', { count: '3' }));
  });

  it('/ping membalas ephemeral dulu lalu mengeditnya', async () => {
    const { interaction, replies, edits } = plainInteraction();

    await ping.execute(interaction, commandClient() as never);

    // Balasan pertama harus ephemeral supaya tidak membanjiri channel setiap
    // kali seseorang cek latensi.
    expect(replies[0]?.content).toBe(defaultTranslator('ping.measuring'));
    expect(replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(edits[0]?.content).toBeNull();
  });

  it('/ping melaporkan ping gateway, guild, dan uptime', async () => {
    const { interaction, edits } = plainInteraction();

    await ping.execute(interaction, commandClient() as never);

    const text = embedText(edits);
    // 42.4 dibulatkan: angka panjang milliseconds di `/ping` hanya noise.
    expect(text).toContain('42 ms');
    expect(text).toContain('7');
  });

  it('/ping dan /help jalan di DM tanpa server', async () => {
    const dmHelp = plainInteraction(null);
    await help.execute(dmHelp.interaction, commandClient() as never);
    expect(dmHelp.replies).toHaveLength(1);

    const dmPing = plainInteraction(null);
    await ping.execute(dmPing.interaction, commandClient() as never);
    expect(dmPing.replies).toHaveLength(1);
  });
});