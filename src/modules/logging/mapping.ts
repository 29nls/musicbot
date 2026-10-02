import { isLogCategory, type LogCategory, type LogRecord, type LogSubscription } from './types.js';

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

/** Bentuk baris tabel `log_entry` (lokal, bukan tipe Prisma). */
export interface LogEntryRow {
  id: number;
  guildId: string;
  category: string;
  eventKey: string;
  title: string;
  summary: string;
  executorId: string | null;
  targetId: string | null;
  channelId: string | null;
  logChannelId: string | null;
  logMessageId: string | null;
  caseId: string | null;
  createdAt: Date;
}

/** Baris riwayat log → domain. null kalau kategori tak dikenal atau tanggal rusak. */
export function toLogRecord(row: LogEntryRow): LogRecord | null {
  if (!isLogCategory(row.category)) return null;
  if (!(row.createdAt instanceof Date) || Number.isNaN(row.createdAt.getTime())) return null;

  return {
    id: row.id,
    guildId: row.guildId,
    category: row.category as LogCategory,
    eventKey: row.eventKey,
    title: row.title,
    summary: row.summary,
    executorId: row.executorId,
    targetId: row.targetId,
    channelId: row.channelId,
    logChannelId: row.logChannelId,
    logMessageId: row.logMessageId,
    caseId: row.caseId,
    createdAt: row.createdAt,
  };
}
