import { parseTranscript } from './transcript.js';
import { isTicketStatus, type Ticket } from './types.js';

/**
 * Bentuk baris tabel `ticket` yang dibutuhkan pemetaan. Didefinisikan lokal
 * (bukan tipe Prisma) supaya bisa dites tanpa database.
 */
export interface TicketRow {
  id: number;
  ticketNumber: number;
  guildId: string;
  channelId: string | null;
  openerId: string;
  subject: string | null;
  status: string;
  claimedBy: string | null;
  createdAt: Date;
  closedAt: Date | null;
  closedBy: string | null;
  expiresAt: Date | null;
  /** Kolom JSON transkrip; null untuk tiket yang ditutup sebelum fiturnya ada. */
  transcript: unknown;
}

/**
 * Baris DB → domain.
 *
 * Status yang tidak dikenal (mis. versi bot yang lebih baru, atau kurasakan)
 * dianggap `closed`: data lama tidak boleh muncul lagi sebagai tiket aktif.
 */
export function toDomain(row: TicketRow): Ticket {
  return {
    id: row.id,
    ticketNumber: row.ticketNumber,
    guildId: row.guildId,
    channelId: row.channelId,
    openerId: row.openerId,
    subject: row.subject,
    status: isTicketStatus(row.status) ? row.status : 'closed',
    claimedBy: row.claimedBy,
    createdAt: row.createdAt,
    closedAt: row.closedAt,
    closedBy: row.closedBy,
    expiresAt: row.expiresAt,
    transcript: parseTranscript(row.transcript),
  };
}