import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Guild } from 'discord.js';
import { PrismaReactionRoleRepository } from '../src/modules/reactionroles/repository.js';
import type { ReactionRolePanel } from '../src/modules/reactionroles/types.js';
import {
  startPanelExpiryJob,
  type PanelExpiryRunner,
} from '../src/services/panelExpiryJob.js';

const GUILD_MINE = '100000000000000001';
const GUILD_OTHER = '200000000000000002';
const ROLE_A = '300000000000000003';
const CHANNEL_ID = '400000000000000004';
const MESSAGE_ID = '500000000000000005';
const NOW = new Date('2026-10-02T12:00:00.000Z');

function panel(overrides: Partial<ReactionRolePanel> = {}): ReactionRolePanel {
  return {
    id: 1,
    guildId: GUILD_MINE,
    channelId: CHANNEL_ID,
    messageId: MESSAGE_ID,
    expiresAt: new Date('2026-10-01T12:00:00.000Z'),
    closedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    options: [{ id: 1, panelId: 1, roleId: ROLE_A, label: null, emoji: null, description: null, position: 0 }],
    ...overrides,
  };
}

function fakeGuild(guildId: string): Guild {
  return {
    id: guildId,
    channels: { fetch: () => Promise.reject(new Error('Unknown Channel')) },
  } as unknown as Guild;
}

/**
 * Runner yang benar-benar menyaring menurut guild — meniru repository sungguhan
 * setelah perbaikannya, bukan meniru versi lamanya yang menarik seluruh baris.
 */
class ScopedRunner implements PanelExpiryRunner {
  public due: ReactionRolePanel[] = [];
  public readonly closed: number[] = [];

  /** Berapa kali job benar-benar menanyakan daftar ke runner. */
  public queries = 0;

  async findDueForExpiry(
    _now?: Date,
    guildIds: readonly string[] = [],
    limit?: number,
  ): Promise<ReactionRolePanel[]> {
    this.queries += 1;

    const owned = new Set(guildIds);

    return this.due
      .filter((item) => owned.has(item.guildId) && !item.closedAt)
      .slice(0, limit ?? Number.MAX_SAFE_INTEGER);
  }

  async markClosed(guildId: string, panelId: number, now?: Date): Promise<ReactionRolePanel | null> {
    const found = this.due.find((item) => item.id === panelId && item.guildId === guildId);
    if (!found || found.closedAt) return null;

    found.closedAt = now ?? new Date();
    this.closed.push(panelId);

    return { ...found };
  }
}

describe('cakupan guild pada penyapuan panel', () => {
  it('hanya menanyakan guild milik shard ini, jadi kuota batch tidak terisi panel shard lain', async () => {
    const runner = new ScopedRunner();
    // 25 panel milik guild lain mengisi kuota batch lebih dulu, baru menyusul
    // panel milik guild ini. Kalau kuerinya tidak dibatasi ke guild yang
    // dimiliki, 25 panel yang salah itu akan menyisakan nol ruang untuk yang
    // benar dan panel ini tidak akan pernah tertutup.
    runner.due = [
      ...Array.from({ length: 25 }, (_, i) => panel({ id: i + 1, guildId: GUILD_OTHER })),
      panel({ id: 100, guildId: GUILD_MINE }),
    ];

    const job = startPanelExpiryJob({
      runner,
      guilds: () => [fakeGuild(GUILD_MINE)],
      runOnStart: false,
      intervalMs: 0,
      batchSize: 25,
    });

    const result = await job.runOnce(NOW);

    expect(result).toEqual({ closed: 1, messageMissing: 1, skipped: 0 });
    expect(runner.closed).toEqual([100]);
    job.stop();
  });

  it('proses tanpa guild tidak menyentuh database sama sekali', async () => {
    const runner = new ScopedRunner();
    runner.due = [panel()];

    const job = startPanelExpiryJob({
      runner,
      // Bot belum sempat cache guild apa pun (mis. shard baru saja start).
      guilds: () => [],
      runOnStart: false,
      intervalMs: 0,
    });

    expect(await job.runOnce(NOW)).toEqual({ closed: 0, messageMissing: 0, skipped: 0 });
    expect(runner.closed).toEqual([]);
    // Tanpa guild milik sendiri tidak ada yang bisa ditutup, jadi kueri
    // tidak boleh dikirim sama sekali.
    expect(runner.queries).toBe(0);
    job.stop();
  });

  it('panel milik guild lain tetap diabaikan walau runner mengabaikan cakupan', async () => {
    const runner = new ScopedRunner();
    runner.due = [panel({ guildId: GUILD_OTHER })];

    const job = startPanelExpiryJob({
      runner,
      guilds: () => [fakeGuild(GUILD_MINE)],
      runOnStart: false,
      intervalMs: 0,
    });

    // Runner di sini menyaring sendiri, jadi panel luar tidak pernah sampai.
    expect(await job.runOnce(NOW)).toEqual({ closed: 0, messageMissing: 0, skipped: 0 });
    expect(runner.closed).toEqual([]);
    job.stop();
  });
});

/** Baris tabel minimal untuk repository Prisma. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    guildId: GUILD_MINE,
    channelId: CHANNEL_ID,
    messageId: MESSAGE_ID,
    expiresAt: new Date('2026-10-01T12:00:00.000Z'),
    closedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    options: [],
    ...overrides,
  };
}

/**
 * Klien Prisma palsu yang benar-benar menyimpan state, jadi urutan
 * klaim-then-read benar-benar teruji dan bukan sekadar bentuk panggilan.
 *
 * `updateMany` hanya mengubah baris yang cocok dengan where-nya (seperti
 * PostgreSQL) dan melaporkan berapa baris yang benar-benar berubah.
 */
function statefulPrisma(panel: Record<string, unknown> | null) {
  const state = panel ? { ...panel } : null;
  const calls: { updateWhere: unknown; findWhere: unknown; findManyWhere: unknown } = {
    updateWhere: null,
    findWhere: null,
    findManyWhere: null,
  };

  const matches = (candidate: Record<string, unknown> | null, where: Record<string, unknown>): boolean => {
    if (!candidate) return false;

    return Object.entries(where).every(([key, value]) => {
      if (key === 'in') {
        return Array.isArray(value) && value.includes(candidate[key] as string);
      }
      if (value !== null && typeof value === 'object' && 'lte' in (value as object)) {
        const bound = (value as { lte: Date }).lte;
        const actual = candidate[key];

        return actual instanceof Date && actual.getTime() <= bound.getTime();
      }

      return candidate[key] === value;
    });
  };

  const prisma = {
    reactionRolePanel: {
      async updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
        calls.updateWhere = args.where;

        if (!matches(state, args.where)) return { count: 0 };

        Object.assign(state!, args.data);

        return { count: 1 };
      },
      async findFirst(args: { where: Record<string, unknown> }) {
        calls.findWhere = args.where;

        return matches(state, args.where) ? { ...state } : null;
      },
      async findMany(args: { where: Record<string, unknown> }) {
        calls.findManyWhere = args.where;

        return matches(state, args.where) ? [{ ...state }] : [];
      },
    },
  };

  return { prisma: prisma as never, calls, state };
}

describe('klaim atomik markClosed', () => {
  it('kalah balapan ketika updateMany tidak mengubah baris', async () => {
    // Panel sudah ditutup pemanggil lain, jadi updateMany bersyarat
    // `closedAt: null` tidak mengubah apa pun dan klaim harus kalah.
    const { prisma, state } = statefulPrisma(row({ closedAt: new Date('2026-10-01T00:00:00.000Z') }));
    const repository = new PrismaReactionRoleRepository(prisma);

    expect(await repository.markClosed(GUILD_MINE, 1, NOW)).toBeNull();
    // Waktu penutupan tidak ditimpa oleh pemanggil yang kalah.
    expect(state?.closedAt).toEqual(new Date('2026-10-01T00:00:00.000Z'));
  });

  it('hanya bisa menutup panel milik guild itu sendiri', async () => {
    const { prisma, calls } = statefulPrisma(row());
    const repository = new PrismaReactionRoleRepository(prisma);

    expect(await repository.markClosed(GUILD_OTHER, 1, NOW)).toBeNull();
    expect(calls.updateWhere).toEqual({ id: 1, guildId: GUILD_OTHER, closedAt: null });
  });

  it('panel milik guild sendiri bisa ditutup dan closedAt yang kembali yang baru ditulis', async () => {
    // Urutan klaim-lalu-baca harus terlihat di sini: kalau baris dibaca
    // lebih dulu, closedAt yang kembali masih null dari pembacaan lama.
    const { prisma, state } = statefulPrisma(row());
    const repository = new PrismaReactionRoleRepository(prisma);

    const marked = await repository.markClosed(GUILD_MINE, 1, NOW);

    expect(marked?.closedAt).toEqual(NOW);
    expect(state?.closedAt).toEqual(NOW);
  });

  it('kueri penyapuan dibatasi ke guild yang diminta', async () => {
    const { prisma, calls } = statefulPrisma(row());
    const repository = new PrismaReactionRoleRepository(prisma);

    await repository.findDueForExpiry(NOW, [GUILD_MINE, GUILD_OTHER], 25);

    expect(calls.findManyWhere).toEqual({
      closedAt: null,
      expiresAt: { lte: NOW },
      guildId: { in: [GUILD_MINE, GUILD_OTHER] },
    });
  });

  it('panel milik guild yang tidak diminta tidak ikut terpakai', async () => {
    const { prisma } = statefulPrisma(row());
    const repository = new PrismaReactionRoleRepository(prisma);

    expect(await repository.findDueForExpiry(NOW, [GUILD_OTHER], 25)).toEqual([]);
  });

  it('daftar guild kosong mengembalikan hasil kosong tanpa menjalankan kueri', async () => {
    let queried = false;
    const prisma = {
      reactionRolePanel: {
        async findMany() {
          queried = true;

          return [];
        },
      },
    } as never;
    const repository = new PrismaReactionRoleRepository(prisma);

    expect(await repository.findDueForExpiry(NOW, [], 25)).toEqual([]);
    expect(queried).toBe(false);
  });
});

/**
 * Penjaga struktural: kedua perbaikan ini adalah tentang apa yang dikirim ke
 * database, jadi kueri sungguhan tidak bisa diperiksa tanpa Prisma. Penjaga ini
 * mengunci bahwa penyapuan meneruskan guild yang dimiliki ke kueri.
 */
describe('penjaga struktural penyapuan panel', () => {
  const jobSource = readFileSync(
    fileURLToPath(new URL('../src/services/panelExpiryJob.ts', import.meta.url)),
    'utf8',
  );
  const repoSource = readFileSync(
    fileURLToPath(new URL('../src/modules/reactionroles/repository.ts', import.meta.url)),
    'utf8',
  );

  it('sweep meneruskan daftar guild yang dimiliki ke findDueForExpiry', () => {
    expect(jobSource).toContain('runner.findDueForExpiry(now, ownedGuildIds, batchSize)');
  });

  it('kueri penyapuan menyaring guildId', () => {
    expect(repoSource).toContain('guildId: { in: [...guildIds] }');
  });

  it('klaim markClosed memakai count dari updateMany', () => {
    expect(repoSource).toContain('if (claimed.count === 0) return null;');
  });
});
