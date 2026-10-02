import type { TicketRepository } from './repository.js';
import { TICKET_RETENTION_MONTHS } from './types.js';

/** Hasil satu sapuan retensi tiket. */
export interface TicketRetentionResult {
  cutoff: Date;
  ticketsDeleted: number;
}

/**
 * Batas retensi tiket yang sudah ditutup.
 *
 * Pakai `setMonth(-12)` supaya "setahun lalu" tetap sebulan sebelum kalender,
 * bukan 365 hari — perilaku yang sama dengan retensi kasus moderasi.
 */
export function ticketRetentionCutoff(now = new Date()): Date {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - TICKET_RETENTION_MONTHS);
  return cutoff;
}

/**
 * Hapus tiket yang sudah ditutup dan melewati batas retensi.
 *
 * Hanya baris `closed`: tiket yang masih terbuka tidak boleh hilang karena
 * begitu saja — pemanggilnya butuh tahu masih ada yang menggantung.
 *
 * Murni terhadap repository, jadi bisa diuji tanpa database.
 */
export async function purgeExpiredTickets(
  repository: TicketRepository,
  now = new Date(),
): Promise<TicketRetentionResult> {
  const cutoff = ticketRetentionCutoff(now);
  const ticketsDeleted = await repository.deleteExpired(cutoff);

  return { cutoff, ticketsDeleted };
}