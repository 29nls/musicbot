import { describe, expect, it } from 'vitest';
import { defaultTranslator } from '../src/modules/i18n/index.js';
import {
  giveawayComponents,
  giveawayEmbed,
  giveawayEndedEmbed,
} from '../src/modules/giveaways/embeds.js';
import type {
  GiveawayRepository,
  AddEntryResult,
} from '../src/modules/giveaways/repository.js';
import { GiveawayService } from '../src/modules/giveaways/service.js';
import {
  GIVEAWAY_JOIN_PREFIX,
  giveawayJoinCustomId,
  isGiveawayActive,
  parseGiveawayJoinCustomId,
  type CreateGiveawayInput,
  type Giveaway,
} from '../src/modules/giveaways/types.js';
import {
  GiveawayValidationError,
  normalizePrize,
  normalizeWinnersCount,
  parseGiveawayDuration,
  pickWinners,
} from '../src/modules/giveaways/validation.js';

const GUILD_ID = '123456789012345678';
const OTHER_GUILD_ID = '987654321098765432';
const USER_A = '222222222222222222';
const USER_B = '333333333333333333';
const USER_C = '444444444444444444';
const CHANNEL_ID = '555555555555555555';

const NOW = new Date('2026-11-21T12:00:00.000Z');

class FakeGiveawayRepository implements GiveawayRepository {
  public readonly rows: Giveaway[] = [];
  public readonly entries = new Map<number, string[]>();
  private nextId = 1;

  async create(input: CreateGiveawayInput): Promise<Giveaway> {
    const giveaway: Giveaway = {
      id: this.nextId++,
      guildId: input.guildId,
      channelId: input.channelId,
      messageId: null,
      prize: input.prize,
      winnersCount: input.winnersCount,
      endsAt: input.endsAt,
      endedAt: null,
      createdAt: NOW,
    };
    this.rows.push(giveaway);
    this.entries.set(giveaway.id, []);

    return { ...giveaway };
  }

  async attachMessage(giveawayId: number, messageId: string): Promise<void> {
    const giveaway = this.rows.find((item) => item.id === giveawayId);
    if (giveaway) giveaway.messageId = messageId;
  }

  async find(guildId: string, giveawayId: number): Promise<Giveaway | null> {
    const giveaway = this.rows.find(
      (item) => item.id === giveawayId && item.guildId === guildId,
    );

    return giveaway ? { ...giveaway } : null;
  }

  async findDue(
    now: Date,
    guildIds: readonly string[],
    limit: number,
  ): Promise<Giveaway[]> {
    return this.rows
      .filter(
        (item) =>
          item.endedAt === null &&
          item.endsAt.getTime() <= now.getTime() &&
          guildIds.includes(item.guildId),
      )
      .slice(0, limit)
      .map((item) => ({ ...item }));
  }

  async markEnded(
    guildId: string,
    giveawayId: number,
    now: Date,
  ): Promise<Giveaway | null> {
    const giveaway = this.rows.find(
      (item) => item.id === giveawayId && item.guildId === guildId,
    );
    if (!giveaway || giveaway.endedAt) return null;

    giveaway.endedAt = now;
    return { ...giveaway };
  }

  async addEntry(
    giveawayId: number,
    userId: string,
    now: Date,
  ): Promise<AddEntryResult> {
    const giveaway = this.rows.find((item) => item.id === giveawayId);
    if (!giveaway || giveaway.endedAt || giveaway.endsAt.getTime() <= now.getTime()) {
      return 'closed';
    }

    const entries = this.entries.get(giveawayId) ?? [];
    if (entries.includes(userId)) return 'duplicate';
    entries.push(userId);
    this.entries.set(giveawayId, entries);

    return 'added';
  }

  async listEntryUserIds(giveawayId: number): Promise<string[]> {
    return [...(this.entries.get(giveawayId) ?? [])];
  }

  async deleteEntries(giveawayId: number): Promise<number> {
    const count = this.entries.get(giveawayId)?.length ?? 0;
    this.entries.set(giveawayId, []);

    return count;
  }

  async delete(guildId: string, giveawayId: number): Promise<void> {
    const index = this.rows.findIndex(
      (item) => item.id === giveawayId && item.guildId === guildId,
    );
    if (index >= 0) this.rows.splice(index, 1);
  }

  async countEntriesForUser(guildId: string, userId: string): Promise<number> {
    let count = 0;
    for (const giveaway of this.rows) {
      if (giveaway.guildId !== guildId) continue;
      if ((this.entries.get(giveaway.id) ?? []).includes(userId)) count += 1;
    }

    return count;
  }

  async deleteEntriesForUser(guildId: string, userId: string): Promise<number> {
    let count = 0;
    for (const giveaway of this.rows) {
      if (giveaway.guildId !== guildId) continue;
      const entries = this.entries.get(giveaway.id) ?? [];
      if (!entries.includes(userId)) continue;
      this.entries.set(
        giveaway.id,
        entries.filter((entry) => entry !== userId),
      );
      count += 1;
    }

    return count;
  }
}

function makeService(random: () => number = () => 0): {
  repository: FakeGiveawayRepository;
  service: GiveawayService;
} {
  const repository = new FakeGiveawayRepository();
  return { repository, service: new GiveawayService(repository, random) };
}

function input(overrides: Partial<CreateGiveawayInput> = {}): CreateGiveawayInput {
  return {
    guildId: GUILD_ID,
    channelId: CHANNEL_ID,
    prize: 'Nitro 1 bulan',
    winnersCount: 1,
    endsAt: new Date(NOW.getTime() + 60_000),
    ...overrides,
  };
}

describe('customId tombol giveaway', () => {
  it('encode lalu decode', () => {
    expect(giveawayJoinCustomId(42)).toBe(`${GIVEAWAY_JOIN_PREFIX}42`);
    expect(parseGiveawayJoinCustomId(giveawayJoinCustomId(42))).toBe(42);
  });

  it('menolak customId fitur lain dan angka tidak sah', () => {
    expect(parseGiveawayJoinCustomId('ticket:create')).toBeNull();
    expect(parseGiveawayJoinCustomId('giveaway:join:')).toBeNull();
    expect(parseGiveawayJoinCustomId('giveaway:join:0')).toBeNull();
    expect(parseGiveawayJoinCustomId('giveaway:join:abc')).toBeNull();
  });
});

describe('parseGiveawayDuration', () => {
  it('membaca menit, jam, dan hari', () => {
    expect(parseGiveawayDuration('10m', NOW).getTime()).toBe(NOW.getTime() + 600_000);
    expect(parseGiveawayDuration('2h', NOW).getTime()).toBe(NOW.getTime() + 7_200_000);
    expect(parseGiveawayDuration('7d', NOW).getTime()).toBe(NOW.getTime() + 604_800_000);
  });

  it('tanpa satuan dianggap menit', () => {
    expect(parseGiveawayDuration('10', NOW).getTime()).toBe(NOW.getTime() + 600_000);
  });

  it('menolak input kosong, tidak terbaca, dan satuan asing', () => {
    expect(() => parseGiveawayDuration('', NOW)).toThrow(GiveawayValidationError);
    expect(() => parseGiveawayDuration('abc', NOW)).toThrow(GiveawayValidationError);
    expect(() => parseGiveawayDuration('10x', NOW)).toThrow(GiveawayValidationError);
  });

  it('menjaga batas satu menit dan 30 hari', () => {
    expect(() => parseGiveawayDuration('0m', NOW)).toThrow(/minimal/);
    expect(() => parseGiveawayDuration('31d', NOW)).toThrow(/maksimal/);
  });
});

describe('normalisasi input', () => {
  it('meratakan spasi hadiah', () => {
    expect(normalizePrize('  Nitro   1 bulan  ')).toBe('Nitro 1 bulan');
  });

  it('menolak hadiah kosong', () => {
    expect(() => normalizePrize('   ')).toThrow(/wajib diisi/);
  });

  it('menolak jumlah pemenang di luar rentang', () => {
    expect(() => normalizeWinnersCount(0)).toThrow(/antara/);
    expect(() => normalizeWinnersCount(21)).toThrow(/antara/);
    expect(() => normalizeWinnersCount(1.5)).toThrow(/antara/);
    expect(normalizeWinnersCount(20)).toBe(20);
  });
});

describe('pickWinners', () => {
  it('mengembalikan pemenang unik tanpa mengubah daftar asli', () => {
    const entries = [USER_A, USER_B, USER_B, USER_C];

    const winners = pickWinners(entries, 2, () => 0);

    expect(winners).toEqual([USER_A, USER_B]);
    expect(entries).toEqual([USER_A, USER_B, USER_B, USER_C]);
  });

  it('tidak memilih lebih banyak dari jumlah peserta', () => {
    expect(pickWinners([USER_A], 5)).toEqual([USER_A]);
    expect(pickWinners([], 5)).toEqual([]);
  });
});

describe('GiveawayService', () => {
  it('membuat giveaway dengan hadiah dan jumlah pemenang yang sudah divalidasi', async () => {
    const { service } = makeService();

    const giveaway = await service.create(input({ prize: '  Nitro   ', winnersCount: 2 }));

    expect(giveaway.prize).toBe('Nitro');
    expect(giveaway.winnersCount).toBe(2);
    expect(giveaway.endedAt).toBeNull();
  });

  it('menolak join ke giveaway yang tidak ada atau sudah lewat waktu', async () => {
    const { repository, service } = makeService();
    const giveaway = await service.create(input());

    expect(await service.join(OTHER_GUILD_ID, giveaway.id, USER_A)).toBe('missing');

    repository.rows[0]!.endsAt = new Date(NOW.getTime() - 1);
    expect(await service.join(GUILD_ID, giveaway.id, USER_A, NOW)).toBe('closed');
  });

  it('join idempoten: user yang sama tidak masuk dua kali', async () => {
    const { service } = makeService();
    const giveaway = await service.create(input());

    expect(await service.join(GUILD_ID, giveaway.id, USER_A, NOW)).toBe('added');
    expect(await service.join(GUILD_ID, giveaway.id, USER_A, NOW)).toBe('duplicate');
  });

  it('menutup giveaway, memilih pemenang, lalu menghapus entri peserta', async () => {
    const { repository, service } = makeService(() => 0);
    const giveaway = await service.create(input({ winnersCount: 2 }));
    await service.join(GUILD_ID, giveaway.id, USER_A, NOW);
    await service.join(GUILD_ID, giveaway.id, USER_B, NOW);

    const outcome = await service.end(GUILD_ID, giveaway.id, NOW);

    expect(outcome).toMatchObject({ changed: true, entryCount: 2 });
    expect(outcome?.winners).toEqual([USER_A, USER_B]);
    expect(repository.entries.get(giveaway.id)).toEqual([]);
  });

  it('penutupan kedua tidak mengumumkan pemenang lagi', async () => {
    const { service } = makeService();
    const giveaway = await service.create(input());
    await service.join(GUILD_ID, giveaway.id, USER_A, NOW);

    const first = await service.end(GUILD_ID, giveaway.id, NOW);
    const second = await service.end(GUILD_ID, giveaway.id, NOW);

    expect(first?.changed).toBe(true);
    expect(second).toMatchObject({ changed: false, winners: [] });
  });

  it('dua penutupan bersamaan hanya menghasilkan satu pemenang', async () => {
    const { service } = makeService();
    const giveaway = await service.create(input());
    await service.join(GUILD_ID, giveaway.id, USER_A, NOW);

    const [first, second] = await Promise.all([
      service.end(GUILD_ID, giveaway.id, NOW),
      service.end(GUILD_ID, giveaway.id, NOW),
    ]);

    expect([first?.changed, second?.changed].filter(Boolean)).toHaveLength(1);
  });

  it('findDue hanya mengembalikan giveaway aktif yang sudah waktunya', async () => {
    const { service } = makeService();
    const due = await service.create(
      input({ endsAt: new Date(NOW.getTime() - 1) }),
    );
    await service.create(input({ endsAt: new Date(NOW.getTime() + 60_000) }));

    const found = await service.findDue(NOW, [GUILD_ID], 10);

    expect(found.map((item) => item.id)).toEqual([due.id]);
  });
});

describe('tampilan giveaway', () => {
  it('embed aktif memuat hadiah dan timestamp berakhir', async () => {
    const { service } = makeService();
    const giveaway = await service.create(input());
    const json = giveawayEmbed(giveaway).toJSON();

    expect(json.title).toContain('Nitro 1 bulan');
    expect(json.description).toContain('tombol');
    expect(JSON.stringify(json.fields)).toContain('<t:');
  });

  it('tombol memakai customId giveaway yang bisa dibaca handler', async () => {
    const { service } = makeService();
    const giveaway = await service.create(input());
    const row = giveawayComponents(giveaway.id).toJSON();
    const button = row.components[0] as { custom_id?: string; label?: string };

    expect(button.custom_id).toBe(giveawayJoinCustomId(giveaway.id));
    expect(button.label).toBe('Ikut Giveaway');
  });

  it('embed hasil menyebut pemenang dan jumlah peserta', async () => {
    const { service } = makeService();
    const giveaway = await service.create(input());
    const json = giveawayEndedEmbed(
      giveaway,
      [USER_A],
      3,
      defaultTranslator,
    ).toJSON();

    expect(json.description).toContain(`<@${USER_A}>`);
    expect(JSON.stringify(json.fields)).toContain('3');
  });

  it('embed hasil tanpa peserta memberi kabar apa adanya', async () => {
    const { service } = makeService();
    const giveaway = await service.create(input());
    const json = giveawayEndedEmbed(giveaway, [], 0).toJSON();

    expect(json.description).toContain('Tidak ada yang ikut');
  });
});

describe('isGiveawayActive', () => {
  it('aktif hanya sebelum waktu habis dan selama belum ditutup', async () => {
    const { service } = makeService();
    const giveaway = await service.create(input());

    expect(isGiveawayActive(giveaway, NOW)).toBe(true);
    expect(isGiveawayActive(giveaway, new Date(NOW.getTime() + 60_001))).toBe(false);
    expect(isGiveawayActive({ ...giveaway, endedAt: NOW }, NOW)).toBe(false);
  });
});
