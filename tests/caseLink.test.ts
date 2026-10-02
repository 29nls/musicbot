import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCaseLinks,
  consumeCaseLink,
  pendingCaseLinkCount,
  registerCaseLink,
  type CaseLink,
} from '../src/modules/moderation/caseLink.js';

const GUILD_ID = '123456789012345678';
const OTHER_GUILD_ID = '999999999999999999';
const USER_ID = '222222222222222222';
const CHANNEL_ID = '333333333333333333';

function link(overrides: Partial<Omit<CaseLink, 'createdAt'>> = {}): Omit<CaseLink, 'createdAt'> {
  return {
    guildId: GUILD_ID,
    targetId: USER_ID,
    action: 'ban',
    caseNumber: 142,
    moderatorId: '1000000000000000001',
    ...overrides,
  };
}

beforeEach(() => {
  clearCaseLinks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 2, 10, 0, 0));
});

afterEach(() => {
  clearCaseLinks();
  vi.useRealTimers();
});

describe('registerCaseLink & consumeCaseLink', () => {
  it('tautan diambil sekali dengan data kasus yang benar', () => {
    registerCaseLink(link());

    expect(consumeCaseLink(GUILD_ID, USER_ID, ['ban'])).toEqual({
      guildId: GUILD_ID,
      targetId: USER_ID,
      action: 'ban',
      caseNumber: 142,
      moderatorId: '1000000000000000001',
      createdAt: Date.now(),
    });

    // Aksi hanya dicatat satu kali; event kedua tidak menemukan tautan lagi.
    expect(consumeCaseLink(GUILD_ID, USER_ID, ['ban'])).toBeNull();
    expect(pendingCaseLinkCount()).toBe(0);
  });

  it('aksi dari luar Harmony tidak menemukan tautan', () => {
    expect(consumeCaseLink(GUILD_ID, USER_ID, ['ban'])).toBeNull();
  });

  it('tidak salah mengambil tautan dengan aksi lain', () => {
    registerCaseLink(link({ action: 'timeout' }));

    expect(consumeCaseLink(GUILD_ID, USER_ID, ['kick'])).toBeNull();
    expect(consumeCaseLink(GUILD_ID, USER_ID, ['timeout'])).not.toBeNull();
  });

  it('menjaga urutan saat beberapa aksi beruntun pada satu target', () => {
    registerCaseLink(link({ action: 'timeout', caseNumber: 10 }));
    registerCaseLink(link({ action: 'kick', caseNumber: 11 }));

    expect(consumeCaseLink(GUILD_ID, USER_ID, ['kick'])?.caseNumber).toBe(11);
    expect(consumeCaseLink(GUILD_ID, USER_ID, ['timeout'])?.caseNumber).toBe(10);
  });

  it('tautan channel tidak tertukar dengan tautan member', () => {
    registerCaseLink(link({ action: 'lock', targetId: CHANNEL_ID, caseNumber: 5 }));

    expect(consumeCaseLink(GUILD_ID, USER_ID, ['lock'])).toBeNull();
    expect(consumeCaseLink(GUILD_ID, CHANNEL_ID, ['lock'])?.caseNumber).toBe(5);
  });

  it('server berbeda tidak saling mengambil tautan', () => {
    registerCaseLink(link({ guildId: OTHER_GUILD_ID }));

    expect(consumeCaseLink(GUILD_ID, USER_ID, ['ban'])).toBeNull();
    expect(consumeCaseLink(OTHER_GUILD_ID, USER_ID, ['ban'])).not.toBeNull();
  });

  it('tautan kedaluwarsa setelah 60 detik', () => {
    registerCaseLink(link());
    expect(pendingCaseLinkCount()).toBe(1);

    vi.advanceTimersByTime(59_000);
    expect(pendingCaseLinkCount()).toBe(1);

    vi.advanceTimersByTime(2_000);
    expect(pendingCaseLinkCount()).toBe(0);
    expect(consumeCaseLink(GUILD_ID, USER_ID, ['ban'])).toBeNull();
  });

  it('membatasi jumlah target yang menyimpan tautan', () => {
    for (let index = 0; index < 620; index += 1) {
      registerCaseLink(link({ targetId: String(1_000_000_000_000_000_000n + BigInt(index)) }));
    }

    expect(pendingCaseLinkCount()).toBeLessThanOrEqual(500);
  });

  it('clearCaseLinks bisa membersihkan satu server saja', () => {
    registerCaseLink(link());
    registerCaseLink(link({ guildId: OTHER_GUILD_ID }));

    clearCaseLinks(GUILD_ID);

    expect(consumeCaseLink(GUILD_ID, USER_ID, ['ban'])).toBeNull();
    expect(consumeCaseLink(OTHER_GUILD_ID, USER_ID, ['ban'])).not.toBeNull();
  });
});
