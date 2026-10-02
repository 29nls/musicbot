import type { PrismaClient } from '../../generated/prisma/client.js';
import { toDomain, toLogRecord } from './mapping.js';
import { buildLogEntryWhere } from './searchQuery.js';
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
}
