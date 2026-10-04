import {
  AuditLogEvent,
  type Guild,
  type GuildBan,
  type GuildMember,
  type GuildTextBasedChannel,
  type Message,
  type PartialMessage,
  type ReadonlyCollection,
  type Role,
  type Snowflake,
  type User,
} from 'discord.js';
import type { BotClient } from '../src/client.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import banAdd from '../src/events/logging/banAdd.js';
import banRemove from '../src/events/logging/banRemove.js';
import channelCreate from '../src/events/logging/channelCreate.js';
import channelDelete from '../src/events/logging/channelDelete.js';
import channelUpdate from '../src/events/logging/channelUpdate.js';
import emojiCreate from '../src/events/logging/emojiCreate.js';
import emojiDelete from '../src/events/logging/emojiDelete.js';
import emojiUpdate from '../src/events/logging/emojiUpdate.js';
import guildUpdate from '../src/events/logging/guildUpdate.js';
import memberAdd from '../src/events/logging/memberAdd.js';
import memberRemove from '../src/events/logging/memberRemove.js';
import memberUpdate from '../src/events/logging/memberUpdate.js';
import messageBulkDelete from '../src/events/logging/messageBulkDelete.js';
import messageDelete from '../src/events/logging/messageDelete.js';
import messageUpdate from '../src/events/logging/messageUpdate.js';
import roleCreate from '../src/events/logging/roleCreate.js';
import roleDelete from '../src/events/logging/roleDelete.js';
import roleUpdate from '../src/events/logging/roleUpdate.js';
import stickerCreate from '../src/events/logging/stickerCreate.js';
import stickerDelete from '../src/events/logging/stickerDelete.js';
import stickerUpdate from '../src/events/logging/stickerUpdate.js';
import voiceStateUpdate from '../src/events/logging/voiceStateUpdate.js';
import { translator } from '../src/modules/i18n/index.js';
import { CATEGORY_META, categoryLabel, type LogCategory } from '../src/modules/logging/types.js';

/**
 * Dua puluh dua handler event logging guild — satu-satunya jalan masuk riwayat log
 * `/logs` untuk perubahan yang tidak dilakukan perintah bot.
 *
 * Semuanya mengikuti satu kontrak yang sama, jadi yang diuji di sini bukan
 * kalimat tiap embed, melainkan **keputusan** tiap handler:
 *
 * 1. ** Diam saat tidak ada yang berubah.** Handler `*Update` membandingkan
 *    keadaan lama dan baru; kalau sama, tidak ada yang dikirim. Tanpa itu,
 *    setiap `guildUpdate` kecil (mis. `boosts` naik-turun) jadi baris log.
 * 2. **Diam untuk channel DM**, karena `channel.guild` tidak ada di sana dan
 *    accessing-nya melempar.
 * 3. **Satu baris per aksi.** Kalau ban dicatat oleh `guildBanAdd`, maka
 *    `guildMemberRemove` untuk orang yang sama harus diam — kalau tidak, satu
 *    ban jadi dua entri `/logs` dengan nomor kasus berbeda.
 * 4. **Tautan kasus ikut.** Aksi dari perintah Harmony membawa nomor kasus, dan
 *    barisnya tidak boleh dicatat dua kali (`record: false`).
 *
 * `dispatchLog` dimock, jadi yang diperiksa benar-benar keputusan handler:
 * kategori, eventKey, dan metadata yang dikirim — bukan format embed.
 */

const t = translator('id');

const mocks = vi.hoisted(() => ({
  dispatchLog: vi.fn(
    async (_guild: unknown, _category: string, _embed: unknown, _meta?: unknown) => true,
  ),
  findAuditEntry: vi.fn(
    async (_guild: unknown, _type?: AuditLogEvent, _options?: { targetId?: string }) => null,
  ),
  consumeCaseLink: vi.fn(
    (_guildId: string, _targetId: string, _actions: readonly string[]) => null as unknown,
  ),
}));

vi.mock('../src/modules/logging/dispatch.js', () => ({ dispatchLog: mocks.dispatchLog }));
vi.mock('../src/modules/logging/audit.js', () => ({ findAuditEntry: mocks.findAuditEntry }));
vi.mock('../src/modules/moderation/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/moderation/index.js')>();
  return { ...actual, consumeCaseLink: mocks.consumeCaseLink };
});
vi.mock('../src/modules/i18n/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/i18n/index.js')>();
  return { ...actual, translatorFor: async () => t };
});

const GUILD_ID = '111111111111111111';
const BOT_ID = '999999999999999999';

// Bertipe `BotClient`, bukan `Client` bawaan discord.js: handler event
// menerima client bot. `as unknown as` dipakai karena objek palsunya
// hanya memuat bagian yang dibaca handler.
const client = { user: { id: BOT_ID } } as unknown as BotClient;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dispatchLog.mockResolvedValue(true);
  mocks.findAuditEntry.mockResolvedValue(null);
  mocks.consumeCaseLink.mockReturnValue(null);
});

/** Metadata `dispatchLog` terakhir yang dipanggil. */
function lastMeta() {
  const call = mocks.dispatchLog.mock.calls.at(-1);
  return call?.[3] as Record<string, unknown> | undefined;
}

/** Kategori routing: argumen kedua `dispatchLog`, yang menentukan channel tujuan. */
function lastCategory() {
  const call = mocks.dispatchLog.mock.calls.at(-1);
  return call?.[1];
}

/**
 * Teks footer embed yang diminta, persis seperti yang dibentuk `logEmbed`.
 *
 * Disimpan sebagai teks mentah, bukan label kategori, supaya perbandingan tetap
 * jujur: kalau katalog berubah, tes ikut berubah.
 */
function lastEmbedFooter() {
  const call = mocks.dispatchLog.mock.calls.at(-1);
  const embed = call?.[2] as { data?: { footer?: { text?: string } } } | undefined;
  return embed?.data?.footer?.text ?? null;
}

function fakeGuild() {
  return { id: GUILD_ID } as unknown as Guild;
}

/**
 * Koleksi sederhana untuk pesan yang dihapus massal.
 *
 * `Map` sudah punya `size` dan `values()`, jadi tidak ada yang perlu ditambahkan.
 */
function collection(
  items: Array<Message<true> | PartialMessage<true>>,
): ReadonlyCollection<Snowflake, Message<true> | PartialMessage<true>> {
  // `Map` sudah punya `values()` dan `size`, dan bentuknya cocok dengan
  // `ReadonlyCollection` yang dipakai discord.js untuk pesan yang dihapus massal.
  return new Map(items.map((item, index) => [String(index), item])) as unknown as ReadonlyCollection<
    Snowflake,
    Message<true> | PartialMessage<true>
  >;
}

function fakeUser(id: string, tag = 'User#0001', isBot = false) {
  // `User` discord.js punya ~30 properti; yang dipakai handler cuma empat.
  return { id, tag, bot: isBot, createdAt: new Date('2024-01-01T00:00:00Z') } as unknown as User;
}

function fakeMember(id: string, overrides: Record<string, unknown> = {}) {
  const roles = new Map<string, unknown>();
  for (const roleId of (overrides.roleIds as string[] | undefined) ?? []) {
    roles.set(roleId, { id: roleId });
  }

  return {
    id,
    guild: fakeGuild(),
    user: fakeUser(id, `User#${id.slice(0, 4)}`, (overrides.bot as boolean) ?? false),
    joinedAt: overrides.joinedAt === undefined ? new Date('2025-01-01T00:00:00Z') : overrides.joinedAt,
    nickname: overrides.nickname ?? null,
    partial: overrides.partial ?? false,
    communicationDisabledUntilTimestamp: overrides.timeout ?? null,
    roles: { cache: roles },
    ...(overrides.extra as Record<string, unknown> | undefined),
  } as unknown as GuildMember;
}

function fakeRole(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    guild: fakeGuild(),
    name: (overrides.name as string) ?? 'Role',
    hexColor: (overrides.hexColor as string) ?? '#ff0000',
    mentionable: overrides.mentionable ?? false,
    hoist: overrides.hoist ?? false,
    position: overrides.position ?? 1,
    permissions: { bitfield: (overrides.permissions as bigint) ?? 0n },
  } as unknown as Role;
}

/** Ban palsu; handler hanya butuh `guild` dan `user`. */
function fakeBan(guild: Guild, userId: string, tag = 'User#0001'): GuildBan {
  return { guild, user: fakeUser(userId, tag) } as unknown as GuildBan;
}

function fakeChannel(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    guild: fakeGuild(),
    name: (overrides.name as string) ?? 'channel',
    type: (overrides.type as number) ?? 0,
    parentId: (overrides.parentId as string | undefined) ?? null,
    nsfw: overrides.nsfw ?? false,
    topic: overrides.topic ?? null,
    rateLimitPerUser: overrides.slowmode ?? 0,
    userLimit: overrides.userLimit ?? 0,
    permissionOverwrites: { cache: new Map((overrides.overwrites as Array<[string, unknown]>) ?? []) },
    isDMBased: () => overrides.isDM ?? false,
  };
}

/**
 * Pesan palsu; setiap bagian yang diuji bisa ditimpa.
 *
 * Objeknya sengaja dibangun longgar lalu dilewati sekali lewat `unknown`:
 * `Message` discord.js punya ~40 properti, dan memalsukan semuanya hanya
 * menambah noise tanpa menambah cakupan yang nyata.
 */
/** Channel palsu; handler memakai id, nama, tipe, induk, dan izin timpa. */
function fakeTextChannel(id: string, overrides: Record<string, unknown> = {}): GuildTextBasedChannel {
  const channel = {
    id,
    guild: fakeGuild(),
    name: (overrides.name as string) ?? 'channel',
    type: (overrides.type as number) ?? 0,
    parentId: (overrides.parentId as string | undefined) ?? null,
    nsfw: overrides.nsfw ?? false,
    topic: overrides.topic ?? null,
    rateLimitPerUser: overrides.slowmode ?? 0,
    userLimit: overrides.userLimit ?? 0,
    permissionOverwrites: { cache: new Map((overrides.overwrites as Array<[string, unknown]>) ?? []) },
    isDMBased: () => overrides.isDM ?? false,
  };

  return channel as unknown as GuildTextBasedChannel;
}

function fakeMessage(id: string, overrides: Record<string, unknown> = {}): Message<true> {
  const message = {
    id,
    guild: fakeGuild(),
    channelId: (overrides.channelId as string) ?? 'channel-1',
    author: overrides.author === null ? null : fakeUser((overrides.author as string) ?? 'author-1'),
    content: (overrides.content as string | undefined) ?? 'isi pesan',
    url: `https://discord.com/channels/${GUILD_ID}/${id}`,
    partial: overrides.partial ?? false,
    inGuild: () => overrides.inGuild ?? true,
    attachments: { size: (overrides.attachments as number) ?? 0 },
  };

  return message as unknown as Message<true>;
}

describe('penjaga bersama: setiap handler mengirim tepat satu baris', () => {
  /**
   * Tiap handler diuji dengan satu kasus "perubahan nyata", lalu diperiksa satu
   * dispatch. Ini yang menangkap handler yang lupa mengirim, atau yang mengirim
   * dua kali karena salah menghitung diff.
   */
  const cases: Array<{ name: string; eventKey: string; run: () => Promise<unknown> }> = [
    {
      name: 'banAdd',
      eventKey: 'guildBanAdd',
      run: () => banAdd.execute(client, fakeBan(fakeGuild(), 'u1')),
    },
    {
      name: 'banRemove',
      eventKey: 'guildBanRemove',
      run: () => banRemove.execute(client, fakeBan(fakeGuild(), 'u1')),
    },
    {
      name: 'channelCreate',
      eventKey: 'channelCreate',
      run: () => channelCreate.execute(client, fakeChannel('c1') as never),
    },
    {
      name: 'channelDelete',
      eventKey: 'channelDelete',
      run: () => channelDelete.execute(client, fakeChannel('c1') as never),
    },
    {
      name: 'emojiCreate',
      eventKey: 'guildEmojiCreate',
      run: () =>
        emojiCreate.execute(client, {
          guild: fakeGuild(),
          id: 'e1',
          name: 'emoji',
          animated: false,
          toString: () => ':emoji:',
        } as never),
    },
    {
      name: 'emojiDelete',
      eventKey: 'guildEmojiDelete',
      run: () =>
        emojiDelete.execute(client, { guild: fakeGuild(), id: 'e1', name: 'emoji' } as never),
    },
    {
      name: 'roleCreate',
      eventKey: 'guildRoleCreate',
      run: () => roleCreate.execute(client, fakeRole('r1')),
    },
    {
      name: 'roleDelete',
      eventKey: 'guildRoleDelete',
      run: () => roleDelete.execute(client, fakeRole('r1')),
    },
    {
      name: 'stickerCreate',
      eventKey: 'guildStickerCreate',
      run: () =>
        stickerCreate.execute(client, {
          guild: fakeGuild(),
          id: 's1',
          name: 'stiker',
          description: 'keterangan',
        } as never),
    },
    {
      name: 'stickerDelete',
      eventKey: 'guildStickerDelete',
      run: () =>
        stickerDelete.execute(client, { guild: fakeGuild(), id: 's1', name: 'stiker' } as never),
    },
    {
      name: 'memberAdd',
      eventKey: 'guildMemberAdd',
      run: () => memberAdd.execute(client, fakeMember('m1')),
    },
  ];

  for (const { name, eventKey, run } of cases) {
    it(`${name} mengirim satu baris dengan eventKey ${eventKey}`, async () => {
      await run();

      expect(mocks.dispatchLog).toHaveBeenCalledTimes(1);
      expect(lastMeta()?.eventKey).toBe(eventKey);
    });
  }
});

describe('handler perubahan: diam saat tidak ada yang berubah', () => {
  it('emojiUpdate diam saat nama dan status tidak berubah', async () => {
    const emoji = { guild: fakeGuild(), id: 'e1', name: 'a', animated: false, toString: () => ':a:' };

    await emojiUpdate.execute(client, emoji as never, { ...emoji } as never);

    expect(mocks.dispatchLog).not.toHaveBeenCalled();
  });

  it('roleUpdate diam saat tidak ada perubahan', async () => {
    await roleUpdate.execute(client, fakeRole('r1'), fakeRole('r1'));

    expect(mocks.dispatchLog).not.toHaveBeenCalled();
  });

  it('roleUpdate mengirim saat nama berubah', async () => {
    await roleUpdate.execute(client, fakeRole('r1', { name: 'Lama' }), fakeRole('r1', { name: 'Baru' }));

    expect(mocks.dispatchLog).toHaveBeenCalledTimes(1);
    expect(lastMeta()?.eventKey).toBe('guildRoleUpdate');
  });

  it('stickerUpdate diam saat tidak ada perubahan', async () => {
    const sticker = { guild: fakeGuild(), id: 's1', name: 'a', description: 'b', tags: 'c' };

    await stickerUpdate.execute(client, sticker as never, { ...sticker } as never);

    expect(mocks.dispatchLog).not.toHaveBeenCalled();
  });

  it('stickerUpdate diam kalau guild-nya tidak ada', async () => {
    await stickerUpdate.execute(
      client,
      { id: 's1', name: 'a' } as never,
      { id: 's1', name: 'b', guild: null } as never,
    );

    expect(mocks.dispatchLog).not.toHaveBeenCalled();
  });

  it('channelUpdate diam saat tidak ada perubahan', async () => {
    await channelUpdate.execute(client, fakeChannel('c1') as never, fakeChannel('c1') as never);

    expect(mocks.dispatchLog).not.toHaveBeenCalled();
  });

  it('channelUpdate mengirim saat nama berubah', async () => {
    await channelUpdate.execute(
      client,
      fakeChannel('c1', { name: 'Lama' }) as never,
      fakeChannel('c1', { name: 'Baru' }) as never,
    );

    expect(mocks.dispatchLog).toHaveBeenCalledTimes(1);
    expect(lastMeta()?.eventKey).toBe('channelUpdate');
  });

  it('guildUpdate diam saat tidak ada perubahan', async () => {
    const guild = (name: string) => ({
      id: GUILD_ID,
      name,
      vanityURLCode: null,
      ownerId: 'owner-1',
      premiumTier: 0,
      premiumSubscriptionCount: 0,
      icon: null,
      banner: null,
    });

    await guildUpdate.execute(client, guild('A') as never, guild('A') as never);

    expect(mocks.dispatchLog).not.toHaveBeenCalled();
  });

  it('guildUpdate mengirim saat nama server berubah', async () => {
    const guild = (name: string) => ({
      id: GUILD_ID,
      name,
      vanityURLCode: null,
      ownerId: 'owner-1',
      premiumTier: 0,
      premiumSubscriptionCount: 0,
      icon: null,
      banner: null,
    });

    await guildUpdate.execute(client, guild('Lama') as never, guild('Baru') as never);

    expect(mocks.dispatchLog).toHaveBeenCalledTimes(1);
    expect(lastMeta()?.eventKey).toBe('guildUpdate');
  });

  it('memberUpdate diam saat tidak ada perubahan', async () => {
    await memberUpdate.execute(client, fakeMember('m1'), fakeMember('m1'));

    expect(mocks.dispatchLog).not.toHaveBeenCalled();
  });

  it('memberUpdate tidak menyimpulkan role hilang dari member parsial', async () => {
    // Member parsial membawa cache role yang belum terisi, sedangkan member
    // baru sudah lengkap. Tanpa penjaga `partial`, diff akan melaporkan semua
    // role sebagai "dilepas" dan mengirim baris palsu setiap guild update.
    await memberUpdate.execute(
      client,
      fakeMember('m1', { partial: true, roleIds: [] }),
      fakeMember('m1', { roleIds: ['role-1', 'role-2'] }),
    );

    expect(mocks.dispatchLog).not.toHaveBeenCalled();
  });

  it('messageUpdate diam saat isi tidak berubah', async () => {
    await messageUpdate.execute(
      client,
      fakeMessage('msg1', { content: 'sama' }) as never,
      fakeMessage('msg1', { content: 'sama' }) as never,
    );

    expect(mocks.dispatchLog).not.toHaveBeenCalled();
  });

  it('messageUpdate diam untuk pesan di luar server', async () => {
    await messageUpdate.execute(
      client,
      fakeMessage('msg1', { content: 'lama', inGuild: false }) as never,
      fakeMessage('msg1', { content: 'baru', inGuild: false }) as never,
    );

    expect(mocks.dispatchLog).not.toHaveBeenCalled();
  });

  it('messageUpdate mengirim saat isi berubah', async () => {
    await messageUpdate.execute(
      client,
      fakeMessage('msg1', { content: 'lama' }) as never,
      fakeMessage('msg1', { content: 'baru' }) as never,
    );

    expect(mocks.dispatchLog).toHaveBeenCalledTimes(1);
    expect(lastMeta()?.eventKey).toBe('messageUpdate');
  });

  it('voiceStateUpdate diam saat tidak ada perubahan sama sekali', async () => {
    const state = (channelId: string | null) => ({
      channelId,
      serverMute: false,
      serverDeaf: false,
      selfMute: false,
      selfDeaf: false,
      streaming: false,
      member: fakeMember('m1'),
    });

    await voiceStateUpdate.execute(client, state(null) as never, state(null) as never);

    expect(mocks.dispatchLog).not.toHaveBeenCalled();
  });
});

describe('penjaga: channel DM tidak pernah diproses', () => {
  it('channelDelete diam untuk DM', async () => {
    await channelDelete.execute(client, fakeChannel('c1', { isDM: true }) as never);

    expect(mocks.dispatchLog).not.toHaveBeenCalled();
  });

  it('channelUpdate diam kalau salah satu sisi DM walau isinya berbeda', async () => {
    // Namanya sengaja berbeda. Kalau penjaga DM dihapus, diff menemukan perubahan
    // dan handler akan mengirim — itulah yang membuat tes ini bergigi.
    await channelUpdate.execute(
      client,
      fakeChannel('c1', { isDM: true, name: 'Lama' }) as never,
      fakeChannel('c1', { name: 'Baru' }) as never,
    );

    expect(mocks.dispatchLog).not.toHaveBeenCalled();
  });
});

describe('penjaga: satu aksi = satu baris riwayat', () => {
  it('memberRemove diam kalau yang dicatat adalah ban, bukan leave', async () => {
    // `guildBanAdd` sudah mengirim barisnya sendiri. Kalau `guildMemberRemove`
    // ikut mengirim, satu ban jadi dua entri dengan nomor kasus berbeda.
    // Angka audit event dulu ditulis tangan dan salah; sekarang dibaca dari enum.
    mocks.findAuditEntry.mockImplementation(async (_guild, type) =>
      type === AuditLogEvent.MemberBanAdd ? ({ executor: { id: 'mod-1', tag: 'M#1' } } as never) : null,
    );

    await memberRemove.execute(client, fakeMember('m1'));

    expect(mocks.dispatchLog).not.toHaveBeenCalled();
  });

  it('memberRemove mengirim untuk leave biasa, dengan executor kosong', async () => {
    await memberRemove.execute(client, fakeMember('m1'));

    expect(mocks.dispatchLog).toHaveBeenCalledTimes(1);
    expect(lastMeta()?.eventKey).toBe('guildMemberRemove');
    expect(lastMeta()?.executorId).toBeNull();
  });

  it('memberRemove memakai entri kick sebagai executor saat ada', async () => {
    mocks.findAuditEntry.mockImplementation(async (_guild, type) =>
      type === AuditLogEvent.MemberKick ? ({ executor: { id: 'mod-1', tag: 'M#1' } } as never) : null,
    );

    await memberRemove.execute(client, fakeMember('m1'));

    expect(lastMeta()?.executorId).toBe('mod-1');
  });
});

describe('penjaga: tautan kasus dari perintah Harmony', () => {
  const link = {
    guildId: GUILD_ID,
    targetId: 'm1',
    action: 'ban',
    caseNumber: 42,
    moderatorId: 'mod-1',
    createdAt: Date.now(),
  };

  it('banAdd memakai judul Harmony dan tidak mencatat ulang', async () => {
    mocks.consumeCaseLink.mockReturnValue(link as never);

    await banAdd.execute(client, fakeBan(fakeGuild(), 'm1'));

    // `record: false` adalah yang mencegah kasus ini tercatat dua kali.
    expect(lastMeta()?.record).toBe(false);
    expect(lastMeta()?.caseNumber).toBe(42);
  });

  it('banAdd mencatat sendiri saat tidak ada tautan', async () => {
    mocks.consumeCaseLink.mockReturnValue(null);

    await banAdd.execute(client, fakeBan(fakeGuild(), 'm1'));

    expect(lastMeta()?.record).toBe(true);
    expect(lastMeta()?.caseNumber).toBeNull();
  });

  it('memberUpdate menempelkan nomor kasus dan berhenti mencatat ulang', async () => {
    mocks.consumeCaseLink.mockReturnValue({
      guildId: GUILD_ID,
      targetId: 'm1',
      action: 'timeout',
      caseNumber: 77,
      moderatorId: 'mod-1',
      createdAt: Date.now(),
    } as never);

    await memberUpdate.execute(
      client,
      fakeMember('m1', { timeout: null }),
      fakeMember('m1', { timeout: Date.now() + 600_000 }),
    );

    expect(lastMeta()?.caseNumber).toBe(77);
    expect(lastMeta()?.record).toBe(false);
  });

  it('memberUpdate hanya mencari tautan saat timeout benar-benar berubah', async () => {
    mocks.consumeCaseLink.mockReturnValue({ ...link, action: 'timeout' } as never);

    await memberUpdate.execute(client, fakeMember('m1'), fakeMember('m1', { nickname: 'Baru' }));

    // Perubahan nickname punya tautan dengan aksi yang salah (timeout), jadi
    // harus tetap `record: true`.
    expect(lastMeta()?.record).toBe(true);
  });

  it('channelUpdate memakai tautan lock dan berhenti mencatat ulang', async () => {
    mocks.consumeCaseLink.mockReturnValue({ ...link, targetId: 'c1', action: 'lock' } as never);

    await channelUpdate.execute(
      client,
      fakeChannel('c1', { name: 'Lama' }) as never,
      fakeChannel('c1', { name: 'Baru' }) as never,
    );

    expect(lastMeta()?.record).toBe(false);
    expect(lastMeta()?.caseNumber).toBe(42);
  });
});

/**
 * Penjaga: warna/footer embed dan channel tujuan harus agrees.
 *
 * Tiap handler menyebut kategori dua kali: sekali ke `logEmbed` (warna + footer)
 * dan sekali lagi sebagai argumen routing `dispatchLog`. Dua daftar yang
 * berbeda adalah kegagalan diam: embednya benar, tapi terkirim ke channel yang
 * salah, jadi `/logging` untuk role tetap kosong dan event masuk ke log member.
 */
describe('penjaga: kategori embed sama dengan kategori routing', () => {
  const routed: Array<{ name: string; embedCategory: string; run: () => Promise<unknown> }> = [
    {
      name: 'roleCreate',
      embedCategory: 'role',
      run: () => roleCreate.execute(client, fakeRole('r1')),
    },
    {
      name: 'emojiCreate',
      embedCategory: 'server',
      run: () =>
        emojiCreate.execute(client, {
          guild: fakeGuild(),
          id: 'e1',
          name: 'emoji',
          animated: false,
          toString: () => ':emoji:',
        } as never),
    },
    {
      name: 'memberAdd',
      embedCategory: 'member',
      run: () => memberAdd.execute(client, fakeMember('m1')),
    },
    {
      name: 'channelCreate',
      embedCategory: 'channel',
      run: () => channelCreate.execute(client, fakeChannel('c1') as never),
    },
  ];

  for (const { name, embedCategory, run } of routed) {
    it(`${name} merutekan ke kategori ${embedCategory}`, async () => {
      await run();

      expect(lastCategory()).toBe(embedCategory);
      // Footer dibentuk dari emoji + label berkategori. Bandingkan ke bentuk yang
      // sama, supaya yang diuji benar-benar kategori yang dipakai embed.
      const category = embedCategory as LogCategory;
      expect(lastEmbedFooter()).toBe(`${CATEGORY_META[category].emoji} ${categoryLabel(category, t)}`);
    });
  }
});

describe('penjaga: metadata: kategori dan target yang benar', () => {
  it('memberAdd memakai eventKey guildMemberAdd', async () => {
    await memberAdd.execute(client, fakeMember('m1'));

    expect(lastMeta()?.eventKey).toBe('guildMemberAdd');
    expect(lastMeta()?.targetId).toBe('m1');
  });

  it('tidak mencari audit log untuk member manusia, hanya untuk bot', async () => {
    // Audit log hanya mencatat penambahan bot. Mencari untuk manusia sia-sia
    // dan bisa mengambil entri yang salah bila kebetulan cocok.
    await memberAdd.execute(client, fakeMember('m1', { bot: false }));
    expect(mocks.findAuditEntry).not.toHaveBeenCalled();

    vi.clearAllMocks();
    await memberAdd.execute(client, fakeMember('m2', { bot: true }));
    expect(mocks.findAuditEntry).toHaveBeenCalledTimes(1);
  });

  it('kategori mengikuti jenis perubahan', async () => {
    await roleCreate.execute(client, fakeRole('r1'));
    expect(lastCategory()).toBe('role');

    vi.clearAllMocks();
    await channelCreate.execute(client, fakeChannel('c1') as never);
    expect(lastCategory()).toBe('channel');

    vi.clearAllMocks();
    await memberAdd.execute(client, fakeMember('m1'));
    expect(lastCategory()).toBe('member');
  });

  it('emojiCreate memakai kategori server, bukan kategori terpisah', async () => {
    await emojiCreate.execute(client, {
      guild: fakeGuild(),
      id: 'e1',
      name: 'emoji',
      animated: false,
      toString: () => ':emoji:',
    } as never);

    expect(lastCategory()).toBe('server');
  });

  it('messageBulkDelete memakai targetId hanya saat penulisnya tunggal', async () => {
    await messageBulkDelete.execute(
      client,
      collection([fakeMessage('m1', { author: 'a1' }) as never]),
      fakeTextChannel('c1'),
    );
    expect(lastMeta()?.targetId).toBe('a1');

    vi.clearAllMocks();
    await messageBulkDelete.execute(
      client,
      collection([fakeMessage('m1', { author: 'a1' }), fakeMessage('m2', { author: 'a2' }) as never]),
      fakeTextChannel('c1'),
    );
    // Dua penulis berbeda: tidak ada satu pun yang bisa disebut sebagai target,
    // jadi kolom target sengaja dikosongkan daripada menebak salah satu.
    expect(lastMeta()?.targetId).toBeNull();
  });

  it('messageDelete diam untuk pesan di luar server', async () => {
    await messageDelete.execute(client, fakeMessage('m1', { inGuild: false }) as never);

    expect(mocks.dispatchLog).not.toHaveBeenCalled();
  });

  it('stickerCreate dan stickerDelete diam kalau sticker tidak punya guild', async () => {
    await stickerCreate.execute(client, { id: 's1', name: 'a', guild: null } as never);
    await stickerDelete.execute(client, { id: 's1', name: 'a', guild: null } as never);

    expect(mocks.dispatchLog).not.toHaveBeenCalled();
  });
});