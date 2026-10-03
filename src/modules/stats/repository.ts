import type { PrismaClient } from '../../generated/prisma/client.js';
import { toDayColumn, toDomainList, type PlaybackStatRow } from './mapping.js';
import type { StatEntry, StatKind } from './types.js';

/**
 * Kontrak penyimpanan statistik — interface tipis supaya bisa diganti fake
 * di tes, dan supaya modul ini tidak pernah mencapai database lewat pintasan
 * sendiri.
 */
export interface PlaybackStatRepository {
  /** Tambah satu tally ke baris hari itu; baris dibuat kalau belum ada. */
  increment(input: {
    guildId: string;
    kind: StatKind;
    key: string;
    label: string;
    day: Date;
    count: number;
    listenedMs: number;
  }): Promise<void>;

  /** Baris dalam rentang [since, until] untuk satu jenis. */
  listRange(guildId: string, kind: StatKind, since: Date, until: Date): Promise<StatEntry[]>;

  /** Hapus baris yang lebih tua dari batas; mengembalikan jumlahnya. */
  deleteBefore(cutoff: Date): Promise<number>;
}

export class PrismaPlaybackStatRepository implements PlaybackStatRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async increment(input: {
    guildId: string;
    kind: StatKind;
    key: string;
    label: string;
    day: Date;
    count: number;
    listenedMs: number;
  }): Promise<void> {
    const day = toDayColumn(input.day);

    // Satu operasi atomik (upsert + increment) supaya dua pemutaran yang
    // selesai dalam milidetik yang sama tidak saling menimpa. Kalau ini
    // dipecah jadi "coba create, kalau gagal update", lagu yang sedang diputar
    // dua server bisa kehilangan satu hitungan tanpa ada yang melapor.
    await this.prisma.playbackStat.upsert({
      where: {
        guildId_kind_key_day: {
          guildId: input.guildId,
          kind: input.kind,
          key: input.key,
          day,
        },
      },
      create: {
        guildId: input.guildId,
        kind: input.kind,
        key: input.key,
        label: input.label,
        day,
        count: Math.max(1, Math.trunc(input.count)),
        listenedMs: BigInt(Math.max(0, Math.trunc(input.listenedMs))),
      },
      update: {
        count: { increment: Math.max(1, Math.trunc(input.count)) },
        listenedMs: { increment: BigInt(Math.max(0, Math.trunc(input.listenedMs))) },
      },
    });
  }

  async listRange(
    guildId: string,
    kind: StatKind,
    since: Date,
    until: Date,
  ): Promise<StatEntry[]> {
    const rows = await this.prisma.playbackStat.findMany({
      where: {
        guildId,
        kind,
        day: { gte: toDayColumn(since), lte: toDayColumn(until) },
      },
      // Batas keras: `/stats` hanya butuh leaderboard, bukan seluruh arsip.
      // Tanpa ini, server yang aktif setahun menarik ratusan ribu baris ke
      // memori satu kali perintah.
      take: 20_000,
      orderBy: [{ day: 'desc' }, { count: 'desc' }],
    });

    return toDomainList(rows as unknown as PlaybackStatRow[]);
  }

  async deleteBefore(cutoff: Date): Promise<number> {
    const result = await this.prisma.playbackStat.deleteMany({
      where: { day: { lt: toDayColumn(cutoff) } },
    });

    return result.count;
  }
}