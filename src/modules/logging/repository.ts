import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { toDomain, toLogRecord } from './mapping.js';
import { buildLogEntryWhere } from './searchQuery.js';
import {
  MEMBER_TARGET_CATEGORIES,
  memberIdsOverlap,
  summarizeLogStats,
  toMemberTargetRows,
  type LogCountRow,
  type LogStats,
  type MemberTargetRow,
} from './stats.js';
import type { LogCategory, LogRecord, LogSearchFilter, LogSearchResult, LogSubscription } from './types.js';

/** Baris yang siap ditulis ke `log_entry` (domain repository, bukan Prisma). */
export interface NewLogEntry {
  guildId: string;
  category: LogCategory;
  eventKey: string;
  title: string;
  summary: string;
  executorId: string | null;
  targetId: string | null;
  channelId: string | null;
  logChannelId: string | null;
  caseId: string | null;
  createdAt: Date;
  expiresAt: Date | null;
}

/** Kontrak penyimpanan routing log — bisa diganti fake di tes. */
export interface LoggingRepository {
  list(guildId: string): Promise<LogSubscription[]>;
  save(guildId: string, category: LogCategory, channelId: string): Promise<void>;
  remove(guildId: string, category: LogCategory): Promise<void>;
  /** Simpan riwayat log; mengembalikan id baris untuk menempelkan ID pesan. */
  insert(entry: NewLogEntry): Promise<number>;
  /** Tempelkan ID pesan log setelah embed berhasil dikirim. */
  attachMessage(id: number, messageId: string, logChannelId: string): Promise<void>;
  search(filter: LogSearchFilter): Promise<LogSearchResult>;
  /** Agregasi riwayat log untuk `/logs … stats:true`. */
  stats(filter: LogSearchFilter): Promise<LogStats>;
}

export class PrismaLoggingRepository implements LoggingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(guildId: string): Promise<LogSubscription[]> {
    const rows = await this.prisma.logSubscription.findMany({ where: { guildId } });
    const subscriptions: LogSubscription[] = [];

    for (const row of rows) {
      const subscription = toDomain({
        guildId: row.guildId,
        category: row.category,
        channelId: row.channelId,
      });

      if (subscription) subscriptions.push(subscription);
    }

    return subscriptions;
  }

  async save(guildId: string, category: LogCategory, channelId: string): Promise<void> {
    await this.prisma.logSubscription.upsert({
      where: { guildId_category: { guildId, category } },
      create: { guildId, category, channelId },
      update: { channelId },
    });
  }

  /** deleteMany supaya tidak error kalau barisnya memang tidak ada. */
  async remove(guildId: string, category: LogCategory): Promise<void> {
    await this.prisma.logSubscription.deleteMany({ where: { guildId, category } });
  }

  async insert(entry: NewLogEntry): Promise<number> {
    const row = await this.prisma.logEntry.create({ data: entry });
    return row.id;
  }

  /** updateMany: entri bisa sudah terhapus (mis. retensi) saat embed tiba. */
  async attachMessage(id: number, messageId: string, logChannelId: string): Promise<void> {
    await this.prisma.logEntry.updateMany({
      where: { id },
      data: { logMessageId: messageId, logChannelId },
    });
  }

  async search(filter: LogSearchFilter): Promise<LogSearchResult> {
    const where = buildLogEntryWhere(filter);

    const [rows, total] = await Promise.all([
      this.prisma.logEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filter.pageSize,
        skip: (filter.page - 1) * filter.pageSize,
      }),
      this.prisma.logEntry.count({ where }),
    ]);

    const records: LogRecord[] = [];
    for (const row of rows) {
      const record = toLogRecord(row);
      if (record) records.push(record);
    }

    return { rows: records, total };
  }

  /**
   * Agregasi untuk statistik: jumlah event per kategori, eventKey teratas, dan
   * member yang paling sering terlibat.
   *
   * Empat `groupBy` berjalan paralel. Target dikelompokkan per kategori supaya
   * ID channel/role (yang mengisi kolom `targetId` yang sama) bisa disaring
   * sebelum masuk peringkat member. Query tabel silang (target × executor)
   * hanya dijalankan kalau ada user yang muncul di kedua sisi — tanpa itu
   * tidak mungkin ada entri "aksi pada diri sendiri" untuk dihitung dua kali.
   */
  async stats(filter: LogSearchFilter): Promise<LogStats> {
    const where = buildLogEntryWhere(filter);

    const [categoryRows, actionRows, targetRows, executorRows] = await Promise.all([
      this.prisma.logEntry.groupBy({ by: ['category'], where, _count: { _all: true } }),
      this.prisma.logEntry.groupBy({ by: ['eventKey'], where, _count: { _all: true } }),
      this.prisma.logEntry.groupBy({
        by: ['targetId', 'category'],
        where: andWhere(where, { targetId: { not: null } }),
        _count: { _all: true },
      }),
      this.prisma.logEntry.groupBy({
        by: ['executorId'],
        where: andWhere(where, { executorId: { not: null } }),
        _count: { _all: true },
      }),
    ]);

    const targets = toMemberTargetRows(
      targetRows.map(
        (row): MemberTargetRow => ({
          key: row.targetId ?? '',
          category: row.category,
          count: row._count._all,
        }),
      ),
    );
    const executors = toCountRows(executorRows, 'executorId');

    const selfActions = memberIdsOverlap(targets, executors)
      ? await this.countSelfActions(where)
      : [];

    return summarizeLogStats({
      categories: toCountRows(categoryRows, 'category'),
      actions: toCountRows(actionRows, 'eventKey'),
      targets,
      executors,
      selfActions,
    });
  }

  /** Baris `groupBy` dengan target === executor; hanya baris yang sama yang dipakai. */
  private async countSelfActions(where: Prisma.LogEntryWhereInput): Promise<LogCountRow[]> {
    const rows = await this.prisma.logEntry.groupBy({
      by: ['targetId', 'executorId'],
      where: andWhere(
        where,
        { targetId: { not: null } },
        { executorId: { not: null } },
        { category: { in: [...MEMBER_TARGET_CATEGORIES] } },
      ),
      _count: { _all: true },
    });

    const selfActions: LogCountRow[] = [];
    for (const row of rows) {
      const { targetId } = row;
      if (targetId && targetId === row.executorId) {
        selfActions.push({ key: targetId, count: row._count._all });
      }
    }

    return selfActions;
  }
}

/** Gabung klausa `where` tanpa merusak objek aslinya. */
function andWhere(
  base: Prisma.LogEntryWhereInput,
  ...extra: Prisma.LogEntryWhereInput[]
): Prisma.LogEntryWhereInput {
  return { AND: [base, ...extra] };
}

/** Ratakan hasil `groupBy` Prisma menjadi pasangan kunci → jumlah. */
function toCountRows<K extends string>(
  rows: readonly (Record<K, string | null> & { _count: { _all: number } })[],
  key: K,
): LogCountRow[] {
  const result: LogCountRow[] = [];
  for (const row of rows) {
    const value = row[key];
    if (typeof value !== 'string' || value.length === 0) continue;
    result.push({ key: value, count: row._count._all });
  }

  return result;
}
