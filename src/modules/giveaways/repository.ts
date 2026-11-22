import type { PrismaClient } from '../../generated/prisma/client.js';
import type { CreateGiveawayInput, Giveaway } from './types.js';

/** Hasil menambah entri: bentrok berarti user sudah terdaftar. */
export type AddEntryResult = 'added' | 'duplicate' | 'closed';

/** Kontrak penyimpanan giveaway — bisa diganti fake di tes. */
export interface GiveawayRepository {
  create(input: CreateGiveawayInput): Promise<Giveaway>;
  attachMessage(giveawayId: number, messageId: string): Promise<void>;
  find(guildId: string, giveawayId: number): Promise<Giveaway | null>;
  findDue(now: Date, guildIds: readonly string[], limit: number): Promise<Giveaway[]>;
  markEnded(guildId: string, giveawayId: number, now: Date): Promise<Giveaway | null>;
  addEntry(giveawayId: number, userId: string, now: Date): Promise<AddEntryResult>;
  listEntryUserIds(giveawayId: number): Promise<string[]>;
  deleteEntries(giveawayId: number): Promise<number>;
  delete(guildId: string, giveawayId: number): Promise<void>;
  countEntriesForUser(guildId: string, userId: string): Promise<number>;
  deleteEntriesForUser(guildId: string, userId: string): Promise<number>;
}

interface GiveawayRow {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  prize: string;
  winnersCount: number;
  endsAt: Date;
  endedAt: Date | null;
  createdAt: Date;
}

function toDomain(row: GiveawayRow): Giveaway {
  return {
    id: row.id,
    guildId: row.guildId,
    channelId: row.channelId,
    messageId: row.messageId,
    prize: row.prize,
    winnersCount: row.winnersCount,
    endsAt: row.endsAt,
    endedAt: row.endedAt,
    createdAt: row.createdAt,
  };
}

export class PrismaGiveawayRepository implements GiveawayRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateGiveawayInput): Promise<Giveaway> {
    const row = await this.prisma.giveaway.create({
      data: {
        guildId: input.guildId,
        channelId: input.channelId,
        prize: input.prize,
        winnersCount: input.winnersCount,
        endsAt: input.endsAt,
      },
    });

    return toDomain(row);
  }

  async attachMessage(giveawayId: number, messageId: string): Promise<void> {
    await this.prisma.giveaway.updateMany({
      where: { id: giveawayId },
      data: { messageId },
    });
  }

  async find(guildId: string, giveawayId: number): Promise<Giveaway | null> {
    const row = await this.prisma.giveaway.findFirst({
      where: { id: giveawayId, guildId },
    });

    return row ? toDomain(row) : null;
  }

  /**
   * Giveaway yang waktunya sudah habis, hanya milik guild shard ini.
   *
   * `endedAt: null` membuat hasil menyusut: giveaway yang sudah diurus tidak
   * muncul lagi di sapuan berikutnya.
   */
  async findDue(
    now: Date,
    guildIds: readonly string[],
    limit: number,
  ): Promise<Giveaway[]> {
    if (guildIds.length === 0 || limit <= 0) return [];

    const rows = await this.prisma.giveaway.findMany({
      where: {
        endedAt: null,
        endsAt: { lte: now },
        guildId: { in: [...guildIds] },
      },
      orderBy: { endsAt: 'asc' },
      take: limit,
    });

    return rows.map(toDomain);
  }

  /**
   * Klaim penutupan secara atomik.
   *
   * Job otomatis dan `/giveaway end` bisa berebut giveaway yang sama. Hanya
   * pemanggil pertama yang mendapat baris; yang kalah melihat `null` dan tidak
   * mengumumkan pemenang kedua kalinya.
   */
  async markEnded(
    guildId: string,
    giveawayId: number,
    now: Date,
  ): Promise<Giveaway | null> {
    const claimed = await this.prisma.giveaway.updateMany({
      where: { id: giveawayId, guildId, endedAt: null },
      data: { endedAt: now },
    });
    if (claimed.count === 0) return null;

    const row = await this.prisma.giveaway.findFirst({
      where: { id: giveawayId, guildId },
    });

    return row ? toDomain(row) : null;
  }

  /**
   * Cek status lalu simpan entri.
   *
   * Periode antara cek dan insert sangat pendek; penutupan selalu menandai
   * `endedAt` lebih dulu sebelum menghapus entri, jadi klik yang datang
   * setelah penutupan melihat giveaway sudah tertutup.
   */
  async addEntry(giveawayId: number, userId: string, now: Date): Promise<AddEntryResult> {
    const active = await this.prisma.giveaway.findFirst({
      where: {
        id: giveawayId,
        endedAt: null,
        endsAt: { gt: now },
      },
      select: { id: true },
    });
    if (!active) return 'closed';

    try {
      await this.prisma.giveawayEntry.create({ data: { giveawayId, userId } });
      return 'added';
    } catch (error) {
      if (isUniqueViolation(error)) return 'duplicate';
      throw error;
    }
  }

  async listEntryUserIds(giveawayId: number): Promise<string[]> {
    const rows = await this.prisma.giveawayEntry.findMany({
      where: { giveawayId },
      select: { userId: true },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((row) => row.userId);
  }

  async deleteEntries(giveawayId: number): Promise<number> {
    const result = await this.prisma.giveawayEntry.deleteMany({
      where: { giveawayId },
    });

    return result.count;
  }

  async delete(guildId: string, giveawayId: number): Promise<void> {
    await this.prisma.giveaway.deleteMany({
      where: { id: giveawayId, guildId },
    });
  }

  async countEntriesForUser(guildId: string, userId: string): Promise<number> {
    return this.prisma.giveawayEntry.count({
      where: { userId, giveaway: { guildId } },
    });
  }

  async deleteEntriesForUser(guildId: string, userId: string): Promise<number> {
    const result = await this.prisma.giveawayEntry.deleteMany({
      where: { userId, giveaway: { guildId } },
    });

    return result.count;
  }
}

/** Kode Prisma untuk unique constraint; dicek tanpa mengimpor namespace Prisma. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: unknown }).code === 'P2002';
}
