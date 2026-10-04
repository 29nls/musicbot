import type { GuildMember, Message } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messageCreate from '../src/events/messageCreate.js';
import type { GuildConfig, ModulesEnabled } from '../src/modules/config/index.js';
import type { AutomodPolicy, AutomodRule } from '../src/modules/automod/index.js';
import { getSeenMessageGuard } from '../src/modules/automod/index.js';
import type { BotClient } from '../src/client.js';

/**
 * Perilaku `messageCreate` — pemicu automod.
 *
 * Handler ini berjalan untuk **setiap pesan di setiap server**, jadi
 * cabangnya yang penting adalah cabang yang tidak melakukan apa-apa:
 * pesan exempt, pesan bot, pesan yang bukan pelanggaran. Kalau salah satu
 * bocor ke bawah, satu pesan bisa jadi dua kasus moderasi.
 *
 * Yang terakhir itu bukan bayangan. PRD §9.4 menyatakan handler event harus
 * toleran terhadap pengiriman ulang, dan gateway memang bisa mengirim ulang
 * `MessageCreate` yang sama setelah sesi pulih. Kalau tidak ada yang menahan,
 * pesan yang terkirim dua kali berarti dua kali dihapus, dua kali
 * dicatat sebagai peringatan, dan dua kali timeout — dan tidak ada yang
 * gagal, semua hanya terjadi dua kali.
 */

const GUILD = 'guild-1';
const CHANNEL = 'channel-1';
const USER = 'user-1';

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getPolicy: vi.fn(),
  recordWarning: vi.fn(),
  sendGuildEmbed: vi.fn(async () => true),
  translatorFor: vi.fn(async () => (key: string) => `id:${key}`),
  trackerRecord: vi.fn(() => ({ recentMessageCount: 1, duplicateStreak: 1 })),
}));

vi.mock('../src/modules/config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/config/index.js')>();
  return { ...actual, getGuildConfigService: () => ({ get: mocks.getConfig }) };
});

vi.mock('../src/modules/automod/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/automod/index.js')>();
  return {
    ...actual,
    getAutomodService: () => ({ getPolicy: mocks.getPolicy }),
    getAutomodTracker: () => ({ record: mocks.trackerRecord }),
  };
});

vi.mock('../src/modules/moderation/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/moderation/index.js')>();
  return {
    ...actual,
    getModerationService: () => ({ recordWarning: mocks.recordWarning }),
    sendGuildEmbed: mocks.sendGuildEmbed,
  };
});

vi.mock('../src/modules/i18n/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/i18n/index.js')>();
  return { ...actual, translatorFor: mocks.translatorFor };
});

/** Konfigurasi dengan satu modul nyala, sisanya mengikuti default. */
function config(overrides: Partial<GuildConfig> = {}): GuildConfig {
  const modules: ModulesEnabled = {
    music: true,
    moderation: true,
    automod: true,
    logging: false,
    reactions: false,
    tickets: false,
    customCommands: false,
  };

  return {
    guildId: GUILD,
    logChannelId: 'log-1',
    locale: 'id',
    modules,
    ...overrides,
  } as GuildConfig;
}

function rule(overrides: Partial<AutomodRule> = {}): AutomodRule {
  return {
    type: 'badword',
    enabled: true,
    threshold: 0,
    actions: ['delete', 'warn'],
    whitelist: { channels: [], roles: [], domains: [], words: ['kasar'], invites: [] },
    ...overrides,
  } as AutomodRule;
}

function policy(overrides: Partial<AutomodPolicy> = {}): AutomodPolicy {
  return {
    guildId: GUILD,
    rules: [rule()],
    exemptChannels: [],
    exemptRoles: [],
    ...overrides,
  };
}

interface FakeMessageOptions {
  id?: string;
  content?: string;
  authorBot?: boolean;
  system?: boolean;
  partial?: boolean;
  inGuild?: boolean;
  guildId?: string | null;
  roleIds?: string[];
  canManageMessages?: boolean;
  moderatable?: boolean;
  deleteFails?: boolean;
  timeoutFails?: boolean;
  hasMember?: boolean;
  /** Berapa mention yang dihitung handler (aturan `mention` butuh > 5). */
  mentionCount?: number;
}

function fakeMessage(options: FakeMessageOptions = {}) {
  const id = options.id ?? 'msg-1';
  const removed: string[] = [];
  const timeouts: { ms: number; reason: string }[] = [];

  const member = {
    id: USER,
    moderatable: options.moderatable ?? true,
    roles: { cache: new Map((options.roleIds ?? []).map((r) => [r, {}])) },
    permissions: { has: () => options.canManageMessages ?? false },
    timeout: async (ms: number, reason: string) => {
      if (options.timeoutFails) throw new Error('tidak bisa timeout');
      timeouts.push({ ms, reason });
    },
  };

  const message = {
    id,
    content: options.content ?? 'kasar',
    author: { bot: options.authorBot ?? false, id: USER, tag: 'user#0001' },
    system: options.system ?? false,
    partial: options.partial ?? false,
    member: options.hasMember === false ? null : member,
    guildId: options.guildId === undefined ? GUILD : options.guildId,
    channelId: CHANNEL,
    mentions: {
      users: new Map(Array.from({ length: options.mentionCount ?? 0 }, (_, i) => [`u${i}`, {}])),
      roles: new Map(),
      everyone: false,
    },
    inGuild: () => options.inGuild ?? true,
    delete: async () => {
      if (options.deleteFails) throw new Error('tidak bisa hapus');
      removed.push(id);
    },
    guild: {
      id: GUILD,
      members: { me: { id: 'bot-1' } },
      channels: { fetch: async () => null },
    },
  };

  return {
    message: message as unknown as Message<true>,
    plain: message as unknown as Message,
    member: member as unknown as GuildMember,
    removed,
    timeouts,
  };
}

const botClient = { user: { id: 'bot-1' } } as unknown as BotClient;

beforeEach(() => {
  mocks.getConfig.mockReset();
  mocks.getConfig.mockResolvedValue(config());
  mocks.getPolicy.mockReset();
  mocks.getPolicy.mockResolvedValue(policy());
  mocks.recordWarning.mockReset();
  mocks.recordWarning.mockResolvedValue({ case: { caseNumber: 42 } });
  mocks.sendGuildEmbed.mockClear();
  mocks.translatorFor.mockReset();
  mocks.trackerRecord.mockReset();
  mocks.trackerRecord.mockReturnValue({ recentMessageCount: 1, duplicateStreak: 1 });

  // Penjaga pesan yang sama dipakai untuk menguji idempotensi, jadi harus
  // kosong di awal setiap tes: sisa dari tes sebelumnya akan membuat pesan
  // yang baru terkira duplikat.
  getSeenMessageGuard().reset();
});

describe('messageCreate — Early exit', () => {
  it.each([
    ['pesan DM', { inGuild: false }],
    ['pesan bot', { authorBot: true }],
    ['pesan sistem', { system: true }],
    ['pesan parsial', { partial: true }],
    ['pesan tanpa member', { hasMember: false }],
  ] as const)('%s tidak menyentuh apa pun', async (_label, options) => {
    const { plain } = fakeMessage(options as FakeMessageOptions);

    await messageCreate.execute(botClient, plain);

    expect(mocks.getConfig).not.toHaveBeenCalled();
    expect(mocks.getPolicy).not.toHaveBeenCalled();
    expect(mocks.trackerRecord).not.toHaveBeenCalled();
  });

  it('berhenti saat konfigurasi tidak terbaca, tanpa melempar', async () => {
    mocks.getConfig.mockRejectedValue(new Error('database mati'));
    const { plain } = fakeMessage();

    await expect(messageCreate.execute(botClient, plain)).resolves.toBeUndefined();

    expect(mocks.getPolicy).not.toHaveBeenCalled();
  });

  it('berhenti saat modul automod mati', async () => {
    mocks.getConfig.mockResolvedValue(config({ modules: { automod: false } } as Partial<GuildConfig>));
    const { plain } = fakeMessage();

    await messageCreate.execute(botClient, plain);

    expect(mocks.getPolicy).not.toHaveBeenCalled();
  });

  it('berhenti saat rule automod tidak terbaca, tanpa melempar', async () => {
    mocks.getPolicy.mockRejectedValue(new Error('tabel bermasalah'));
    const { plain } = fakeMessage();

    await expect(messageCreate.execute(botClient, plain)).resolves.toBeUndefined();

    expect(mocks.trackerRecord).not.toHaveBeenCalled();
  });
});

describe('messageCreate — pengecualian', () => {
  it('tidak mencatat pesan dari user yang bisa mengelola pesan', async () => {
    const { plain } = fakeMessage({ canManageMessages: true });

    await messageCreate.execute(botClient, plain);

    expect(mocks.trackerRecord).not.toHaveBeenCalled();
    expect(mocks.sendGuildEmbed).not.toHaveBeenCalled();
  });

  it('tidak mencatat pesan dari channel yang dikecualikan', async () => {
    mocks.getPolicy.mockResolvedValue(policy({ exemptChannels: [CHANNEL] }));
    const { plain } = fakeMessage();

    await messageCreate.execute(botClient, plain);

    expect(mocks.trackerRecord).not.toHaveBeenCalled();
  });

  it('tidak mencatat pesan dari role yang dikecualikan', async () => {
    mocks.getPolicy.mockResolvedValue(policy({ exemptRoles: ['staff'] }));
    const { plain } = fakeMessage({ roleIds: ['staff'] });

    await messageCreate.execute(botClient, plain);

    expect(mocks.trackerRecord).not.toHaveBeenCalled();
  });

  it('tidak berkomentar saat user biasa punya role lain', async () => {
    mocks.getPolicy.mockResolvedValue(policy({ exemptRoles: ['staff'] }));
    const { plain } = fakeMessage({ roleIds: ['member'] });

    await messageCreate.execute(botClient, plain);

    expect(mocks.trackerRecord).toHaveBeenCalledTimes(1);
  });
});

describe('messageCreate — pelanggaran', () => {
  it('menghapus pesan dan mencatat peringatan', async () => {
    const { plain, removed } = fakeMessage();

    await messageCreate.execute(botClient, plain);

    expect(removed).toEqual(['msg-1']);
    expect(mocks.recordWarning).toHaveBeenCalledTimes(1);
    expect(mocks.sendGuildEmbed).toHaveBeenCalledTimes(1);
  });

  it('meneruskan alasan dan label rule ke kasus yang tercatat', async () => {
    const { plain } = fakeMessage();

    await messageCreate.execute(botClient, plain);

    expect(mocks.recordWarning).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: GUILD, targetId: USER, moderatorId: 'bot-1' }),
    );
    const reason = mocks.recordWarning.mock.calls[0]?.[0] as { reason: string };
    expect(reason.reason).toContain('id:automod.rule.badword.label');
  });

  it('memberi timeout saat aturan menyuruhnya', async () => {
    mocks.getPolicy.mockResolvedValue(
      policy({
        rules: [
          rule({
            type: 'mention',
            actions: ['delete', 'timeout'],
            whitelist: { channels: [], roles: [], domains: [], words: [], invites: [] },
          }),
        ],
      }),
    );
    const { plain, timeouts } = fakeMessage({ mentionCount: 6 });

    await messageCreate.execute(botClient, plain);

    expect(timeouts).toHaveLength(1);
    expect(timeouts[0]?.ms).toBe(10 * 60_000);
  });

  it('tidak memberi timeout ke member yang tidak bisa dimoderasi bot', async () => {
    mocks.getPolicy.mockResolvedValue(
      policy({
        rules: [
          rule({
            type: 'mention',
            actions: ['delete', 'timeout'],
            whitelist: { channels: [], roles: [], domains: [], words: [], invites: [] },
          }),
        ],
      }),
    );
    const { plain, timeouts } = fakeMessage({ mentionCount: 6, moderatable: false });

    await messageCreate.execute(botClient, plain);

    expect(timeouts).toHaveLength(0);
    // Laporan tetap dicatat: moderator perlu tahu aturan itu dipicu meski
    // aksinya tidak bisa dijalankan.
    expect(mocks.sendGuildEmbed).toHaveBeenCalledTimes(1);
  });

  it('tetap mengirim log walau penghapusan gagal', async () => {
    const { plain } = fakeMessage({ deleteFails: true });

    await expect(messageCreate.execute(botClient, plain)).resolves.toBeUndefined();

    expect(mocks.sendGuildEmbed).toHaveBeenCalledTimes(1);
  });

  it('tetap menghapus pesan walau pencatatan peringatan gagal', async () => {
    mocks.recordWarning.mockRejectedValue(new Error('kasus gagal ditulis'));
    const { plain, removed } = fakeMessage();

    await expect(messageCreate.execute(botClient, plain)).resolves.toBeUndefined();

    expect(removed).toEqual(['msg-1']);
    expect(mocks.sendGuildEmbed).toHaveBeenCalledTimes(1);
  });

  it('tetap menghapus pesan walau timeout gagal', async () => {
    mocks.getPolicy.mockResolvedValue(
      policy({
        rules: [
          rule({
            type: 'mention',
            actions: ['delete', 'timeout'],
            whitelist: { channels: [], roles: [], domains: [], words: [], invites: [] },
          }),
        ],
      }),
    );
    const { plain, removed, timeouts } = fakeMessage({ mentionCount: 6, timeoutFails: true });

    await expect(messageCreate.execute(botClient, plain)).resolves.toBeUndefined();

    expect(removed).toEqual(['msg-1']);
    expect(timeouts).toHaveLength(0);
    expect(mocks.sendGuildEmbed).toHaveBeenCalledTimes(1);
  });

  it('tidak melakukan apa-apa kalau tidak ada pelanggaran', async () => {
    const { plain, removed } = fakeMessage({ content: 'halo semua' });

    await messageCreate.execute(botClient, plain);

    expect(mocks.trackerRecord).toHaveBeenCalledTimes(1);
    expect(removed).toHaveLength(0);
    expect(mocks.recordWarning).not.toHaveBeenCalled();
    expect(mocks.sendGuildEmbed).not.toHaveBeenCalled();
  });
});

describe('messageCreate — idempotensi (PRD §9.4)', () => {
  it('pengiriman ulang pesan yang sama tidak dihitung dua kali', async () => {
    // Gateway mengirim ulang event setelah sesi pulih. Tanpa penjaga, satu
    // pesan bisa jadi dua penghapusan, dua kasus, dan dua timeout.
    const first = fakeMessage({ id: 'msg-duplikat' });
    const second = fakeMessage({ id: 'msg-duplikat' });

    await messageCreate.execute(botClient, first.plain);
    await messageCreate.execute(botClient, second.plain);

    expect(mocks.trackerRecord).toHaveBeenCalledTimes(1);
    expect(mocks.recordWarning).toHaveBeenCalledTimes(1);
    expect(mocks.sendGuildEmbed).toHaveBeenCalledTimes(1);
  });

  it('pesan berbeda tetap diproses normal', async () => {
    const first = fakeMessage({ id: 'msg-a' });
    const second = fakeMessage({ id: 'msg-b' });

    await messageCreate.execute(botClient, first.plain);
    await messageCreate.execute(botClient, second.plain);

    expect(mocks.trackerRecord).toHaveBeenCalledTimes(2);
    expect(mocks.recordWarning).toHaveBeenCalledTimes(2);
  });

  it('pesan di server berbeda tidak saling menahan', async () => {
    const guildA = fakeMessage({ id: 'msg-a-1', guildId: 'guild-a' });
    mocks.getConfig.mockResolvedValueOnce(config({ guildId: 'guild-a' }));
    mocks.getPolicy.mockResolvedValueOnce(policy({ guildId: 'guild-a' }));
    await messageCreate.execute(botClient, guildA.plain);

    const guildB = fakeMessage({ id: 'msg-b-1', guildId: 'guild-b' });
    mocks.getConfig.mockResolvedValueOnce(config({ guildId: 'guild-b' }));
    mocks.getPolicy.mockResolvedValueOnce(policy({ guildId: 'guild-b' }));
    await messageCreate.execute(botClient, guildB.plain);

    expect(mocks.trackerRecord).toHaveBeenCalledTimes(2);
    expect(mocks.recordWarning).toHaveBeenCalledTimes(2);
  });
});