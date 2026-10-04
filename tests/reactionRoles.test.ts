import { describe, expect, it } from 'vitest';
import {
  panelEmbed,
  panelListEmbed,
  panelClosedEmbed,
  buildRoleSelect,
} from '../src/modules/reactionroles/embeds.js';
import { ReactionRoleService } from '../src/modules/reactionroles/service.js';
import type { ReactionRoleRepository } from '../src/modules/reactionroles/repository.js';
import {
  MAX_PANEL_OPTIONS,
  isPanelActive,
  parseRoleOptionCustomId,
  roleOptionCustomId,
  type CreatePanelInput,
  type PanelOptionLookup,
  type ReactionRoleOption,
  type ReactionRolePanel,
  type RoleInput,
} from '../src/modules/reactionroles/types.js';
import {
  ReactionRoleValidationError,
  assertPanelKeepsOneOption,
  describePanelLifetime,
  normalizeRoleInputs,
  parsePanelDuration,
  parseRoleMentions,
} from '../src/modules/reactionroles/validation.js';

const GUILD_ID = '123456789012345678';
const ROLE_A = '222222222222222222';
const ROLE_B = '333333333333333333';
const CHANNEL_ID = '444444444444444444';

function option(overrides: Partial<ReactionRoleOption> = {}): ReactionRoleOption {
  return {
    id: 1,
    panelId: 1,
    roleId: ROLE_A,
    label: 'Pemain',
    emoji: null,
    description: null,
    position: 0,
    ...overrides,
  };
}

function panel(overrides: Partial<ReactionRolePanel> = {}): ReactionRolePanel {
  return {
    id: 1,
    guildId: GUILD_ID,
    channelId: CHANNEL_ID,
    messageId: null,
    expiresAt: null,
    closedAt: null,
    createdAt: new Date('2026-10-02T00:00:00.000Z'),
    updatedAt: new Date('2026-10-02T00:00:00.000Z'),
    options: [option()],
    ...overrides,
  };
}

class FakeReactionRoleRepository implements ReactionRoleRepository {
  public readonly panels: ReactionRolePanel[] = [];
  public nextPanelId = 1;
  public nextOptionId = 1;
  public readonly messages: { panelId: number; messageId: string }[] = [];

  private findPanel(id: number): ReactionRolePanel | undefined {
    return this.panels.find((item) => item.id === id);
  }

  async create(input: CreatePanelInput): Promise<ReactionRolePanel> {
    const created = panel({
      id: this.nextPanelId++,
      guildId: input.guildId,
      channelId: input.channelId,
      expiresAt: input.expiresAt,
      options: input.roles.map((role, index) =>
        option({
          id: this.nextOptionId++,
          panelId: this.nextPanelId,
          roleId: role.roleId,
          label: role.label ?? null,
          description: role.description ?? null,
          emoji: role.emoji ?? null,
          position: index,
        }),
      ),
    });
    this.panels.push(created);

    return { ...created };
  }

  async list(guildId: string): Promise<ReactionRolePanel[]> {
    return this.panels.filter((item) => item.guildId === guildId).map((item) => ({ ...item }));
  }

  async find(guildId: string, panelId: number): Promise<ReactionRolePanel | null> {
    const found = this.findPanel(panelId);
    return found && found.guildId === guildId ? { ...found } : null;
  }

  async addOptions(panelId: number, roles: readonly RoleInput[]): Promise<ReactionRolePanel | null> {
    const found = this.findPanel(panelId);
    if (!found) return null;

    found.options.push(
      ...roles.map((role, index) =>
        option({
          id: this.nextOptionId++,
          panelId,
          roleId: role.roleId,
          label: role.label ?? null,
          position: found.options.length + index,
        }),
      ),
    );

    return { ...found };
  }

  async removeOptions(
    panelId: number,
    roleIds: readonly string[],
  ): Promise<ReactionRolePanel | null> {
    const found = this.findPanel(panelId);
    if (!found) return null;

    found.options = found.options.filter((item) => !roleIds.includes(item.roleId));

    return { ...found };
  }

  async delete(guildId: string, panelId: number): Promise<ReactionRolePanel | null> {
    const index = this.panels.findIndex((item) => item.id === panelId && item.guildId === guildId);
    if (index < 0) return null;

    const [removed] = this.panels.splice(index, 1);

    return removed ? { ...removed } : null;
  }

  async findOption(optionId: number): Promise<PanelOptionLookup | null> {
    for (const item of this.panels) {
      const found = item.options.find((candidate) => candidate.id === optionId);
      if (found) return { panel: { ...item }, option: found };
    }

    return null;
  }

  async attachMessage(panelId: number, messageId: string): Promise<void> {
    this.messages.push({ panelId, messageId });
    const found = this.findPanel(panelId);
    if (found) found.messageId = messageId;
  }

  async markClosed(
    guildId: string,
    panelId: number,
    now: Date,
  ): Promise<ReactionRolePanel | null> {
    const found = this.findPanel(panelId);
    if (!found || found.guildId !== guildId || found.closedAt) return null;

    found.closedAt = now;

    return { ...found };
  }

  async findDueForExpiry(
    now: Date,
    guildIds: readonly string[],
    limit: number,
  ): Promise<ReactionRolePanel[]> {
    const owned = new Set(guildIds);

    return this.panels
      .filter(
        (item) =>
          owned.has(item.guildId) &&
          !item.closedAt &&
          item.expiresAt !== null &&
          item.expiresAt <= now,
      )
      .sort((a, b) => (a.expiresAt?.getTime() ?? 0) - (b.expiresAt?.getTime() ?? 0))
      .slice(0, limit)
      .map((item) => ({ ...item }));
  }
}

function makeService(): { repository: FakeReactionRoleRepository; service: ReactionRoleService } {
  const repository = new FakeReactionRoleRepository();

  return { repository, service: new ReactionRoleService(repository) };
}

describe('parseRoleMentions', () => {
  it('membaca beberapa mention role', () => {
    expect(parseRoleMentions(`<@&${ROLE_A}> <@&${ROLE_B}>`)).toEqual([ROLE_A, ROLE_B]);
  });

  it('membaca mention yang dipisah koma', () => {
    expect(parseRoleMentions(`<@&${ROLE_A}>, <@&${ROLE_B}>`)).toEqual([ROLE_A, ROLE_B]);
  });

  it('membaca ID polos saat tidak ada mention', () => {
    expect(parseRoleMentions(`${ROLE_A} ${ROLE_B}`)).toEqual([ROLE_A, ROLE_B]);
  });

  it('mention menang: angka di dalamnya tidak dihitung dua kali', () => {
    expect(parseRoleMentions(`<@&${ROLE_A}>`)).toEqual([ROLE_A]);
  });

  it('deduplikasi role yang disebut dua kali', () => {
    expect(parseRoleMentions(`<@&${ROLE_A}> <@&${ROLE_A}>`)).toEqual([ROLE_A]);
  });

  it('menolak input kosong dengan panduan', () => {
    expect(() => parseRoleMentions('')).toThrow(/minimal satu role/);
    expect(() => parseRoleMentions(null)).toThrow(/minimal satu role/);
  });

  it('menolak teks yang tidak bisa jadi ID,explain pilih lewat autocomplete', () => {
    expect(() => parseRoleMentions('@Pemain @Penggemar')).toThrow(/autocomplete/);
  });
});

describe('normalizeRoleInputs', () => {
  it('memotong label & deskripsi ke batas Discord', () => {
    const [result] = normalizeRoleInputs([
      { roleId: ROLE_A, label: 'x'.repeat(200), description: 'y'.repeat(200) },
    ]);

    expect(result?.label).toHaveLength(100);
    expect(result?.description).toHaveLength(100);
  });

  it('label kosong menjadi null, bukan string kosong', () => {
    const [result] = normalizeRoleInputs([{ roleId: ROLE_A, label: '   ' }]);

    expect(result?.label).toBeNull();
  });

  it('membuang role yang sudah ada di panel', () => {
    const result = normalizeRoleInputs([{ roleId: ROLE_A }, { roleId: ROLE_B }], [ROLE_A]);

    expect(result.map((role) => role.roleId)).toEqual([ROLE_B]);
  });

  it('deduplikasi di dalam satu perintah', () => {
    const result = normalizeRoleInputs([{ roleId: ROLE_A }, { roleId: ROLE_A }]);

    expect(result).toHaveLength(1);
  });

  it('menolak ID yang bukan snowflake', () => {
    expect(() => normalizeRoleInputs([{ roleId: 'abc' }])).toThrow(ReactionRoleValidationError);
  });

  it('menolak panel yang melebihi batas opsi Discord', () => {
    const existing = Array.from({ length: MAX_PANEL_OPTIONS - 1 }, (_, index) => ({
      roleId: String(100_000_000_000_000_000n + BigInt(index)),
    }));
    const additions = [{ roleId: ROLE_A }, { roleId: ROLE_B }];

    expect(() =>
      normalizeRoleInputs(additions, existing.map((role) => role.roleId)),
    ).toThrow(/maksimal 25 role/);
  });

  it('menerima tepat batas opsi', () => {
    const many = Array.from({ length: MAX_PANEL_OPTIONS }, (_, index) => ({
      roleId: String(100_000_000_000_000_000n + BigInt(index)),
    }));

    expect(normalizeRoleInputs(many)).toHaveLength(MAX_PANEL_OPTIONS);
  });
});

describe('assertPanelKeepsOneOption', () => {
  it('menolak penghapusan opsi terakhir', () => {
    expect(() => assertPanelKeepsOneOption(0)).toThrow(/opsi terakhir/);
  });

  it('menerima panel yang masih punya satu opsi', () => {
    expect(() => assertPanelKeepsOneOption(1)).not.toThrow();
  });
});

describe('ReactionRoleService', () => {
  it('membuat panel beserta opsinya', async () => {
    const { service } = makeService();

    const created = await service.create({
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      expiresAt: null,
      roles: [{ roleId: ROLE_A, label: 'Pemain' }, { roleId: ROLE_B, label: 'Penggemar' }],
    });

    expect(created.id).toBe(1);
    expect(created.options.map((item) => item.roleId)).toEqual([ROLE_A, ROLE_B]);
    expect(created.options.map((item) => item.position)).toEqual([0, 1]);
  });

  it('menolak panel tanpa role', async () => {
    const { service } = makeService();

    await expect(
      service.create({ guildId: GUILD_ID, channelId: CHANNEL_ID, expiresAt: null, roles: [] }),
    ).rejects.toThrow(/minimal satu role/);
  });

  it('menolak menambah role yang sudah ada', async () => {
    const { service } = makeService();
    await service.create({ guildId: GUILD_ID, channelId: CHANNEL_ID, expiresAt: null, roles: [{ roleId: ROLE_A }] });

    await expect(service.addRoles(GUILD_ID, 1, [{ roleId: ROLE_A }])).rejects.toThrow(
      /sudah ada di panel/,
    );
  });

  it('menambah role baru ke panel', async () => {
    const { service } = makeService();
    await service.create({ guildId: GUILD_ID, channelId: CHANNEL_ID, expiresAt: null, roles: [{ roleId: ROLE_A }] });

    const panel = await service.addRoles(GUILD_ID, 1, [{ roleId: ROLE_B }]);

    expect(panel?.options).toHaveLength(2);
  });

  it('panel di server lain tidak bisa diubah', async () => {
    const { service } = makeService();
    await service.create({ guildId: GUILD_ID, channelId: CHANNEL_ID, expiresAt: null, roles: [{ roleId: ROLE_A }] });

    await expect(service.addRoles('999999999999999999', 1, [{ roleId: ROLE_B }])).resolves.toBeNull();
    await expect(service.removeRoles('999999999999999999', 1, [ROLE_A])).resolves.toBeNull();
    await expect(service.delete('999999999999999999', 1)).resolves.toBeNull();
  });

  it('menolak menghapus semua opsi dari panel', async () => {
    const { service } = makeService();
    await service.create({ guildId: GUILD_ID, channelId: CHANNEL_ID, expiresAt: null, roles: [{ roleId: ROLE_A }] });

    await expect(service.removeRoles(GUILD_ID, 1, [ROLE_A])).rejects.toThrow(/opsi terakhir/);
  });

  it('hapus role yang memang ada di panel', async () => {
    const { service } = makeService();
    await service.create({
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      expiresAt: null,
      roles: [{ roleId: ROLE_A }, { roleId: ROLE_B }],
    });

    const panel = await service.removeRoles(GUILD_ID, 1, [ROLE_A]);

    expect(panel?.options.map((item) => item.roleId)).toEqual([ROLE_B]);
  });

  it('mencari opsi lewat customId', async () => {
    const { service } = makeService();
    const created = await service.create({
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      expiresAt: null,
      roles: [{ roleId: ROLE_A }],
    });

    const lookup = await service.findOption(created.options[0]!.id);

    expect(lookup?.option.roleId).toBe(ROLE_A);
    expect(lookup?.panel.id).toBe(created.id);
  });

  it('opsi yang sudah dihapus tidak ditemukan', async () => {
    const { service } = makeService();

    await expect(service.findOption(999)).resolves.toBeNull();
  });

  it('attachMessage gagal tidak menggagalkan pemanggil', async () => {
    const { repository, service } = makeService();
    repository.attachMessage = async () => {
      throw new Error('database mati');
    };

    await expect(service.attachMessage(1, '123')).resolves.toBeUndefined();
  });
});

describe('customId opsi role', () => {
  it('encode lalu decode kembali ke id yang sama', () => {
    expect(roleOptionCustomId(42)).toBe('rr:42');
    expect(parseRoleOptionCustomId('rr:42')).toBe(42);
  });

  it('menolak customId milik fitur lain', () => {
    expect(parseRoleOptionCustomId('ticket:create')).toBeNull();
    expect(parseRoleOptionCustomId('rr-panel-1')).toBeNull();
  });

  it('menolak angka tidak valid', () => {
    expect(parseRoleOptionCustomId('rr:abc')).toBeNull();
    expect(parseRoleOptionCustomId('rr:0')).toBeNull();
  });
});

describe('embed & komponen panel', () => {
  const names = new Map([
    [ROLE_A, 'Pemain'],
    [ROLE_B, 'Penggemar'],
  ]);

  it('embed menyebut cara melepas role', () => {
    const rendered = JSON.stringify(panelEmbed(panel(), names).toJSON());

    expect(rendered).toContain('Pilih role di bawah');
    expect(rendered).toContain('melepaskannya');
    expect(rendered).toContain('Pemain');
  });

  it('deskripsi admin menggantikan teks bawaan', () => {
    const rendered = JSON.stringify(panelEmbed(panel(), names, 'Ambil role-cool kamu di sini.').toJSON());

    expect(rendered).toContain('Ambil role-cool');
    expect(rendered).not.toContain('Pilih role di bawah');
  });

  it('select menu memakai customId per opsi', () => {
    const row = buildRoleSelect(panel({ options: [option({ id: 7 })] }), names);
    const json = row?.toJSON() as { components: { custom_id: string; options: { label: string }[] }[] };

    expect(json.components[0]?.custom_id).toBe('rr-panel-1');
    expect(json.components[0]?.options[0]?.label).toBe('Pemain');
  });

  it('label opsi dipotong ke batas Discord', () => {
    const row = buildRoleSelect(panel({ options: [option({ label: 'z'.repeat(300) })] }), names);
    const json = row?.toJSON() as { components: { options: { label: string }[] }[] };

    expect(json.components[0]?.options[0]?.label.length).toBeLessThanOrEqual(100);
  });

  it('nama role asli dipakai saat label kosong', () => {
    const row = buildRoleSelect(panel({ options: [option({ label: null })] }), names);
    const json = row?.toJSON() as { components: { options: { label: string }[] }[] };

    expect(json.components[0]?.options[0]?.label).toBe('Pemain');
  });

  it('panel tanpa opsi tidak menghasilkan komponen', () => {
    expect(buildRoleSelect(panel({ options: [] }), names)).toBeNull();
  });

  it('daftar panel kosong memberi cara membuat', () => {
    expect(panelListEmbed([]).toJSON().description).toContain('/reactionrole post');
  });

  it('daftar panel menyebut nomor, channel, dan jumlah role', () => {
    const json = panelListEmbed([panel({ options: [option(), option({ id: 2, roleId: ROLE_B })] })]).toJSON();

    expect(json.description).toContain('**#1**');
    expect(json.description).toContain(`<#${CHANNEL_ID}>`);
    expect(json.description).toContain('2 role');
  });
});

describe('masa hidup panel', () => {
  const NOW = new Date('2026-10-02T12:00:00.000Z');

  it('input kosong berarti permanen, bukan kesalahan', () => {
    expect(parsePanelDuration(undefined, NOW)).toBeNull();
    expect(parsePanelDuration('', NOW)).toBeNull();
  });

  it('kata permanen eksplisit juga berarti permanen', () => {
    expect(parsePanelDuration('permanen', NOW)).toBeNull();
    expect(parsePanelDuration('  Selamanya ', NOW)).toBeNull();
  });

  it('menerima menit, jam, dan hari', () => {
    expect(parsePanelDuration('30m', NOW)?.toISOString()).toBe('2026-10-02T12:30:00.000Z');
    expect(parsePanelDuration('6h', NOW)?.toISOString()).toBe('2026-10-02T18:00:00.000Z');
    expect(parsePanelDuration('7d', NOW)?.toISOString()).toBe('2026-10-09T12:00:00.000Z');
  });

  it('tanpa satuan dibaca sebagai jam', () => {
    expect(parsePanelDuration('2', NOW)?.toISOString()).toBe('2026-10-02T14:00:00.000Z');
  });

  it('menolak satuan yang tidak dikenal', () => {
    expect(() => parsePanelDuration('7minggu', NOW)).toThrow(/tidak dikenal/);
  });

  it('menolak input yang sama sekali tidak terbaca', () => {
    expect(() => parsePanelDuration('seminggu', NOW)).toThrow(/tidak terbaca/);
  });

  it('menolak masa hidup yang terlalu pendek', () => {
    expect(() => parsePanelDuration('5m', NOW)).toThrow(/minimal 10 menit/);
  });

  it('menolak masa hidup yang melebihi setahun', () => {
    expect(() => parsePanelDuration('400d', NOW)).toThrow(/maksimal 365 hari/);
  });

  it('mendeskripsikan masa hidup dalam bahasa manusia', () => {
    expect(describePanelLifetime(7 * 86_400_000)).toBe('7 hari');
    expect(describePanelLifetime(6 * 3_600_000)).toBe('6 jam');
    expect(describePanelLifetime(30 * 60_000)).toBe('30 menit');
  });
});

describe('isPanelActive', () => {
  const NOW = new Date('2026-10-02T12:00:00.000Z');

  it('panel permanen tanpa masa hidup selalu aktif', () => {
    expect(isPanelActive(panel(), NOW)).toBe(true);
  });

  it('panel dengan masa hidup yang belum habis masih aktif', () => {
    const future = panel({ expiresAt: new Date('2026-10-03T12:00:00.000Z') });

    expect(isPanelActive(future, NOW)).toBe(true);
  });

  it('panel yang sudah lewat masa hidup tidak aktif walau belum disapu', () => {
    const past = panel({ expiresAt: new Date('2026-10-01T12:00:00.000Z') });

    expect(isPanelActive(past, NOW)).toBe(false);
  });

  it('panel yang sudah ditutup tidak aktif walau masa hidupnya panjang', () => {
    const closed = panel({ expiresAt: null, closedAt: new Date('2026-10-01T12:00:00.000Z') });

    expect(isPanelActive(closed, NOW)).toBe(false);
  });

  it('tepat di detik kedaluwarsa sudah dianggap habis', () => {
    const exact = panel({ expiresAt: NOW });

    expect(isPanelActive(exact, NOW)).toBe(false);
  });
});

describe('penyapuan masa hidup', () => {
  const NOW = new Date('2026-10-02T12:00:00.000Z');

  async function seed(): Promise<{ repository: FakeReactionRoleRepository; service: ReactionRoleService }> {
    const { repository, service } = makeService();

    await service.create({
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      expiresAt: new Date('2026-10-01T12:00:00.000Z'),
      roles: [{ roleId: ROLE_A }],
    });
    await service.create({
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      expiresAt: new Date('2026-10-05T12:00:00.000Z'),
      roles: [{ roleId: ROLE_B }],
    });

    return { repository, service };
  }

  it('hanya panel yang sudah lewat masa hidup yang ikut disapu', async () => {
    const { service } = await seed();

    const due = await service.findDueForExpiry(NOW, [GUILD_ID], 10);

    expect(due.map((item) => item.id)).toEqual([1]);
  });

  it('panel yang sudah ditutup tidak muncul lagi di sapuan berikutnya', async () => {
    const { service } = await seed();
    await service.markClosed(GUILD_ID, 1, NOW);

    expect(await service.findDueForExpiry(NOW, [GUILD_ID], 10)).toEqual([]);
  });

  it('panel permanen tidak pernah masuk daftar sapuan', async () => {
    const { service } = makeService();
    await service.create({
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      expiresAt: null,
      roles: [{ roleId: ROLE_A }],
    });

    expect(await service.findDueForExpiry(NOW, [GUILD_ID], 10)).toEqual([]);
  });

  it('menandai panel tertutup hanya sekali', async () => {
    const { service } = await seed();

    const first = await service.markClosed(GUILD_ID, 1, NOW);
    const second = await service.markClosed(GUILD_ID, 1, new Date('2026-10-03T00:00:00.000Z'));

    expect(first?.closedAt).toEqual(NOW);
    expect(second).toBeNull();
  });

  it('panel di server lain tidak bisa ditandai tertutup', async () => {
    const { service } = await seed();

    expect(await service.markClosed('999999999999999999', 1, NOW)).toBeNull();
  });

  it('batas batch dipatuhi supaya satu guild tidak meledakkan API', async () => {
    const { repository, service } = makeService();
    for (let index = 0; index < 3; index += 1) {
      repository.panels.push(
        panel({ id: index + 1, expiresAt: new Date('2026-10-01T12:00:00.000Z') }),
      );
    }

    expect(await service.findDueForExpiry(NOW, [GUILD_ID], 2)).toHaveLength(2);
  });
});

describe('embed panel tanpa masa hidup', () => {
  it('panel permanen menyebut kata permanen', () => {
    const json = panelEmbed(panel(), new Map()).toJSON();

    expect(json.footer?.text).toContain('tanpa masa hidup');
  });

  it('panel berjangka memuat timestamp Discord', () => {
    const json = panelEmbed(
      panel({ expiresAt: new Date('2026-10-09T12:00:00.000Z') }),
      new Map(),
    ).toJSON();

    // Unix 9 Okt 2026 12:00 UTC, format relatif supaya ikut zona waktu member.
    expect(json.footer?.text).toContain('<t:1791547200:R>');
  });

  it('embed tertutup menyatakan select menu sudah dilepas', () => {
    const json = panelClosedEmbed(panel({ closedAt: new Date() }), 'Sudah habis.').toJSON();

    expect(json.description).toContain('Sudah habis.');
    expect(json.description).toContain('sudah tidak bisa dipakai');
  });

  it('daftar membedakan panel yang ditutup dari yang masih aktif', () => {
    const closed = panel({ id: 1, messageId: '555', closedAt: new Date() });
    const alive = panel({ id: 2, messageId: '555', expiresAt: null });

    const json = panelListEmbed([closed, alive]).toJSON() as { description: string };

    expect(json.description).toContain('sudah ditutup');
    expect(json.description).toContain('🟢 aktif');
  });

  it('panel yang lewat masa hidup tapi belum disapu ditandai berbeda', () => {
    const stale = panel({ id: 1, expiresAt: new Date('2026-10-01T00:00:00.000Z') });

    const json = panelListEmbed([stale]).toJSON() as { description: string };

    expect(json.description).toContain('menunggu sapuan');
  });
});