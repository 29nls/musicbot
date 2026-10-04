import { PermissionFlagsBits } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import guildMemberAdd from '../src/events/guildMemberAdd.js';
import guildMemberRemove from '../src/events/guildMemberRemove.js';
import { DEFAULT_MODULES, type GuildConfig } from '../src/modules/config/types.js';
import type { GuildMember } from 'discord.js';

/**
 * `guildMemberAdd` dan `guildMemberRemove` — sapaan dan perpisahan.
 *
 * Dua hal yang dijaga di sini, dan keduanya soal urutan:
 *
 * 1. **Konfigurasi gagal dibaca = diam, bukan error.** Handler event tidak punya
 *    pemanggil yang menangkap error, jadi melempar berarti satu handler mati dan
 *    hanya ketahuan dari log internal.
 * 2. **Autorole gagal = user tetap diberi sapaan.** Per Giving role dan menyapa
 *    adalah dua hal berbeda; kalau kegagalan autorole menghentikan seluruh
 *    handler, member baru tidak melihat sapaan hanya karena bot tidak berwenang
 *    mengubah role.
 */

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  // Tanda tangan dibuat eksplisit supaya `mock.calls` bertipe tuple yang
  // benar; tanpa itu indeks [1] dan [2] tidak punya tipe.
  sendGuildEmbed: vi.fn(async (_guild: unknown, _channelId: string | null, _embed: unknown) => true),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock('../src/modules/config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/config/index.js')>();
  return { ...actual, getGuildConfigService: () => ({ get: mocks.getConfig }) };
});

vi.mock('../src/modules/moderation/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/moderation/index.js')>();
  return { ...actual, sendGuildEmbed: mocks.sendGuildEmbed };
});

vi.mock('../src/services/logger.js', () => ({
  getLogger: () => ({
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
    info: mocks.loggerInfo,
    debug: vi.fn(),
  }),
}));

const GUILD_ID = '111111111111111111';

function config(overrides: Partial<GuildConfig> = {}): GuildConfig {
  return {
    guildId: GUILD_ID,
    logChannelId: null,
    welcomeChannelId: null,
    goodbyeChannelId: null,
    djRoleId: null,
    autoroleId: null,
    autoroleBotId: null,
    welcomeMessage: null,
    goodbyeMessage: null,
    defaultVolume: 100,
    idleTimeoutSec: 300,
    ticketPanelChannelId: null,
    ticketCategoryId: null,
    ticketStaffRoleId: null,
    ticketPanelMessageId: null,
    stayChannelId: null,
    modules: { ...DEFAULT_MODULES },
    locale: 'id',
    ...overrides,
  };
}

/** Member palsu dengan bagian yang dipakai kedua handler. */
function fakeMember(overrides: { bot?: boolean; roles?: unknown[]; me?: unknown } = {}) {
  const added: unknown[] = [];

  return {
    member: {
      id: 'member-1',
      guild: {
        id: GUILD_ID,
        name: 'Server Uji',
        memberCount: 42,
        members: { me: overrides.me },
        // Role yang dikembalikan mengikuti ID yang diminta, supaya autorole bot
        // dan autorole manusia bisa dibedakan.
        roles: {
          fetch: vi.fn(async (id: string) => ({ id, position: 1 })),
        },
      },
      user: {
        tag: 'Member#0001',
        bot: overrides.bot ?? false,
        displayAvatarURL: () => 'https://cdn.example/a.png',
      },
      roles: {
        cache: new Map(),
        add: async (role: unknown, reason: string) => {
          added.push({ role, reason });
        },
      },
    } as unknown as GuildMember,
    added,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendGuildEmbed.mockResolvedValue(true);
  mocks.getConfig.mockResolvedValue(config());
});

const client = {} as never;

describe('guildMemberAdd', () => {
  it('mengirim sapaan ke channel welcome yang dikonfigurasi', async () => {
    mocks.getConfig.mockResolvedValue(config({ welcomeChannelId: 'welcome-1' }));
    const { member } = fakeMember();

    await guildMemberAdd.execute(client, member);

    expect(mocks.sendGuildEmbed).toHaveBeenCalledTimes(1);
    expect(mocks.sendGuildEmbed.mock.calls[0]?.[1]).toBe('welcome-1');
  });

  it('sapaan memuat nama member dan jumlah member server', async () => {
    mocks.getConfig.mockResolvedValue(config({ welcomeChannelId: 'welcome-1' }));
    const { member } = fakeMember();

    await guildMemberAdd.execute(client, member);

    const embed = mocks.sendGuildEmbed.mock.calls[0]?.[2] as { toJSON(): { description?: string } };
    const text = JSON.stringify(embed.toJSON());
    // Placeholder bawaan menyebut member sebagai mention, bukan tag: mention
    // yang diklik Discord jauh lebih berguna daripada teks yang tidak aktif.
    expect(text).toContain('<@member-1>');
    expect(text).toContain('Server Uji');
    expect(text).toContain('42');
  });

  it('diam kalau channel welcome belum diatur', async () => {
    mocks.getConfig.mockResolvedValue(config({ welcomeChannelId: null }));

    await guildMemberAdd.execute(client, fakeMember().member);

    expect(mocks.sendGuildEmbed).not.toHaveBeenCalled();
  });

  it('diam dan mencatat kalau konfigurasi gagal dibaca', async () => {
    mocks.getConfig.mockRejectedValue(new Error('database mati'));

    await expect(guildMemberAdd.execute(client, fakeMember().member)).resolves.toBeUndefined();
    expect(mocks.sendGuildEmbed).not.toHaveBeenCalled();
    expect(mocks.loggerWarn).toHaveBeenCalled();
  });

  it('memberi role otomatis ke member manusia', async () => {
    mocks.getConfig.mockResolvedValue(config({ autoroleId: 'role-1' }));
    const me = { permissions: { has: () => true }, roles: { highest: { position: 10 } } };
    const { member, added } = fakeMember({ me });

    await guildMemberAdd.execute(client, member);

    expect(added).toHaveLength(1);
  });

  it('memakai role khusus bot untuk akun bot', async () => {
    mocks.getConfig.mockResolvedValue(config({ autoroleId: 'role-manusia', autoroleBotId: 'role-bot' }));
    const me = { permissions: { has: () => true }, roles: { highest: { position: 10 } } };
    const { member, added } = fakeMember({ bot: true, me });

    await guildMemberAdd.execute(client, member);

    // Kalau bot memakai role manusia, setiap bot yang diundang mendapat role
    // member — persis kesalahan yang harus dicegah.
    expect((added[0] as { role: { id: string } }).role.id).toBe('role-bot');
  });

  it('laporkan kegagalan autorole ke channel log, dan sapaan tetap terkirim', async () => {
    mocks.getConfig.mockResolvedValue(
      config({ autoroleId: 'role-1', welcomeChannelId: 'welcome-1', logChannelId: 'log-1' }),
    );
    const me = { permissions: { has: () => false }, roles: { highest: { position: 10 } } };
    const { member, added } = fakeMember({ me });

    await guildMemberAdd.execute(client, member);

    expect(added).toHaveLength(0);
    // Dua pengiriman: peringatan autorole dulu, baru sapaan. Sapaan tidak boleh
    // hilang hanya karena bot tidak berwenang mengubah role.
    expect(mocks.sendGuildEmbed).toHaveBeenCalledTimes(2);
    expect(mocks.sendGuildEmbed.mock.calls.map((call) => call[1])).toEqual(['log-1', 'welcome-1']);
  });

  it('sapaan tetap terkirim walau peringatan autorole tidak punya channel', async () => {
    mocks.getConfig.mockResolvedValue(config({ autoroleId: 'role-1', welcomeChannelId: 'welcome-1' }));
    const me = { permissions: { has: () => false }, roles: { highest: { position: 10 } } };
    const { member } = fakeMember({ me });

    await guildMemberAdd.execute(client, member);

    // `logChannelId` kosong jadi peringatan tidak bisa dikirim, tapi itu tidak
    // boleh menghentikan sapaan.
    expect(mocks.sendGuildEmbed.mock.calls.at(-1)?.[1]).toBe('welcome-1');
  });

  it('menolak memberi role yang posisinya di atas role bot', async () => {
    mocks.getConfig.mockResolvedValue(config({ autoroleId: 'role-1' }));
    const me = { permissions: { has: () => true }, roles: { highest: { position: 1 } } };
    const { member, added } = fakeMember({ me });

    await guildMemberAdd.execute(client, member);

    // Discord akan menolak ini dengan error; lebih baik dicatat sendiri supaya
    // penyebabnya (hierarki role) terlihat, bukan "Missing Permissions".
    expect(added).toHaveLength(0);
    expect(mocks.loggerWarn).toHaveBeenCalled();
  });

  it('tidak gagal diam-diam kalau guild.members.me belum ada', async () => {
    mocks.getConfig.mockResolvedValue(config({ autoroleId: 'role-1' }));
    const { member, added } = fakeMember({ me: null });

    await expect(guildMemberAdd.execute(client, member)).resolves.toBeUndefined();
    expect(added).toHaveLength(0);
  });

  it('meminta Manage Roles sebagai syarat, bukan asumsi', async () => {
    mocks.getConfig.mockResolvedValue(config({ autoroleId: 'role-1' }));
    const has = vi.fn((bit: bigint) => bit === PermissionFlagsBits.ManageRoles);
    const { member } = fakeMember({ me: { permissions: { has }, roles: { highest: { position: 10 } } } });

    await guildMemberAdd.execute(client, member);

    expect(has).toHaveBeenCalledWith(PermissionFlagsBits.ManageRoles);
  });
});

describe('guildMemberRemove', () => {
  it('mengirim perpisahan ke channel goodbye yang dikonfigurasi', async () => {
    mocks.getConfig.mockResolvedValue(config({ goodbyeChannelId: 'goodbye-1' }));
    const { member } = fakeMember();

    await guildMemberRemove.execute(client, member);

    expect(mocks.sendGuildEmbed).toHaveBeenCalledTimes(1);
    expect(mocks.sendGuildEmbed.mock.calls[0]?.[1]).toBe('goodbye-1');
  });

  it('diam kalau channel goodbye belum diatur', async () => {
    mocks.getConfig.mockResolvedValue(config({ goodbyeChannelId: null }));

    await guildMemberRemove.execute(client, fakeMember().member);

    expect(mocks.sendGuildEmbed).not.toHaveBeenCalled();
  });

  it('diam dan mencatat kalau konfigurasi gagal dibaca', async () => {
    mocks.getConfig.mockRejectedValue(new Error('database mati'));

    await expect(guildMemberRemove.execute(client, fakeMember().member)).resolves.toBeUndefined();
    expect(mocks.sendGuildEmbed).not.toHaveBeenCalled();
    expect(mocks.loggerWarn).toHaveBeenCalled();
  });

  it('memberi tahu jumlah member tersisa di footer', async () => {
    mocks.getConfig.mockResolvedValue(config({ goodbyeChannelId: 'goodbye-1' }));
    const { member } = fakeMember();

    await guildMemberRemove.execute(client, member);

    const embed = mocks.sendGuildEmbed.mock.calls[0]?.[2] as { toJSON(): { footer?: { text?: string } } };
    // Guild sudah memperbarui `memberCount` sebelum event dikirim, jadi angka
    // di footer adalah jumlah yang tersisa — di sini tetap 42.
    expect(embed.toJSON().footer?.text).toBe('Sisa 42 member');
  });
});