import type { PrismaClient } from '../../generated/prisma/client.js';
import { toCaseDomain, toWarningDomain } from './mapping.js';
import {
  CHANNEL_TARGET_ACTIONS,
  type ModeratorActionRow,
  type ModeratorTotals,
} from './modProfile.js';
import { MAX_NOTES_SHOWN, MODERATION_ACTIONS, type CreateCaseInput, type CreateWarningInput, type DmStatus, type ModerationCase, type WarningRecord } from './types.js';
import type { TargetActionRow } from './priorCases.js';

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
  /** Catat hasil pengiriman DM ke target. */
  setCaseDmStatus(guildId: string, caseNumber: number, dmStatus: DmStatus): Promise<void>;
  /** Hapus peringatan yang lebih tua dari `cutoff`; mengembalikan jumlah baris. */
  deleteExpiredWarnings(cutoff: Date): Promise<number>;
  /** Hapus kasus yang lebih tua dari `cutoff`; peringatan ikut terhapus (Cascade). */
  deleteExpiredCases(cutoff: Date): Promise<number>;
  /** Kasus milik satu moderator, terbaru dulu. */
  listCasesByModerator(
    guildId: string,
    moderatorId: string,
    take: number,
  ): Promise<ModerationCase[]>;
  /** Sebaran kasus per moderator menurut jenis & status aktif. */
  countByTypeAndActive(
    guildId: string,
    moderatorId: string,
  ): Promise<ModeratorActionRow[]>;
  /**
   * Sebaran kasus satu target menurut jenis & status aktif.
   *
   * `excludeCaseNumber` dipakai supaya kasus yang sedang dibuat (mis. ban ini
   * juga) tidak ikut terhitung sebagai "riwayat sebelumnya".
   */
  countTargetByTypeAndActive(
    guildId: string,
    targetId: string,
    excludeCaseNumber?: number,
  ): Promise<TargetActionRow[]>;
  /** Angka besar profil moderator (total, rentang waktu, target unik, aktivitas terkini). */
  summarizeModerator(
    guildId: string,
    moderatorId: string,
    recentSince: Date,
  ): Promise<ModeratorTotals>;
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

  /**
   * Syarat `dmStatus: null` membuat penulisan ini idempoten: kalau dipanggil
   * dua kali untuk kasus yang sama, hasil DM yang sudah tercatat tidak ditimpa.
   */
  async setCaseDmStatus(guildId: string, caseNumber: number, dmStatus: DmStatus): Promise<void> {
    await this.prisma.moderationCase.updateMany({
      where: { guildId, caseNumber, dmStatus: null },
      data: { dmStatus },
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

  async listCasesByModerator(
    guildId: string,
    moderatorId: string,
    take: number,
  ): Promise<ModerationCase[]> {
    const rows = await this.prisma.moderationCase.findMany({
      where: { guildId, moderatorId },
      orderBy: [{ createdAt: 'desc' }, { caseNumber: 'desc' }],
      take,
    });

    return rows.map(toCaseDomain);
  }

  /**
   * Sebaran jenis & status dalam satu `groupBy`.
   *
   * Menghitung di database, bukan dengan memuat semua kasus lalu dihitung di
   * memori: moderator yang aktif bisa punya ribuan kasus, dan memuat semuanya
   * hanya untuk membuat diagram batang akan menahan memory serta membuang
   * waktu baca yang tidak perlu.
   */
  async countByTypeAndActive(
    guildId: string,
    moderatorId: string,
  ): Promise<ModeratorActionRow[]> {
    const rows = await this.prisma.moderationCase.groupBy({
      by: ['type', 'active'],
      where: { guildId, moderatorId },
      _count: { _all: true },
    });

    return rows.map((row) => ({
      type: row.type,
      active: row.active,
      count: row._count._all,
    }));
  }

  /**
   * Angka besar profil moderator.
   *
   * Target unik dihitung dengan `groupBy targetId`, bukan `distinct` +
   * `count`, supaya database tetap bisa menjadikannya groupBy di atas indeks
   * yang sama. Aksi terhadap channel dikecualikan: ID channel bukan orang,
   * dan menghitungnya akan membuat "jumlah orang" terlihat lebih besar.
   */
  /**
   * Sebaran jenis & status kasus atas satu target.
   *
   * Satu `groupBy` untuk seluruh riwayat — bukan memuat semua kasus target lalu
   * menghitungnya di memory. Target yang paling bermasalah justru yang paling
   * banyak kasusnya, jadi memuat semuanya adalah pola yang paling salah di sini.
   */
  async countTargetByTypeAndActive(
    guildId: string,
    targetId: string,
    excludeCaseNumber?: number,
  ): Promise<TargetActionRow[]> {
    const rows = await this.prisma.moderationCase.groupBy({
      by: ['type', 'active'],
      where: {
        guildId,
        targetId,
        ...(excludeCaseNumber === undefined ? {} : { caseNumber: { not: excludeCaseNumber } }),
      },
      _count: { _all: true },
    });

    return rows.map((row) => ({
      type: row.type,
      active: row.active,
      count: row._count._all,
    }));
  }

  async summarizeModerator(
    guildId: string,
    moderatorId: string,
    recentSince: Date,
  ): Promise<ModeratorTotals> {
    const where = { guildId, moderatorId };
    const userActions = MODERATION_ACTIONS.filter(
      (type) => !CHANNEL_TARGET_ACTIONS.includes(type),
    );

    const [aggregate, distinctTargets, recentCount] = await Promise.all([
      this.prisma.moderationCase.aggregate({
        where,
        _count: { _all: true },
        _min: { createdAt: true },
        _max: { createdAt: true },
      }),
      this.prisma.moderationCase.groupBy({
        by: ['targetId'],
        where: { ...where, type: { in: [...userActions] } },
      }),
      this.prisma.moderationCase.count({ where: { ...where, createdAt: { gte: recentSince } } }),
    ]);

    const total = aggregate._count._all;

    return {
      total,
      uniqueTargets: distinctTargets.length,
      firstCaseAt: aggregate._min.createdAt,
      lastCaseAt: aggregate._max.createdAt,
      recentCount,
    };
  }
}
