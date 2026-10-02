import type { PrismaClient } from '../../generated/prisma/client.js';
import { toCaseDomain, toWarningDomain } from './mapping.js';
import { MAX_NOTES_SHOWN, type CreateCaseInput, type CreateWarningInput, type ModerationCase, type WarningRecord } from './types.js';

/** Kontrak penyimpanan moderasi — bisa diganti fake di tes. */
export interface ModerationRepository {
  /** Simpan kasus baru; nomor kasus dihitung sendiri per server. */
  createCase(input: CreateCaseInput): Promise<ModerationCase>;
  createWarning(input: CreateWarningInput): Promise<WarningRecord>;
  findCaseByNumber(guildId: string, caseNumber: number): Promise<ModerationCase | null>;
  listWarnings(guildId: string, userId: string): Promise<WarningRecord[]>;
  countWarnings(guildId: string, userId: string): Promise<number>;
  /** Catatan internal terbaru satu user (maks `MAX_NOTES_SHOWN`). */
  listNotes(guildId: string, userId: string): Promise<ModerationCase[]>;
  /**
   * Kasus lain dengan target yang sama, terbaru dulu — riwayat singkat untuk
   * halaman ringkasan kasus.
   */
  listCasesForTarget(
    guildId: string,
    targetId: string,
    options: { excludeCaseNumber?: number; take: number },
  ): Promise<ModerationCase[]>;
  /** Hapus warning + nonaktifkan kasusnya. null kalau kasus tidak ada/bukan warn. */
  revokeWarning(guildId: string, caseNumber: number): Promise<ModerationCase | null>;
  /** Nonaktifkan kasus (dipakai kalau aksi Discord gagal setelah kasus dicatat). */
  setCaseActive(guildId: string, caseNumber: number, active: boolean): Promise<void>;
  /** Hapus peringatan yang lebih tua dari `cutoff`; mengembalikan jumlah baris. */
  deleteExpiredWarnings(cutoff: Date): Promise<number>;
  /** Hapus kasus yang lebih tua dari `cutoff`; peringatan ikut terhapus (Cascade). */
  deleteExpiredCases(cutoff: Date): Promise<number>;
}

export class PrismaModerationRepository implements ModerationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createCase(input: CreateCaseInput): Promise<ModerationCase> {
    // Nomor kasus = max + 1 di dalam transaksi supaya aksi berurutan tidak
    // menghasilkan nomor kembar (bot hanya satu proses, jadi ini cukup).
    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.moderationCase.aggregate({
        where: { guildId: input.guildId },
        _max: { caseNumber: true },
      });

      const row = await tx.moderationCase.create({
        data: {
          guildId: input.guildId,
          caseNumber: (latest._max.caseNumber ?? 0) + 1,
          type: input.type,
          targetId: input.targetId,
          moderatorId: input.moderatorId,
          reason: input.reason,
          expiresAt: input.expiresAt ?? null,
        },
      });

      return toCaseDomain(row);
    });
  }

  async createWarning(input: CreateWarningInput): Promise<WarningRecord> {
    const row = await this.prisma.warning.create({
      data: {
        caseId: input.caseId,
        guildId: input.guildId,
        userId: input.userId,
        moderatorId: input.moderatorId,
        reason: input.reason,
      },
      include: { case: { select: { caseNumber: true } } },
    });

    return toWarningDomain(row);
  }

  async findCaseByNumber(guildId: string, caseNumber: number): Promise<ModerationCase | null> {
    const row = await this.prisma.moderationCase.findUnique({
      where: { guildId_caseNumber: { guildId, caseNumber } },
    });

    return row ? toCaseDomain(row) : null;
  }

  async listWarnings(guildId: string, userId: string): Promise<WarningRecord[]> {
    const rows = await this.prisma.warning.findMany({
      where: { guildId, userId },
      include: { case: { select: { caseNumber: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map(toWarningDomain);
  }

  async countWarnings(guildId: string, userId: string): Promise<number> {
    return this.prisma.warning.count({ where: { guildId, userId } });
  }

  async listNotes(guildId: string, userId: string): Promise<ModerationCase[]> {
    const rows = await this.prisma.moderationCase.findMany({
      where: { guildId, targetId: userId, type: 'note' },
      orderBy: { createdAt: 'desc' },
      take: MAX_NOTES_SHOWN,
    });

    return rows.map(toCaseDomain);
  }

  async listCasesForTarget(
    guildId: string,
    targetId: string,
    options: { excludeCaseNumber?: number; take: number },
  ): Promise<ModerationCase[]> {
    const rows = await this.prisma.moderationCase.findMany({
      where: {
        guildId,
        targetId,
        ...(options.excludeCaseNumber === undefined
          ? {}
          : { caseNumber: { not: options.excludeCaseNumber } }),
      },
      orderBy: [{ createdAt: 'desc' }, { caseNumber: 'desc' }],
      take: options.take,
    });

    return rows.map(toCaseDomain);
  }

  async revokeWarning(guildId: string, caseNumber: number): Promise<ModerationCase | null> {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.moderationCase.findUnique({
        where: { guildId_caseNumber: { guildId, caseNumber } },
      });

      if (!found || found.type !== 'warn') return null;

      await tx.warning.deleteMany({ where: { caseId: found.id } });
      const updated = await tx.moderationCase.update({
        where: { id: found.id },
        data: { active: false },
      });

      return toCaseDomain(updated);
    });
  }

  async setCaseActive(guildId: string, caseNumber: number, active: boolean): Promise<void> {
    await this.prisma.moderationCase.updateMany({
      where: { guildId, caseNumber },
      data: { active },
    });
  }

  async deleteExpiredWarnings(cutoff: Date): Promise<number> {
    const result = await this.prisma.warning.deleteMany({ where: { createdAt: { lt: cutoff } } });
    return result.count;
  }

  async deleteExpiredCases(cutoff: Date): Promise<number> {
    const result = await this.prisma.moderationCase.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return result.count;
  }
}
