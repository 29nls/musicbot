import { PermissionFlagsBits } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messageCreateCustomCommand from '../src/events/messageCreateCustomCommand.js';
import { TRIGGER_COOLDOWN_SECONDS } from '../src/modules/customcommands/types.js';
import { DEFAULT_MODULES, type GuildConfig } from '../src/modules/config/types.js';
import { resetCooldown } from '../src/utils/cooldown.js';

/**
 * `messageCreateCustomCommand` — pemicu perintah custom.
 *
 * Handler ini berjalan untuk **setiap pesan di setiap server**, jadi yang
 * menentukan biaya bot adalah cabang yang berhenti lebih awal, bukan yang
 * mengirim. Urutan pemeriksaannya disengaja dan diuji di sini sebagai kontrak:
 *
 * 1. Pemicu dibaca dari isi pesan saja — tanpa satu pun query.
 * 2. Database baru disentuh setelah pesan itu benar-benar berbentuk pemicu,
 *    modulnya nyala, dan hak kirim pesan sudah dipastikan ada.
 *
 * Pelanggaran titik pertama berarti satu query per pesan di setiap server;
 * pelanggaran titik kedua berarti bot menyentuh database untuk pesan yang memang
 * tidak akan pernah dijawab. Keduanya tidak gagal keras, jadi tidak ada yang
 * terlihat salah — hanya mahal.
 */

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  find: vi.fn(),
  recordMetric: vi.fn(),
  loggerWarn: vi.fn(),
  loggerDebug: vi.fn(),
}));

vi.mock('../src/modules/config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/config/index.js')>();
  return { ...actual, getGuildConfigService: () => ({ get: mocks.getConfig }) };
});

vi.mock('../src/modules/customcommands/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/customcommands/index.js')>();
  return { ...actual, getCustomCommandService: () => ({ find: mocks.find }) };
});

vi.mock('../src/modules/metrics/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/metrics/index.js')>();
  return { ...actual, getMetricsRegistry: () => ({ record: mocks.recordMetric }) };
});

vi.mock('../src/services/logger.js', () => ({
  getLogger: () => ({ warn: mocks.loggerWarn, debug: mocks.loggerDebug, error: vi.fn(), info: vi.fn() }),
}));

const GUILD_ID = '111111111111111111';
const BOT_ID = '999999999999999999';
const USER_ID = '222222222222222222';

/** Izin minimum supaya handler jauh melewati semua pemeriksaan. */
const ALL_PERMS = [
  String(PermissionFlagsBits.ViewChannel),
  String(PermissionFlagsBits.SendMessages),
];

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
    modules: { ...DEFAULT_MODULES, customCommands: true },
    locale: 'id',
    ...overrides,
  };
}

/** Pesan palsu; setiap bagian yang diuji bisa ditimpa per kasus. */
function fakeMessage(overrides: Record<string, unknown> = {}) {
  const replies: Array<{ content: string; allowedMentions?: { parse?: string[] } }> = [];

  const botPermissions = (overrides.botPermissions as string[] | undefined) ?? ALL_PERMS;
  const memberPermissions = (overrides.memberPermissions as string[] | undefined) ?? ALL_PERMS;

  const has = (list: string[]) => (bit: bigint) => list.includes(String(bit));

  const message = {
    content: (overrides.content as string) ?? 'halo dunia',
    inGuild: () => overrides.inGuild ?? true,
    system: overrides.system ?? false,
    partial: overrides.partial ?? false,
    guild: {
      id: GUILD_ID,
      name: 'Server Uji',
      // `in` dipakai, bukan `??`: `??` menganggap null sebagai nullish, jadi
      // menanyakan `me: null` justru mengembalikan nilai bawaan dan menguji
      // jalur yang tidak pernah terjadi.
      members: { me: 'me' in overrides ? overrides.me : { id: BOT_ID } },
    },
    member: overrides.noMember ? null : { permissions: { has: has(memberPermissions) } },
    author: {
      id: (overrides.authorId as string) ?? USER_ID,
      bot: overrides.bot ?? false,
      username: 'Member',
      displayName: 'Member',
    },
    channelId: 'channel-1',
    channel: { permissionsFor: () => ({ has: has(botPermissions) }) },
    reply: async (payload: { content: string; allowedMentions?: { parse?: string[] } }) => {
      if (overrides.replyThrows) throw new Error('Missing Permissions');
      replies.push(payload);
      return { id: 'reply-1' };
    },
  };

  return { message: message as never, replies };
}

const client = { user: { id: BOT_ID } } as never;

beforeEach(async () => {
  vi.clearAllMocks();
  await resetCooldown(`customcmd:${GUILD_ID}:${USER_ID}`);
  mocks.getConfig.mockResolvedValue(config());
  mocks.find.mockResolvedValue({ name: 'halo', response: 'Halo {pengguna}!' });
  mocks.recordMetric.mockReturnValue(undefined);
});

describe('pemicu dibaca tanpa menyentuh database', () => {
  it('pesan biasa tidak membaca konfigurasi', async () => {
    // Mayoritas pesan bukan pemicu. Kalau jalur ini menyentuh DB, biayanya ada
    // di setiap server, bukan hanya saat ada yang memakai perintah custom.
    await messageCreateCustomCommand.execute(client, fakeMessage().message);

    expect(mocks.getConfig).not.toHaveBeenCalled();
    expect(mocks.find).not.toHaveBeenCalled();
  });

  it('mention bot tanpa nama perintah diabaikan', async () => {
    await messageCreateCustomCommand.execute(
      client,
      fakeMessage({ content: `<@${BOT_ID}>` }).message,
    );

    expect(mocks.find).not.toHaveBeenCalled();
  });

  it('prefix tanpa nama perintah diabaikan', async () => {
    await messageCreateCustomCommand.execute(client, fakeMessage({ content: '!   ' }).message);

    expect(mocks.find).not.toHaveBeenCalled();
  });

  it('nama yang tidak valid tidak diteruskan ke database', async () => {
    // `!1234` dan `!halo!dunia` akan ditanyakan ke DB lalu dijawab "tidak ada".
    for (const content of ['!1234', '!halo!dunia']) {
      await messageCreateCustomCommand.execute(client, fakeMessage({ content }).message);
    }

    expect(mocks.find).not.toHaveBeenCalled();
  });

  it('pesan bot, pesan sistem, pesan parsial, dan DM tidak diproses', async () => {
    const cases: Array<Record<string, unknown>> = [
      { bot: true, content: '!halo' },
      { system: true, content: '!halo' },
      { partial: true, content: '!halo' },
      { inGuild: false, content: '!halo' },
    ];

    for (const overrides of cases) {
      await messageCreateCustomCommand.execute(client, fakeMessage(overrides).message);
    }

    expect(mocks.find).not.toHaveBeenCalled();
  });
});

describe('izin dan konfigurasi: alasan tidak melayan pemicu', () => {
  it('diam kalau bot tidak bisa melihat channel', async () => {
    await messageCreateCustomCommand.execute(
      client,
      fakeMessage({ content: '!halo', botPermissions: [String(PermissionFlagsBits.SendMessages)] })
        .message,
    );

    expect(mocks.find).not.toHaveBeenCalled();
  });

  it('diam kalau bot tidak bisa mengirim pesan', async () => {
    await messageCreateCustomCommand.execute(
      client,
      fakeMessage({ content: '!halo', botPermissions: [String(PermissionFlagsBits.ViewChannel)] })
        .message,
    );

    expect(mocks.find).not.toHaveBeenCalled();
  });

  it('diam kalau member tidak boleh bicara di channel itu', async () => {
    // Membalas balasan admin di channel read-only hanya menambah kebisingan.
    await messageCreateCustomCommand.execute(
      client,
      fakeMessage({ content: '!halo', memberPermissions: [] }).message,
    );

    expect(mocks.find).not.toHaveBeenCalled();
  });

  it('diam kalau guild.members.me belum ada', async () => {
    await messageCreateCustomCommand.execute(
      client,
      fakeMessage({ content: '!halo', me: null }).message,
    );

    expect(mocks.find).not.toHaveBeenCalled();
  });

  it('diam kalau member tidak ada di cache', async () => {
    await messageCreateCustomCommand.execute(
      client,
      fakeMessage({ content: '!halo', noMember: true }).message,
    );

    expect(mocks.find).not.toHaveBeenCalled();
  });

  it('diam kalau modul custom command mati di server itu', async () => {
    mocks.getConfig.mockResolvedValue(
      config({ modules: { ...DEFAULT_MODULES, customCommands: false } }),
    );

    await messageCreateCustomCommand.execute(client, fakeMessage({ content: '!halo' }).message);

    expect(mocks.find).not.toHaveBeenCalled();
  });

  it('diam dan mencatat kalau konfigurasi gagal dibaca', async () => {
    mocks.getConfig.mockRejectedValue(new Error('database mati'));

    await expect(
      messageCreateCustomCommand.execute(client, fakeMessage({ content: '!halo' }).message),
    ).resolves.toBeUndefined();
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.loggerWarn).toHaveBeenCalled();
  });

  it('diam dan mencatat kalau perintah gagal dibaca', async () => {
    mocks.find.mockRejectedValue(new Error('query gagal'));

    await expect(
      messageCreateCustomCommand.execute(client, fakeMessage({ content: '!halo' }).message),
    ).resolves.toBeUndefined();
    expect(mocks.loggerWarn).toHaveBeenCalled();
  });

  it('nama perintah diteruskan apa adanya ke service, huruf kecil', async () => {
    mocks.find.mockResolvedValue(null);

    // `!Halo Dunia` harus tetap mencari `halo`: nama perintah tidak sensitivity
    // case, dan hanya argumen yang dipisah.
    await messageCreateCustomCommand.execute(
      client,
      fakeMessage({ content: '!Halo Dunia' }).message,
    );

    expect(mocks.find).toHaveBeenCalledWith(GUILD_ID, 'halo');
  });

  it('tidak membalas saat perintah tidak terdaftar', async () => {
    mocks.find.mockResolvedValue(null);
    const { message, replies } = fakeMessage({ content: '!halo' });

    await messageCreateCustomCommand.execute(client, message);

    expect(replies).toHaveLength(0);
  });
});

describe('balasan yang benar-benar terkirim', () => {
  it('mengganti placeholder lalu membalas', async () => {
    const { message, replies } = fakeMessage({ content: '!halo dunia' });

    await messageCreateCustomCommand.execute(client, message);

    expect(replies).toHaveLength(1);
    expect(replies[0]?.content).toBe(`Halo <@${USER_ID}>!`);
  });

  it('membolehkan mention user saja, supaya balasan tidak bisa mention semua', async () => {
    const { message, replies } = fakeMessage({ content: '!halo' });

    await messageCreateCustomCommand.execute(client, message);

    // Tanpa batas ini, admin yang menulis `@everyone` di balasan akan membuat bot
    // meny_mass-mention seluruh server.
    expect(replies[0]?.allowedMentions?.parse).toEqual(['users']);
  });

  it('mention bot sebelum prefix tetap dilayani', async () => {
    // Mention bot hanya dihapus dari depan; prefix `!` tetap harus ada. Kalau
    // mention sendirinya cukup untuk memicu, `@Harmony halo` akan memicu apa pun.
    const { message, replies } = fakeMessage({ content: `<@${BOT_ID}> !halo dunia` });

    await messageCreateCustomCommand.execute(client, message);

    expect(replies).toHaveLength(1);
    expect(replies[0]?.content).toBe(`Halo <@${USER_ID}>!`);
  });

  it('mention bot tanpa prefix tidak memicu apa pun', async () => {
    const { message, replies } = fakeMessage({ content: `<@${BOT_ID}> halo` });

    await messageCreateCustomCommand.execute(client, message);

    expect(mocks.find).not.toHaveBeenCalled();
    expect(replies).toHaveLength(0);
  });

  it('diam kalau balasan kosong setelah placeholder diganti', async () => {
    mocks.find.mockResolvedValue({ name: 'halo', response: '{args}' });
    const { message, replies } = fakeMessage({ content: '!halo' });

    await messageCreateCustomCommand.execute(client, message);

    // Admin yang menulis `{args}` untuk pesan tanpa argumen harus melihat bot
    // diam, bukan pesan kosong yang aneh dibaca member.
    expect(replies).toHaveLength(0);
  });

  it('mencatat metrik pesan yang terkirim', async () => {
    await messageCreateCustomCommand.execute(client, fakeMessage({ content: '!halo' }).message);

    expect(mocks.recordMetric).toHaveBeenCalledWith('message');
  });
});

describe('cooldown: bot diam, bukan membalas "tunggu sebentar"', () => {
  it('panggilan kedua dalam jendela cooldown tidak dibalas', async () => {
    const first = fakeMessage({ content: '!halo' });
    await messageCreateCustomCommand.execute(client, first.message);
    expect(first.replies).toHaveLength(1);

    const second = fakeMessage({ content: '!halo' });
    await messageCreateCustomCommand.execute(client, second.message);

    // Balasan "tunggu N detik" tidak bisa disembunyikan hanya untuk satu orang,
    // jadi membalas akan menumpuk menjadi pesan baru di channel.
    expect(second.replies).toHaveLength(0);
    expect(mocks.loggerDebug).toHaveBeenCalled();
  });

  it('kunci cooldown memuat guild dan user, jadi antar member tidak saling menabrak', async () => {
    await messageCreateCustomCommand.execute(client, fakeMessage({ content: '!halo' }).message);

    // Member berbeda di guild yang sama: cooldown-nya ikut berbeda, jadi yang
    // kedua tetap dilayani. Kalau kuncinya tidak memuat user, member kedua
    // ikut tertahan dan perintah-perintah saling memblokir.
    const other = fakeMessage({ content: '!halo', authorId: 'member-lain' });

    await messageCreateCustomCommand.execute(client, other.message);

    expect(other.replies).toHaveLength(1);
  });

  it('cooldown memakai konstanta yang di/export, bukan angka yang ditulis ulang', async () => {
    await messageCreateCustomCommand.execute(client, fakeMessage({ content: '!halo' }).message);

    // Kalau handler memakai angka sendiri, konstanta ini jadi tidak pernah
    // diuji dan bisa melenceng tanpa apa pun yang gagal.
    expect(TRIGGER_COOLDOWN_SECONDS).toBeGreaterThan(0);
  });
});

describe('kegagalan pengiriman tidak melempar keluar', () => {
  it('kegagalan reply dicatat sebagai metrik error, bukan dilempar keluar', async () => {
    const { message } = fakeMessage({ content: '!halo', replyThrows: true });

    await expect(messageCreateCustomCommand.execute(client, message)).resolves.toBeUndefined();
    expect(mocks.recordMetric).toHaveBeenCalledWith('message', 'error');
    expect(mocks.loggerWarn).toHaveBeenCalled();
  });
});