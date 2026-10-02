import { describe, expect, it } from 'vitest';
import type { ModerationRepository } from '../src/modules/moderation/repository.js';
import { ModerationService } from '../src/modules/moderation/service.js';
import type {
  CreateCaseInput,
  CreateWarningInput,
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
}

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
