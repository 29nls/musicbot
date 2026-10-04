import { describe, expect, it, vi } from 'vitest';
import { PermissionFlagsBits, type Guild, type GuildMember } from 'discord.js';
import { handleReactionRoleSelect, type ReactionRoleSelectDeps } from '../src/modules/reactionroles/select.js';
import { handleTicketButton, isStaff, type TicketButtonDeps } from '../src/modules/tickets/buttons.js';
import type { GuildConfig } from '../src/modules/config/index.js';
import { defaultTranslator } from '../src/modules/i18n/index.js';
import type { Ticket } from '../src/modules/tickets/types.js';

/**
 * Dua handler komponen yang sebelumnya 0% cakupan: select menu reaction role
 * dan tombol tiket.
 *
 * Keduanya adalah tempat_member menekan sesuatu dan bot langsung mengubah
 * hak miliknya — jadi cabang yang diuji di sini bukan tampilan, tapi
 * **penolakan**: panel yang sudah berakhir, role yang di atas bot, tiket milik
 * orang lain, dan modul yang dimatikan. Jalur keberhasilan dijaga juga,
 * karena handler yang selalu menolak akan terlihat benar di semua tes yang
 * hanya memeriksa penolakan.
 *
 * Service-nya disuntikkan lewat `ReactionRoleSelectDeps`/`TicketButtonDeps`,
 * jadi tidak ada database dan tidak ada mock modul: yang diuji adalah
 * percabangan handler-nya.
 */

const GUILD_ID = '123456789012345678';
const USER_ID = '222222222222222222';
const STAFF_ID = '333333333333333333';
const ROLE_ID = '444444444444444444';

const NOW = new Date('2026-10-02T12:00:00.000Z');

function config(overrides: Partial<GuildConfig> = {}): GuildConfig {
  return {
    guildId: GUILD_ID,
    logChannelId: null,
    ticketStaffRoleId: null,
    modules: {
      music: true,
      moderation: true,
      automod: true,
      logging: true,
      tickets: true,
      reactions: true,
    },
    ...overrides,
  } as GuildConfig;
}

/**
 * Embed terakhir yang dikirim balasan.
 *
 * `toJSON()` dipakai supaya yang diperiksa benar-benar teks yang dikirim ke
 * Discord, bukan bentuk internal embed.
 */
function embedText(interaction: { replies: unknown[] }): string {
  const last = interaction.replies[interaction.replies.length - 1] as {
    embeds: Array<{ toJSON?: () => unknown }>;
  };
  const data = last.embeds[0]?.toJSON?.() as { description?: string; title?: string } | undefined;
  return `${data?.title ?? ''} ${data?.description ?? ''}`;
}

/**
 * Penolakan harus menyebut katalognya sendiri.
 *
 * Ini yang membedakan "ditolak karena panel sudah tutup" dari "ditolak karena
 * bot belum ada di cache" atau "ditolak karena modul mati" — ketiganya sama-sama
 * tidak memasang role, jadi tes yang hanya menghitung panggilan akan hijau
 * untuk ketiganya sekaligus. Kuncinya diambil dari katalog, bukan kalimat yang
 * disalin ke sini.
 */
function expectMessage(
  interaction: { replies: unknown[] },
  // Tipe kuncinya ikut dari translator, bukan `string` biasa: kalau butuh
  // diteruskan ke sana, `string` biasa tidak akan bisa dipakai, dan ini yang
  // membuat katalog tetap ketat.
  key: Parameters<typeof defaultTranslator>[0],
  params?: Record<string, string>,
): void {
  // Parameternya wajib diteruskan: katalog yang punya placeholder seperti
  // `<@&{role}>` tidak akan cocok kalau dibandingkan tanpa diisi.
  expect(embedText(interaction)).toContain(defaultTranslator(key, params));
}

/** Interaksi select menu palsu yang mencatat semua balasannya. */
function selectInteraction(overrides: Record<string, unknown> = {}) {
  const replies: unknown[] = [];
  const interaction = {
    // Bentuknya `rr:<nomor>` — parser menolak apa pun yang bukan angka.
    customId: 'rr:7',
    guildId: GUILD_ID,
    guild: null as unknown as Guild,
    member: null as unknown as GuildMember,
    inCachedGuild: () => true,
    replies,
    reply: vi.fn(async (payload: unknown) => {
      replies.push(payload);
    }),
    ...overrides,
  };
  return interaction;
}

function selectDeps(overrides: Partial<ReactionRoleSelectDeps> = {}): ReactionRoleSelectDeps {
  return {
    findOption: async () => ({
      panel: { id: 1, guildId: GUILD_ID, closedAt: null, expiresAt: null } as never,
      option: { id: 7, roleId: ROLE_ID } as never,
    }),
    isModuleEnabled: async () => true,
    ...overrides,
  };
}

/** Member palsu yang bisa menambah/melepas role. */
function memberWith(hasRole: boolean, over: Record<string, unknown> = {}) {
  const added: unknown[] = [];
  const removed: unknown[] = [];

  const member = {
    id: USER_ID,
    roles: {
      cache: { has: () => hasRole },
      add: vi.fn(async (...args: unknown[]) => {
        added.push(args);
        return member;
      }),
      remove: vi.fn(async (...args: unknown[]) => {
        removed.push(args);
        return member;
      }),
    },
    ...over,
  };

  return { member, added, removed };
}

/** Guild palsu dengan cache role dan member bot. */
function guildWith(roleFound: boolean, bot: Record<string, unknown> | null) {
  return {
    id: GUILD_ID,
    roles: { cache: { get: () => (roleFound ? { id: ROLE_ID, position: 1 } : undefined) } },
    members: { me: bot },
  } as unknown as Guild;
}

describe('handleReactionRoleSelect', () => {
  it('memasang role saat member belum memegangnya', async () => {
    const { member, added } = memberWith(false);
    const interaction = selectInteraction({
      member,
      guild: guildWith(true, {
        permissions: { has: () => true },
        roles: { highest: { position: 5 } },
      }),
    });

    await handleReactionRoleSelect(interaction as never, selectDeps());

    expect(added.length).toBe(1);
    expect(interaction.replies.length).toBe(1);
  });

  it('melepas role saat member sudah memegangnya (select menu berarti toggle)', async () => {
    const { member, removed } = memberWith(true);
    const interaction = selectInteraction({ member, guild: guildWith(true, null) });

    await handleReactionRoleSelect(interaction as never, selectDeps());

    expect(removed.length).toBe(1);
    expect(interaction.replies.length).toBe(1);
  });

  it('menolak saat panel sudah ditutup', async () => {
    // Member yang menyimpan pesan lama tidak boleh bisa mengambil role dari
    // panel yang sudah berakhir — inilah penjaga utamanya.
    const { member, added, removed } = memberWith(false);
    const interaction = selectInteraction({ member, guild: guildWith(true, null) });

    await handleReactionRoleSelect(
      interaction as never,
      selectDeps({
        findOption: async () => ({
          panel: { id: 1, guildId: GUILD_ID, closedAt: NOW, expiresAt: null } as never,
          option: { id: 7, roleId: ROLE_ID } as never,
        }),
      }),
    );

    expect(added.length + removed.length).toBe(0);
    expectMessage(interaction as never, 'rr.select.closedPanel');
  });

  it('menolak saat panel milik guild lain', async () => {
    const { member, added } = memberWith(false);
    const interaction = selectInteraction({ member, guild: guildWith(true, null) });

    await handleReactionRoleSelect(
      interaction as never,
      selectDeps({
        findOption: async () => ({
          panel: { id: 1, guildId: '999999999999999999', closedAt: null, expiresAt: null } as never,
          option: { id: 7, roleId: ROLE_ID } as never,
        }),
      }),
    );

    expect(added.length).toBe(0);
    expectMessage(interaction as never, 'rr.select.panelGone');
  });

  it('menolak saat panel sudah tidak ada sama sekali', async () => {
    const interaction = selectInteraction({ guild: guildWith(true, null) });

    await handleReactionRoleSelect(
      interaction as never,
      selectDeps({ findOption: async () => null }),
    );

    expectMessage(interaction as never, 'rr.select.panelGone');
  });

  it('menolak saat modul reaction role dimatikan', async () => {
    const { member, added } = memberWith(false);
    const interaction = selectInteraction({ member, guild: guildWith(true, null) });

    await handleReactionRoleSelect(
      interaction as never,
      selectDeps({ isModuleEnabled: async () => false }),
    );

    expect(added.length).toBe(0);
    expectMessage(interaction as never, 'rr.select.moduleOff');
  });

  it('menolak saat role sudah dihapus dari server', async () => {
    const { member, added } = memberWith(false);
    const interaction = selectInteraction({ member, guild: guildWith(false, null) });

    await handleReactionRoleSelect(interaction as never, selectDeps());

    expect(added.length).toBe(0);
    expectMessage(interaction as never, 'rr.select.roleGone');
  });

  it('menolak saat bot tidak punya Manage Roles', async () => {
    const { member, added } = memberWith(false);
    const interaction = selectInteraction({
      member,
      guild: guildWith(true, {
        permissions: { has: () => false },
        roles: { highest: { position: 5 } },
      }),
    });

    await handleReactionRoleSelect(interaction as never, selectDeps());

    expect(added.length).toBe(0);
    expectMessage(interaction as never, 'rr.select.cannotAssign', { role: ROLE_ID });
  });

  it('menolak saat role berada di atas posisi role tertinggi bot', async () => {
    // Urutannya penting: bot punya izin tapi role-nya di atas, jadi tetap
    // tidak bisa dipasang.
    const { member, added } = memberWith(false);
    const interaction = selectInteraction({
      member,
      guild: guildWith(true, {
        permissions: { has: () => true },
        roles: { highest: { position: 0 } },
      }),
    });

    await handleReactionRoleSelect(interaction as never, selectDeps());

    expect(added.length).toBe(0);
  });

  it('menolak saat member bot tidak ada di cache', async () => {
    const { member, added } = memberWith(false);
    const interaction = selectInteraction({ member, guild: guildWith(true, null) });

    await handleReactionRoleSelect(interaction as never, selectDeps());

    expect(added.length).toBe(0);
    expectMessage(interaction as never, 'rr.select.botMissing');
  });

  it('meloloskan role di bawah posisi bot', async () => {
    const { member, added } = memberWith(false);
    const interaction = selectInteraction({
      member,
      guild: guildWith(true, {
        permissions: { has: () => true },
        roles: { highest: { position: 9 } },
      }),
    });

    await handleReactionRoleSelect(interaction as never, selectDeps());

    expect(added.length).toBe(1);
  });

  it('memberi tahu, bukan diam, saat pemasangan role gagal', async () => {
    const member = {
      id: USER_ID,
      roles: {
        cache: { has: () => false },
        add: vi.fn(async () => {
          throw new Error('Missing Permissions');
        }),
        remove: vi.fn(),
      },
    };
    const interaction = selectInteraction({
      member,
      guild: guildWith(true, {
        permissions: { has: () => true },
        roles: { highest: { position: 9 } },
      }),
    });

    await handleReactionRoleSelect(interaction as never, selectDeps());

    expect(interaction.replies.length).toBe(1);
  });

  it('mengabaikan customId milik select menu lain', async () => {
    const findOption = vi.fn();
    const interaction = selectInteraction({ customId: 'musik:filter', guild: guildWith(true, null) });

    await handleReactionRoleSelect(interaction as never, selectDeps({ findOption }));

    expect(findOption).not.toHaveBeenCalled();
    expect(interaction.replies.length).toBe(0);
  });

  it('mengabaikan interaksi di luar guild', async () => {
    const findOption = vi.fn();
    const interaction = selectInteraction({
      guildId: null,
      inCachedGuild: () => false,
      guild: guildWith(true, null),
    });

    await handleReactionRoleSelect(interaction as never, selectDeps({ findOption }));

    expect(findOption).not.toHaveBeenCalled();
  });

  it('balasan yang sudah kedaluwarsa hanya dicatat, tidak dilempar', async () => {
    const interaction = selectInteraction({
      guild: guildWith(true, null),
      reply: vi.fn(async () => {
        throw new Error('Interaction token expired');
      }),
    });

    // Select menu punya jendela 3 detik; setelah itu tidak ada yang bisa
    // dilakukan selain mencatatnya, jadi handler tidak boleh melempar keluar.
    await expect(
      handleReactionRoleSelect(interaction as never, selectDeps({ findOption: async () => null })),
    ).resolves.toBeUndefined();
  });
});

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 1,
    ticketNumber: 7,
    guildId: GUILD_ID,
    channelId: '555555555555555555',
    openerId: USER_ID,
    subject: 'Tidak bisa masuk voice',
    status: 'open',
    claimedBy: null,
    createdAt: NOW,
    closedAt: null,
    closedBy: null,
    expiresAt: null,
    transcript: null,
    ...overrides,
  } as Ticket;
}

function buttonInteraction(customId: string, overrides: Record<string, unknown> = {}) {
  const replies: unknown[] = [];
  const interaction = {
    customId,
    guildId: GUILD_ID,
    channelId: '555555555555555555',
    user: { id: USER_ID },
    guild: null as unknown as Guild,
    member: null as unknown as GuildMember,
    inCachedGuild: () => true,
    replies,
    reply: vi.fn(async (payload: unknown) => {
      replies.push(payload);
    }),
    ...overrides,
  };
  return interaction;
}

function buttonDeps(overrides: Partial<TicketButtonDeps> = {}): TicketButtonDeps {
  return {
    getConfig: async () => config(),
    findOpenByChannel: async () => ticket(),
    claim: async () => ticket({ claimedBy: STAFF_ID }),
    closeAndArchive: async () => ({ ticket: ticket({ status: 'closed' }), channel: {} }) as never,
    showSubjectModal: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('handleTicketButton', () => {
  it('membuka modal untuk tombol buat', async () => {
    const showSubjectModal = vi.fn(async () => undefined);
    const interaction = buttonInteraction('ticket:create', {
      guild: { id: GUILD_ID } as unknown as Guild,
      member: { id: USER_ID, roles: { cache: new Map() }, permissions: { has: () => false } },
    });

    await handleTicketButton(interaction as never, buttonDeps({ showSubjectModal }));

    expect(showSubjectModal).toHaveBeenCalledTimes(1);
  });

  it('menolak klaim dari member biasa', async () => {
    const claim = vi.fn();
    const interaction = buttonInteraction('ticket:claim', {
      guild: { id: GUILD_ID } as unknown as Guild,
      member: { id: USER_ID, roles: { cache: new Map() }, permissions: { has: () => false } },
    });

    await handleTicketButton(
      interaction as never,
      buttonDeps({ claim: claim as never }),
    );

    expect(claim).not.toHaveBeenCalled();
    expectMessage(interaction as never, 'ticket.btn.claimNotStaff');
  });

  it('mengklaim tiket untuk staff', async () => {
    const claim = vi.fn(async () => ticket({ claimedBy: STAFF_ID }));
    const interaction = buttonInteraction('ticket:claim', {
      guild: { id: GUILD_ID } as unknown as Guild,
      member: { id: STAFF_ID, roles: { cache: new Map() }, permissions: { has: () => true } },
    });

    await handleTicketButton(
      interaction as never,
      buttonDeps({ claim: claim as never }),
    );

    expect(claim).toHaveBeenCalledTimes(1);
    expect(interaction.replies.length).toBe(1);
  });

  it('memberi tahu saat tiket sudah tertutup saat diklaim', async () => {
    const interaction = buttonInteraction('ticket:claim', {
      guild: { id: GUILD_ID } as unknown as Guild,
      member: { id: STAFF_ID, roles: { cache: new Map() }, permissions: { has: () => true } },
    });

    await handleTicketButton(
      interaction as never,
      buttonDeps({ findOpenByChannel: async () => null }),
    );

    expectMessage(interaction as never, 'ticket.err.alreadyClosed');
  });

  it('memberi tahu saat tiket sudah diklaim orang lain', async () => {
    // `claim` mengembalikan null kalau rebutannya kalah: tanpa ini yang kalah
    // akan tetap menampilkan "berhasil".
    const interaction = buttonInteraction('ticket:claim', {
      guild: { id: GUILD_ID } as unknown as Guild,
      member: { id: STAFF_ID, roles: { cache: new Map() }, permissions: { has: () => true } },
    });

    await handleTicketButton(
      interaction as never,
      buttonDeps({ claim: async () => null }),
    );

    expectMessage(interaction as never, 'ticket.err.alreadyClosed');
  });

  it('menolak menutup tiket milik orang lain', async () => {
    const OTHER_USER = '999999999999999999';
    const closeAndArchive = vi.fn();
    const interaction = buttonInteraction('ticket:close', {
      guild: { id: GUILD_ID } as unknown as Guild,
      // Bukan pemilik tiket dan bukan staff: satu-satunya alasan yang boleh
      // menutup sudah habis. `user` harus ikut diganti — penalannya
      // dibandingkan dengan `ticket.openerId` lewat `interaction.user.id`,
      // jadi hanya mengganti `member` tidak mengubah apa pun.
      user: { id: OTHER_USER },
      member: { id: OTHER_USER, roles: { cache: new Map() }, permissions: { has: () => false } },
    });

    await handleTicketButton(
      interaction as never,
      buttonDeps({ closeAndArchive: closeAndArchive as never }),
    );

    expect(closeAndArchive).not.toHaveBeenCalled();
    expectMessage(interaction as never, 'ticket.btn.closeNotAllowed');
  });

  it('membolehkan pemilik tiket menutup tiketnya sendiri', async () => {
    const closeAndArchive = vi.fn(async () => ({
      ticket: ticket({ status: 'closed' }),
      channel: {},
    })) as unknown as TicketButtonDeps['closeAndArchive'];
    const interaction = buttonInteraction('ticket:close', {
      guild: { id: GUILD_ID } as unknown as Guild,
      member: { id: USER_ID, roles: { cache: new Map() }, permissions: { has: () => false } },
    });

    await handleTicketButton(interaction as never, buttonDeps({ closeAndArchive }));

    expect(closeAndArchive).toHaveBeenCalledTimes(1);
    expect(interaction.replies.length).toBe(1);
  });

  it('memberi tahu saat channel tiket sudah hilang', async () => {
    const interaction = buttonInteraction('ticket:close', {
      guild: { id: GUILD_ID } as unknown as Guild,
      member: { id: USER_ID, roles: { cache: new Map() }, permissions: { has: () => false } },
    });

    await handleTicketButton(
      interaction as never,
      buttonDeps({
        closeAndArchive: (async () => ({ ticket: ticket({ status: 'closed' }), channel: null })) as never,
      }),
    );

    expect(interaction.replies.length).toBe(1);
  });

  it('memberi tahu saat modul tiket dimatikan, sebelum menyentuh apa pun', async () => {
    // Tombol yang tertinggal di channel lama harus menjelaskan, bukan diam.
    const findOpenByChannel = vi.fn();
    const interaction = buttonInteraction('ticket:close', {
      guild: { id: GUILD_ID } as unknown as Guild,
      member: { id: USER_ID, roles: { cache: new Map() }, permissions: { has: () => true } },
    });

    await handleTicketButton(
      interaction as never,
      buttonDeps({
        getConfig: async () => config({ modules: { tickets: false } } as Partial<GuildConfig>),
        findOpenByChannel: findOpenByChannel as never,
      }),
    );

    expect(findOpenByChannel).not.toHaveBeenCalled();
    expectMessage(interaction as never, 'ticket.err.moduleOff');
  });

  it('mengabaikan customId milik tombol lain', async () => {
    const getConfig = vi.fn();
    const interaction = buttonInteraction('musik:page:2', {
      guild: { id: GUILD_ID } as unknown as Guild,
    });

    await handleTicketButton(interaction as never, buttonDeps({ getConfig: getConfig as never }));

    expect(getConfig).not.toHaveBeenCalled();
    expect(interaction.replies.length).toBe(0);
  });

  it('mengabaikan tombol di luar guild', async () => {
    const getConfig = vi.fn();
    const interaction = buttonInteraction('ticket:claim', { inCachedGuild: () => false });

    await handleTicketButton(interaction as never, buttonDeps({ getConfig: getConfig as never }));

    expect(getConfig).not.toHaveBeenCalled();
  });

  it('menjawab dengan pesan error saat service melempar', async () => {
    const interaction = buttonInteraction('ticket:claim', {
      guild: { id: GUILD_ID } as unknown as Guild,
      member: { id: STAFF_ID, roles: { cache: new Map() }, permissions: { has: () => true } },
    });

    await handleTicketButton(
      interaction as never,
      buttonDeps({
        getConfig: async () => {
          throw new Error('database mati');
        },
      }),
    );

    expect(interaction.replies.length).toBe(1);
  });

  it('balasan yang sudah kedaluwarsa hanya dicatat, tidak dilempar', async () => {
    const interaction = buttonInteraction('ticket:claim', {
      guild: { id: GUILD_ID } as unknown as Guild,
      member: { id: USER_ID, roles: { cache: new Map() }, permissions: { has: () => false } },
      reply: vi.fn(async () => {
        throw new Error('Interaction token expired');
      }),
    });

    await expect(handleTicketButton(interaction as never, buttonDeps())).resolves.toBeUndefined();
  });
});

describe('isStaff', () => {
  const staffMember = (roles: Set<string>, has: (bit: bigint) => boolean) =>
    ({
      roles: { cache: { has: (id: string) => roles.has(id) } },
      permissions: { has },
    }) as unknown as GuildMember;

  it('menolak member yang tidak ada', () => {
    expect(isStaff(null, config())).toBe(false);
  });

  it('menerima pemilik role staff tiket', () => {
    const STAFF_ROLE = '777777777777777777';
    expect(
      isStaff(
        staffMember(new Set([STAFF_ROLE]), () => false),
        config({ ticketStaffRoleId: STAFF_ROLE }),
      ),
    ).toBe(true);
  });

  it('menerima yang punya Manage Channels', () => {
    expect(
      isStaff(
        staffMember(new Set(), (bit) => bit === PermissionFlagsBits.ManageChannels),
        config(),
      ),
    ).toBe(true);
  });

  it('menerima yang punya Manage Server', () => {
    expect(
      isStaff(
        staffMember(new Set(), (bit) => bit === PermissionFlagsBits.ManageGuild),
        config(),
      ),
    ).toBe(true);
  });

  it('menolak member biasa tanpa role staff dan tanpa izin', () => {
    expect(
      isStaff(
        staffMember(new Set(), () => false),
        config({ ticketStaffRoleId: '777777777777777777' }),
      ),
    ).toBe(false);
  });

  it('role staff yang dikonfigurasi tapi tidak ada dipakai sebagai milik siapa pun', () => {
    // Kosong berarti "semua yang punya Manage Channels/Server", bukan "tidak ada
    // yang boleh" — jadi configuring an empty role must not lock everyone out.
    expect(
      isStaff(
        staffMember(new Set(), () => false),
        config({ ticketStaffRoleId: null }),
      ),
    ).toBe(false);
  });
});
