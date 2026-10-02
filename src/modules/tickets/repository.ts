import type { PrismaClient } from '../../generated/prisma/client.js';
import { toDomain } from './mapping.js';
import type { CreateTicketInput, Ticket } from './types.js';

/** Kontrak penyimpanan tiket — bisa diganti fake di tes. */
export interface TicketRepository {
  /** Nomor tiket = max + 1 di dalam transaksi; naik terus dan tidak pernah kembar. */
  create(input: CreateTicketInput, now: Date): Promise<Ticket>;
  attachChannel(ticketId: number, channelId: string): Promise<void>;
  findOpenByOpener(guildId: string, openerId: string): Promise<Ticket | null>;
  findByChannel(guildId: string, channelId: string): Promise<Ticket | null>;
  listOpen(guildId: string, take: number): Promise<Ticket[]>;
  countOpen(guildId: string): Promise<number>;
  claim(guildId: string, channelId: string, staffId: string): Promise<Ticket | null>;
  /** Tutup tiket: status jadi `closed` + isi waktu & retensinya. */
  close(guildId: string, channelId: string, closedBy: string, now: Date, expiresAt: Date): Promise<Ticket | null>;
  /** Tutup berdasarkan id — buat tiket hantu yang gagal dapat channel. */
  closeById(ticketId: number, closedBy: string, now: Date, expiresAt: Date): Promise<Ticket | null>;
  /** Hapus tiket yang lewat retensi; hanya baris yang sudah ditutup. */
  deleteExpired(cutoff: Date): Promise<number>;
}

export class PrismaTicketRepository implements TicketRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Nomor tiket dihitung dari SEMUA baris (termasuk yang sudah ditutup), jadi
   * menghapus tiket lama tidak membuat nomor terpakai ulang. Hanya satu proses
   * bot yang menulis, jadi max+1 di dalam transaksi cukup.
   */
  async create(input: CreateTicketInput, now: Date): Promise<Ticket> {
    const row = await this.prisma.$transaction(async (tx) => {
      const latest = await tx.ticket.aggregate({
        where: { guildId: input.guildId },
        _max: { ticketNumber: true },
      });

      return tx.ticket.create({
        data: {
          guildId: input.guildId,
          ticketNumber: (latest._max.ticketNumber ?? 0) + 1,
          openerId: input.openerId,
          subject: input.subject,
          status: 'open',
          createdAt: now,
        },
      });
    });

    return toDomain(row);
  }

  /** updateMany: tiket bisa sudah ditutup (atau dihapus retensi) saat channel dibuat. */
  async attachChannel(ticketId: number, channelId: string): Promise<void> {
    await this.prisma.ticket.updateMany({
      where: { id: ticketId },
      data: { channelId },
    });
  }

  async findOpenByOpener(guildId: string, openerId: string): Promise<Ticket | null> {
    const row = await this.prisma.ticket.findFirst({
      where: { guildId, openerId, status: 'open' },
      orderBy: { createdAt: 'desc' },
    });

    return row ? toDomain(row) : null;
  }

  async findByChannel(guildId: string, channelId: string): Promise<Ticket | null> {
    const row = await this.prisma.ticket.findFirst({
      where: { guildId, channelId, status: 'open' },
    });

    return row ? toDomain(row) : null;
  }

  async listOpen(guildId: string, take: number): Promise<Ticket[]> {
    const rows = await this.prisma.ticket.findMany({
      where: { guildId, status: 'open' },
      orderBy: { createdAt: 'desc' },
      take,
    });

    return rows.map(toDomain);
  }

  async countOpen(guildId: string): Promise<number> {
    return this.prisma.ticket.count({ where: { guildId, status: 'open' } });
  }

  async claim(guildId: string, channelId: string, staffId: string): Promise<Ticket | null> {
    const found = await this.prisma.ticket.findFirst({
      where: { guildId, channelId, status: 'open' },
      select: { id: true },
    });
    if (!found) return null;

    const row = await this.prisma.ticket.update({
      where: { id: found.id },
      data: { claimedBy: staffId },
    });

    return toDomain(row);
  }

  async close(
    guildId: string,
    channelId: string,
    closedBy: string,
    now: Date,
    expiresAt: Date,
  ): Promise<Ticket | null> {
    const found = await this.prisma.ticket.findFirst({
      where: { guildId, channelId, status: 'open' },
      select: { id: true },
    });
    if (!found) return null;

    const row = await this.prisma.ticket.update({
      where: { id: found.id },
      data: { status: 'closed', closedAt: now, closedBy, expiresAt },
    });

    return toDomain(row);
  }

  async closeById(
    ticketId: number,
    closedBy: string,
    now: Date,
    expiresAt: Date,
  ): Promise<Ticket | null> {
    const updated = await this.prisma.ticket.updateMany({
      where: { id: ticketId, status: 'open' },
      data: { status: 'closed', closedAt: now, closedBy, expiresAt },
    });
    if (updated.count === 0) return null;

    const row = await this.prisma.ticket.findUnique({ where: { id: ticketId } });

    return row ? toDomain(row) : null;
  }

  /** Hanya tiket tertutup & lewat batas — tiket terbuka tidak boleh hilang diam-diam. */
  async deleteExpired(cutoff: Date): Promise<number> {
    const result = await this.prisma.ticket.deleteMany({
      where: { status: 'closed', closedAt: { lt: cutoff } },
    });

    return result.count;
  }
}