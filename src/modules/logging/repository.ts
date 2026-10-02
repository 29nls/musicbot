import type { PrismaClient } from '../../generated/prisma/client.js';
import { toDomain } from './mapping.js';
import type { LogCategory, LogSubscription } from './types.js';

/** Kontrak penyimpanan routing log — bisa diganti fake di tes. */
export interface LoggingRepository {
  list(guildId: string): Promise<LogSubscription[]>;
  save(guildId: string, category: LogCategory, channelId: string): Promise<void>;
  remove(guildId: string, category: LogCategory): Promise<void>;
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
}
