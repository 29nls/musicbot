import { isLogCategory, type LogSubscription } from './types.js';

/** Bentuk baris tabel `guild_log_subscription` (lokal, bukan tipe Prisma). */
export interface LogSubscriptionRow {
  guildId: string;
  category: string;
  channelId: string;
}

/** Baris DB → domain. null kalau kategorinya tidak dikenal (data lama). */
export function toDomain(row: LogSubscriptionRow): LogSubscription | null {
  if (!isLogCategory(row.category)) return null;

  return { guildId: row.guildId, category: row.category, channelId: row.channelId };
}
