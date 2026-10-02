import { describe, expect, it } from 'vitest';
import type { ModerationRepository } from '../src/modules/moderation/repository.js';
import { CHANNEL_TARGET_ACTIONS, type ModeratorActionRow, type ModeratorTotals } from '../src/modules/moderation/modProfile.js';
import type { TargetActionRow } from '../src/modules/moderation/priorCases.js';
import { ModerationService } from '../src/modules/moderation/service.js';
import type {
  CreateCaseInput,
  CreateWarningInput,
  DmStatus,
  ModerationCase,
  WarningRecord,
} from '../src/modules/moderation/types.js';

const GUILD_ID = '123456789012345678';
const OTHER_GUILD = '987654321098765432';
const USER_ID = '222222222222222222';
const MOD_ID = '333333333333333333';

class FakeModerationRepository implements ModerationRepository {
  public readonly cases = new Map<number, ModerationCase>();
  public readonly warnings: WarningRecord[] = [];
  /** Disetel untuk menguji jalur best-effort saat status DM gagal ditulis. */
  public dmStatusError: Error | null = null;
  private nextCaseId = 1;
  private readonly counters = new Map<string, number>();

  async createCase(input: CreateCaseInput): Promise<ModerationCase> {
    const caseNumber = (this.counters.get(input.guildId) ?? 0) + 1;
    this.counters.set(input.guildId, caseNumber);

    const created: ModerationCase = {
      id: this.nextCaseId++,
      caseNumber,
      guildId: input.guildId,
      type: input.type,
      targetId: input.targetId,
      moderatorId: input.moderatorId,
      reason: input.reason,
      createdAt: new Date('2026-10-02T00:00:00.000Z'),
      expiresAt: input.expiresAt ?? null,
      active: true,
      dmStatus: null,
    };

    this.cases.set(created.id, created);
    return { ...created };
  }

  async createWarning(input: CreateWarningInput): Promise<WarningRecord> {
    const parent = this.cases.get(input.caseId);
    if (!parent) throw new Error('case tidak ditemukan');

    const warning: WarningRecord = {
      id: this.warnings.length + 1,
      caseId: parent.id,
      caseNumber: parent.caseNumber,
      guildId: input.guildId,
      userId: input.userId,
      moderatorId: input.moderatorId,
      reason: input.reason,
      createdAt: new Date('2026-10-02T00:00:00.000Z'),
    };

    this.warnings.push(warning);
    return { ...warning };
  }

  async findCaseByNumber(guildId: string, caseNumber: number): Promise<ModerationCase | null> {
    for (const item of this.cases.values()) {
      if (item.guildId === guildId && item.caseNumber === caseNumber) return { ...item };
    }
    return null;
  }

  async listWarnings(guildId: string, userId: string): Promise<WarningRecord[]> {
    return this.warnings
      .filter((warning) => warning.guildId === guildId && warning.userId === userId)
      .map((warning) => ({ ...warning }));
  }

  async countWarnings(guildId: string, userId: string): Promise<number> {
    return this.warnings.filter(
      (warning) => warning.guildId === guildId && warning.userId === userId,
    ).length;
  }

  async listNotes(guildId: string, userId: string): Promise<ModerationCase[]> {
    return [...this.cases.values()]
      .filter(
        (item) => item.guildId === guildId && item.targetId === userId && item.type === 'note',
      )
      .slice(0, 10)
      .map((item) => ({ ...item }));
  }

  async listCasesForTarget(
    guildId: string,
    targetId: string,
    options: { excludeCaseNumber?: number; take: number },
  ): Promise<ModerationCase[]> {
    return [...this.cases.values()]
      .filter(
        (item) =>
          item.guildId === guildId &&
          item.targetId === targetId &&
          item.caseNumber !== options.excludeCaseNumber,
      )
      // Sama seperti repository sungguhan: `createdAt` sama-sama jatuh di detik
      // yang sama saat kasus dibuat, jadi nomor kasus yang menentukan.
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.caseNumber - a.caseNumber)
      .slice(0, options.take)
      .map((item) => ({ ...item }));
  }

  async revokeWarning(guildId: string, caseNumber: number): Promise<ModerationCase | null> {
    const found = await this.findCaseByNumber(guildId, caseNumber);
    if (!found || found.type !== 'warn') return null;

    const index = this.warnings.findIndex((warning) => warning.caseId === found.id);
    if (index >= 0) this.warnings.splice(index, 1);

    const updated = { ...found, active: false };
    this.cases.set(updated.id, updated);
    return updated;
  }

  async setCaseActive(guildId: string, caseNumber: number, active: boolean): Promise<void> {
    const found = await this.findCaseByNumber(guildId, caseNumber);
    if (found) this.cases.set(found.id, { ...found, active });
  }

  async setCaseDmStatus(guildId: string, caseNumber: number, dmStatus: DmStatus): Promise<void> {
    if (this.dmStatusError) throw this.dmStatusError;

    const found = [...this.cases.values()].find(
      (item) => item.guildId === guildId && item.caseNumber === caseNumber,
    );
    if (found && found.dmStatus === null) found.dmStatus = dmStatus;
  }

  async deleteExpiredWarnings(cutoff: Date): Promise<number> {
    let removed = 0;
    for (let index = this.warnings.length - 1; index >= 0; index -= 1) {
      const warning = this.warnings[index];
      if (warning && warning.createdAt < cutoff) {
        this.warnings.splice(index, 1);
        removed += 1;
      }
    }
    return removed;
  }

  async deleteExpiredCases(cutoff: Date): Promise<number> {
    let removed = 0;
    for (const [id, item] of [...this.cases]) {
      if (item.createdAt < cutoff) {
        this.cases.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  async listCasesByModerator(
    guildId: string,
    moderatorId: string,
    take: number,
  ): Promise<ModerationCase[]> {
    return [...this.cases.values()]
      .filter((item) => item.guildId === guildId && item.moderatorId === moderatorId)
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() || b.caseNumber - a.caseNumber,
      )
      .slice(0, take)
      .map((item) => ({ ...item }));
  }

  async countByTypeAndActive(
    guildId: string,
    moderatorId: string,
  ): Promise<ModeratorActionRow[]> {
    const buckets = new Map<string, ModeratorActionRow>();

    for (const item of this.cases.values()) {
      if (item.guildId !== guildId || item.moderatorId !== moderatorId) continue;

      const key = `${item.type}:${item.active}`;
      const bucket = buckets.get(key) ?? { type: item.type, active: item.active, count: 0 };
      bucket.count += 1;
      buckets.set(key, bucket);
    }

    return [...buckets.values()];
  }

  async countTargetByTypeAndActive(
    guildId: string,
    targetId: string,
    excludeCaseNumber?: number,
  ): Promise<TargetActionRow[]> {
    const buckets = new Map<string, TargetActionRow>();

    for (const item of this.cases.values()) {
      if (item.guildId !== guildId || item.targetId !== targetId) continue;
      if (excludeCaseNumber !== undefined && item.caseNumber === excludeCaseNumber) continue;

      const key = `${item.type}:${item.active}`;
      const bucket = buckets.get(key) ?? { type: item.type, active: item.active, count: 0 };
      bucket.count += 1;
      buckets.set(key, bucket);
    }

    return [...buckets.values()];
  }

  async summarizeModerator(
    guildId: string,
    moderatorId: string,
    recentSince: Date,
  ): Promise<ModeratorTotals> {
    const owned = [...this.cases.values()].filter(
      (item) => item.guildId === guildId && item.moderatorId === moderatorId,
    );
    const times = owned.map((item) => item.createdAt.getTime());

    return {
      total: owned.length,
      uniqueTargets: new Set(
        owned
          .filter((item) => !CHANNEL_TARGET_ACTIONS.includes(item.type))
          .map((item) => item.targetId),
      ).size,
      firstCaseAt: times.length > 0 ? new Date(Math.min(...times)) : null,
      lastCaseAt: times.length > 0 ? new Date(Math.max(...times)) : null,
      recentCount: owned.filter((item) => item.createdAt >= recentSince).length,
    };
  }
}

describe('ModerationService.moderatorProfile', () => {
  const OTHER_MOD = '777777777777777777';
  const OTHER_USER = '888888888888888888';
  const NOW = new Date('2026-10-02T12:00:00.000Z');

  /** Tanggal kasus bisa diubah lewat peta repository supaya jendela waktu bisa diuji. */
  async function addCase(
    repository: FakeModerationRepository,
    overrides: Partial<ModerationCase> & { createdAt?: Date } = {},
  ): Promise<ModerationCase> {
    const created = await repository.createCase({
      guildId: GUILD_ID,
      type: 'ban',
      targetId: USER_ID,
      moderatorId: MOD_ID,
      reason: 'spam',
      ...overrides,
    });

    const stored = repository.cases.get(created.id)!;
    if (overrides.createdAt) stored.createdAt = overrides.createdAt;

    return stored;
  }

  it('moderator tanpa kasus tetap dapat profil, bukan null', async () => {
    const { service } = makeService();

    const profile = await service.moderatorProfile(GUILD_ID, MOD_ID, NOW);

    expect(profile.totals.total).toBe(0);
    expect(profile.actions).toEqual([]);
  });

  it('menghitung hanya kasus milik moderator itu', async () => {
    const { repository, service } = makeService();

    await addCase(repository);
    await addCase(repository, { moderatorId: OTHER_MOD });
    await addCase(repository, { guildId: OTHER_GUILD });

    const profile = await service.moderatorProfile(GUILD_ID, MOD_ID, NOW);

    expect(profile.totals.total).toBe(1);
  });

  it('sebaran aksi dihitung dari seluruh kasus moderator itu', async () => {
    const { repository, service } = makeService();

    await addCase(repository, { type: 'ban' });
    await addCase(repository, { type: 'ban' });
    await addCase(repository, { type: 'warn' });

    const profile = await service.moderatorProfile(GUILD_ID, MOD_ID, NOW);

    expect(profile.actions.map((stat) => [stat.type, stat.total])).toEqual([
      ['ban', 2],
      ['warn', 1],
    ]);
  });

  it('aksi terhadap channel tidak menambah hitungan target unik', async () => {
    const { repository, service } = makeService();

    await addCase(repository, { type: 'ban', targetId: USER_ID });
    await addCase(repository, { type: 'lock', targetId: '444444444444444444' });
    await addCase(repository, { type: 'unlock', targetId: '444444444444444444' });

    const profile = await service.moderatorProfile(GUILD_ID, MOD_ID, NOW);

    expect(profile.totals.uniqueTargets).toBe(1);
  });

  it('kasus terbaru dibatasi jumlahnya', async () => {
    const { repository, service } = makeService();
    for (let index = 0; index < 15; index += 1) {
      await addCase(repository, { createdAt: new Date(NOW.getTime() - index * 86_400_000) });
    }

    const profile = await service.moderatorProfile(GUILD_ID, MOD_ID, NOW);

    expect(profile.recentCases).toHaveLength(10);
    expect(profile.totals.total).toBe(15);
  });

  it('jendela aktivitas 30 hari dihitung terpisah dari total', async () => {
    const { repository, service } = makeService();

    await addCase(repository, { createdAt: new Date('2026-10-01T00:00:00.000Z') });
    await addCase(repository, { createdAt: new Date('2026-08-01T00:00:00.000Z') });

    const profile = await service.moderatorProfile(GUILD_ID, MOD_ID, NOW);

    expect(profile.totals.total).toBe(2);
    expect(profile.totals.recentCount).toBe(1);
  });

  it('rentang waktu kasus pertama dan terakhir terisi', async () => {
    const { repository, service } = makeService();
    const old = new Date('2026-01-10T08:00:00.000Z');
    const recent = new Date('2026-09-30T08:00:00.000Z');

    await addCase(repository, { createdAt: old });
    await addCase(repository, { createdAt: recent });

    const profile = await service.moderatorProfile(GUILD_ID, MOD_ID, NOW);

    expect(profile.totals.firstCaseAt).toEqual(old);
    expect(profile.totals.lastCaseAt).toEqual(recent);
  });

  it('peringatan yang dicabut tidak dihitung sebagai kegagalan', async () => {
    const { repository, service } = makeService();
    const warn = await addCase(repository, { type: 'warn' });
    const ban = await addCase(repository, { type: 'ban' });

    await service.revokeWarning(GUILD_ID, warn.caseNumber);
    repository.cases.get(ban.id)!.active = false;

    const profile = await service.moderatorProfile(GUILD_ID, MOD_ID, NOW);

    const warnStat = profile.actions.find((stat) => stat.type === 'warn');
    const banStat = profile.actions.find((stat) => stat.type === 'ban');

    expect(warnStat?.revoked).toBe(1);
    expect(warnStat?.failed).toBe(0);
    expect(banStat?.failed).toBe(1);
  });

  it('kasus moderator lain di server lain tidak bocor ke profil', async () => {
    const { repository, service } = makeService();
    await addCase(repository, { guildId: OTHER_GUILD, moderatorId: OTHER_MOD, targetId: OTHER_USER });

    const profile = await service.moderatorProfile(OTHER_GUILD, OTHER_MOD, NOW);

    expect(profile.totals.total).toBe(1);
    expect(profile.totals.uniqueTargets).toBe(1);
  });
});

const makeService = (): { service: ModerationService; repository: FakeModerationRepository } => {
  const repository = new FakeModerationRepository();
  return { service: new ModerationService(repository), repository };
};

describe('ModerationService.recordAction', () => {
  it('memberi nomor kasus berurutan per server', async () => {
    const { service } = makeService();

    const first = await service.recordAction({
      guildId: GUILD_ID,
      type: 'ban',
      targetId: USER_ID,
      moderatorId: MOD_ID,
      reason: 'spam',
    });
    const second = await service.recordAction({
      guildId: GUILD_ID,
      type: 'kick',
      targetId: USER_ID,
      moderatorId: MOD_ID,
      reason: null,
    });

    expect(first.caseNumber).toBe(1);
    expect(second.caseNumber).toBe(2);
    expect(first.expiresAt).toBeNull();
  });

  it('nomor kasus tiap server independen', async () => {
    const { service } = makeService();

    await service.recordAction({
      guildId: GUILD_ID,
      type: 'ban',
      targetId: USER_ID,
      moderatorId: MOD_ID,
      reason: null,
    });
    const other = await service.recordAction({
      guildId: OTHER_GUILD,
      type: 'warn',
      targetId: USER_ID,
      moderatorId: MOD_ID,
      reason: null,
    });

    expect(other.caseNumber).toBe(1);
  });

  it('menyimpan expiresAt untuk timeout', async () => {
    const { service } = makeService();
    const expiresAt = new Date('2026-10-03T00:00:00.000Z');

    const created = await service.recordAction({
      guildId: GUILD_ID,
      type: 'timeout',
      targetId: USER_ID,
      moderatorId: MOD_ID,
      reason: 'flood',
      expiresAt,
    });

    expect(created.expiresAt).toEqual(expiresAt);
  });
});

describe('ModerationService warning', () => {
  it('recordWarning membuat kasus bertipe warn + baris warning yang terhubung', async () => {
    const { service, repository } = makeService();

    const created = await service.recordWarning({
      guildId: GUILD_ID,
      targetId: USER_ID,
      moderatorId: MOD_ID,
      reason: 'kata kasar',
    });

    expect(created.case.type).toBe('warn');
    expect(created.warning.caseNumber).toBe(created.case.caseNumber);
    expect(repository.warnings).toHaveLength(1);
  });

  it('listWarnings mengembalikan daftar dan total', async () => {
    const { service } = makeService();

    await service.recordWarning({
      guildId: GUILD_ID,
      targetId: USER_ID,
      moderatorId: MOD_ID,
      reason: 'pertama',
    });
    await service.recordWarning({
      guildId: GUILD_ID,
      targetId: USER_ID,
      moderatorId: MOD_ID,
      reason: 'kedua',
    });

    const summary = await service.listWarnings(GUILD_ID, USER_ID);

    expect(summary.total).toBe(2);
    expect(summary.warnings).toHaveLength(2);
    expect(summary.warnings.map((warning) => warning.reason)).toEqual(['pertama', 'kedua']);
  });

  it('revokeWarning menghapus warning dan menonaktifkan kasus', async () => {
    const { service, repository } = makeService();

    const created = await service.recordWarning({
      guildId: GUILD_ID,
      targetId: USER_ID,
      moderatorId: MOD_ID,
      reason: 'salah paham',
    });

    const revoked = await service.revokeWarning(GUILD_ID, created.case.caseNumber);

    expect(revoked?.active).toBe(false);
    expect(repository.warnings).toHaveLength(0);
    await expect(service.listWarnings(GUILD_ID, USER_ID)).resolves.toEqual({ warnings: [], total: 0 });
  });

  it('revokeWarning null untuk kasus yang tidak ada atau bukan warn', async () => {
    const { service } = makeService();

    await service.recordAction({
      guildId: GUILD_ID,
      type: 'ban',
      targetId: USER_ID,
      moderatorId: MOD_ID,
      reason: null,
    });

    await expect(service.revokeWarning(GUILD_ID, 1)).resolves.toBeNull();
    await expect(service.revokeWarning(GUILD_ID, 99)).resolves.toBeNull();
  });

  it('listNotes hanya mengembalikan kasus bertipe note milik user itu', async () => {
    const { service } = makeService();

    await service.recordAction({
      guildId: GUILD_ID,
      type: 'note',
      targetId: USER_ID,
      moderatorId: MOD_ID,
      reason: 'pernah spam',
    });
    await service.recordAction({
      guildId: GUILD_ID,
      type: 'note',
      targetId: '999999999999999999',
      moderatorId: MOD_ID,
      reason: 'user lain',
    });
    await service.recordAction({
      guildId: GUILD_ID,
      type: 'ban',
      targetId: USER_ID,
      moderatorId: MOD_ID,
      reason: 'bukan catatan',
    });

    const notes = await service.listNotes(GUILD_ID, USER_ID);

    expect(notes).toHaveLength(1);
    expect(notes[0]?.reason).toBe('pernah spam');
  });

  it('deactivateCase menandai kasus tidak aktif', async () => {
    const { service, repository } = makeService();

    const created = await service.recordAction({
      guildId: GUILD_ID,
      type: 'ban',
      targetId: USER_ID,
      moderatorId: MOD_ID,
      reason: null,
    });

    await service.deactivateCase(GUILD_ID, created.caseNumber);

    await expect(repository.findCaseByNumber(GUILD_ID, created.caseNumber)).resolves.toMatchObject({
      active: false,
    });
  });
});

describe('ModerationService.priorCaseSummary', () => {
  const OTHER_USER = '888888888888888888';

  async function warn(service: ModerationService, userId = USER_ID): Promise<number> {
    const created = await service.recordWarning({
      guildId: GUILD_ID,
      targetId: userId,
      moderatorId: MOD_ID,
      reason: 'spam',
    });

    return created.case.caseNumber;
  }

  it('target bersih menghasilkan ringkasan tanpa riwayat', async () => {
    const { service } = makeService();

    const summary = await service.priorCaseSummary(GUILD_ID, USER_ID);

    expect(summary.hasHistory).toBe(false);
    expect(summary.total).toBe(0);
    expect(summary.recentCases).toEqual([]);
  });

  it('menghitung kasus sebelumnya tanpa menghitung kasus yang sedang dibuat', async () => {
    // Tanpa pengecualian ini, setiap ban akan melaporkan dirinya sendiri sebagai
    // "pernah di-ban sebelumnya".
    const { service } = makeService();
    await warn(service);

    const fresh = await service.recordAction({
      guildId: GUILD_ID,
      type: 'ban',
      targetId: USER_ID,
      moderatorId: MOD_ID,
      reason: 'spam parah',
    });

    const summary = await service.priorCaseSummary(GUILD_ID, USER_ID, fresh.caseNumber);

    expect(summary.total).toBe(1);
    expect(summary.byAction).toEqual([{ type: 'warn', count: 1, inactive: 0 }]);
  });

  it('tidak ikut menghitung kasus milik target lain atau server lain', async () => {
    const { service } = makeService();
    await warn(service, OTHER_USER);
    await service.recordAction({
      guildId: OTHER_GUILD,
      type: 'timeout',
      targetId: USER_ID,
      moderatorId: MOD_ID,
      reason: null,
    });

    const summary = await service.priorCaseSummary(GUILD_ID, USER_ID);

    expect(summary.total).toBe(0);
    expect(summary.hasHistory).toBe(false);
  });

  it('peringatan aktif dihitung dari tabel peringatan, jadi yang dicabut hilang', async () => {
    const { service } = makeService();
    const first = await warn(service);
    await warn(service);

    expect((await service.priorCaseSummary(GUILD_ID, USER_ID)).activeWarnings).toBe(2);

    await service.revokeWarning(GUILD_ID, first);

    const summary = await service.priorCaseSummary(GUILD_ID, USER_ID);

    expect(summary.activeWarnings).toBe(1);
    // Kasus yang dicabut tetap dihitung sebagai riwayat — Moderator yang mencabut
    // peringatan tidak menghapus jejaknya.
    expect(summary.total).toBe(2);
  });

  it('menampilkan kasus terbaru, terbaru lebih dulu', async () => {
    const { service } = makeService();
    await warn(service);
    await service.recordAction({
      guildId: GUILD_ID,
      type: 'timeout',
      targetId: USER_ID,
      moderatorId: MOD_ID,
      reason: 'terus spam',
    });

    const summary = await service.priorCaseSummary(GUILD_ID, USER_ID);

    expect(summary.recentCases.map((item) => item.type)).toEqual(['timeout', 'warn']);
  });
});
