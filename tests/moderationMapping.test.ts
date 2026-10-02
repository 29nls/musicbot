import { describe, expect, it } from 'vitest';
import { toCaseDomain, toWarningDomain } from '../src/modules/moderation/mapping.js';

describe('toCaseDomain', () => {
  it('memetakan baris kasus apa adanya', () => {
    const domain = toCaseDomain({
      id: 1,
      caseNumber: 7,
      guildId: '123456789012345678',
      type: 'ban',
      targetId: '222222222222222222',
      moderatorId: '333333333333333333',
      reason: 'spam',
      createdAt: new Date('2026-10-02T00:00:00.000Z'),
      expiresAt: null,
      active: true,
      dmStatus: null,
    });

    expect(domain.type).toBe('ban');
    expect(domain.caseNumber).toBe(7);
    expect(domain.active).toBe(true);
  });

  it('tahan tipe tak dikenal (data lama/rusak)', () => {
    const domain = toCaseDomain({
      id: 2,
      caseNumber: 8,
      guildId: '123456789012345678',
      type: 'softban',
      targetId: '222222222222222222',
      moderatorId: '333333333333333333',
      reason: null,
      createdAt: new Date(),
      expiresAt: null,
      active: false,
      dmStatus: null,
    });

    expect(domain.type).toBe('warn');
  });
});

describe('toWarningDomain', () => {
  it('mengambil nomor kasus dari relasi', () => {
    const domain = toWarningDomain({
      id: 3,
      caseId: 9,
      guildId: '123456789012345678',
      userId: '222222222222222222',
      moderatorId: '333333333333333333',
      reason: 'kata kasar',
      createdAt: new Date('2026-10-02T00:00:00.000Z'),
      case: { caseNumber: 12 },
    });

    expect(domain.caseNumber).toBe(12);
    expect(domain.userId).toBe('222222222222222222');
  });
});
