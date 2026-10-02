import type { Prisma } from '../../generated/prisma/client.js';
import type { LogSearchFilter } from './types.js';

/**
 * Terjemahkan filter domain → klausa `where` Prisma.
 *
 * Murni dan terpisah dari repository supaya kombinasi filter (kategori +
 * user + channel + kata kunci + rentang tanggal) bisa diuji tanpa database.
 */
export function buildLogEntryWhere(filter: LogSearchFilter): Prisma.LogEntryWhereInput {
  const conditions: Prisma.LogEntryWhereInput[] = [];

  if (filter.categories.length > 0) {
    conditions.push({ category: { in: filter.categories } });
  }

  // Satu filter "user" berlaku dua peran: yang dikenai aksi dan yang melakukannya.
  if (filter.userId) {
    conditions.push({ OR: [{ targetId: filter.userId }, { executorId: filter.userId }] });
  }

  if (filter.channelId) {
    conditions.push({ channelId: filter.channelId });
  }

  // Nomor kasus disimpan polos, jadi filter ini hanya menyentuh entri yang
  // berasal dari perintah moderasi Harmony.
  if (filter.caseNumber) {
    conditions.push({ caseId: String(filter.caseNumber) });
  }

  if (filter.keyword) {
    conditions.push({
      OR: [
        { title: { contains: filter.keyword, mode: 'insensitive' } },
        { summary: { contains: filter.keyword, mode: 'insensitive' } },
      ],
    });
  }

  if (filter.from || filter.to) {
    conditions.push({
      createdAt: {
        ...(filter.from ? { gte: filter.from } : {}),
        ...(filter.to ? { lte: filter.to } : {}),
      },
    });
  }

  return {
    guildId: filter.guildId,
    ...(conditions.length > 0 ? { AND: conditions } : {}),
  };
}
