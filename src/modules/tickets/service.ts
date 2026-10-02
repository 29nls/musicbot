import { purgeExpiredTickets, type TicketRetentionResult } from './retention.js';
import type { TicketRepository } from './repository.js';
import {
  MAX_SUBJECT_LENGTH,
  TICKET_RETENTION_MONTHS,
  type CreateTicketInput,
  type Ticket,
} from './types.js';

export interface OpenTicketSummary {
  tickets: Ticket[];
  total: number;
}

/** Batas retensi dihitung dari waktu penutupan, bukan dari waktu dibuat. */
function expiresAtFrom(now: Date): Date {
  const expiresAt = new Date(now);
  expiresAt.setMonth(expiresAt.getMonth() + TICKET_RETENTION_MONTHS);

  return expiresAt;
}

/**
 * Logika domain tiket: pembuatan, klaim, dan penutupan.
 *
 * Tidak menyentuh Discord — pembuatan channel, permission overwrites, dan
 * penguncian channel tetap di lapisan perintah & handler tombol.
 */
export class TicketService {
  constructor(private readonly repository: TicketRepository) {}

  /**
   * Catat tiket baru. Satu member hanya boleh punya satu tiket terbuka; kalau
   * sudah punya, tiket lama dikembalikan agar pemanggil bisa mengarahkan ke
   * channel yang sama alih-alih membuat duplikat.
   */
  async open(
    input: CreateTicketInput,
    now = new Date(),
  ): Promise<{ ticket: Ticket; existing: Ticket | null }> {
    const existing = await this.repository.findOpenByOpener(input.guildId, input.openerId);
    if (existing) return { ticket: existing, existing };

    const ticket = await this.repository.create(
      {
        ...input,
        subject: input.subject ? input.subject.trim().slice(0, MAX_SUBJECT_LENGTH) : null,
      },
      now,
    );

    return { ticket, existing: null };
  }

  async attachChannel(ticketId: number, channelId: string): Promise<void> {
    await this.repository.attachChannel(ticketId, channelId);
  }

  async findOpenByChannel(guildId: string, channelId: string): Promise<Ticket | null> {
    return this.repository.findByChannel(guildId, channelId);
  }

  async listOpen(guildId: string, take: number): Promise<OpenTicketSummary> {
    const [tickets, total] = await Promise.all([
      this.repository.listOpen(guildId, take),
      this.repository.countOpen(guildId),
    ]);

    return { tickets, total };
  }

  /** Staff mengambil alih tiket. null kalau tiket sudah ditutup. */
  async claim(guildId: string, channelId: string, staffId: string): Promise<Ticket | null> {
    return this.repository.claim(guildId, channelId, staffId);
  }

  /**
   * Tutup tiket: catat waktu & retensi di database.
   *
   * Penguncian dan penggantian nama channel dilakukan pemanggil karena itu
   * operasi Discord, bukan keputusan domain.
   */
  async close(
    guildId: string,
    channelId: string,
    closedBy: string,
    now = new Date(),
  ): Promise<Ticket | null> {
    return this.repository.close(guildId, channelId, closedBy, now, expiresAtFrom(now));
  }

  /**
   * Tutup tiket yang gagal dibuatkan channelnya.
   *
   * Tanpa ini ada tiket "terbuka" tanpa channel — dan tiket itulah yang
   * akan memblokir member membuka tiket baru selamanya.
   */
  async abandon(ticketId: number, closedBy: string, now = new Date()): Promise<Ticket | null> {
    return this.repository.closeById(ticketId, closedBy, now, expiresAtFrom(now));
  }

  /** Dipanggil job retensi yang sama dengan kasus moderasi. */
  async purgeExpired(now = new Date()): Promise<TicketRetentionResult> {
    return purgeExpiredTickets(this.repository, now);
  }
}