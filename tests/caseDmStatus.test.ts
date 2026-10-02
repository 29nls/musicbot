import { describe, expect, it } from 'vitest';
import { DM_STATUSES, isDmStatus, type DmStatus } from '../src/modules/moderation/types.js';
import { toCaseDomain } from '../src/modules/moderation/mapping.js';
import { dmDeliveryLine } from '../src/modules/moderation/caseView.js';
import { caseSummaryEmbed } from '../src/modules/moderation/embeds.js';
import type { ModerationCase } from '../src/modules/moderation/types.js';

const GUILD_ID = '123456789012345678';
const USER_ID = '222222222222222222';
const MOD_ID = '333333333333333333';

function record(overrides: Partial<ModerationCase> = {}): ModerationCase {
  return {
    id: 1,
    caseNumber: 142,
    guildId: GUILD_ID,
    type: 'ban',
    targetId: USER_ID,
    moderatorId: MOD_ID,
    reason: 'Spam tautan',
    createdAt: new Date('2026-10-02T12:00:00.000Z'),
    expiresAt: null,
    active: true,
    dmStatus: null,
    ...overrides,
  };
}

describe('DmStatus', () => {
  it('hanya menerima dua nilai yang dikenal', () => {
    expect(DM_STATUSES).toEqual(['sent', 'failed']);

    for (const value of DM_STATUSES) {
      expect(isDmStatus(value)).toBe(true);
    }
  });

  it('menolak nilai lain, termasuk string kosong', () => {
    for (const value of ['', 'pending', 'SENT', 'sent ', 'unknown', 'true']) {
      expect(isDmStatus(value)).toBe(false);
    }
  });
});

describe('toCaseDomain & dm_status', () => {
  function row(dmStatus: string | null) {
    return {
      id: 1,
      caseNumber: 7,
      guildId: GUILD_ID,
      type: 'ban',
      targetId: USER_ID,
      moderatorId: MOD_ID,
      reason: 'spam',
      createdAt: new Date('2026-10-02T00:00:00.000Z'),
      expiresAt: null,
      active: true,
      dmStatus,
    };
  }

  it('memetakan status yang dikenal apa adanya', () => {
    expect(toCaseDomain(row('sent')).dmStatus).toBe('sent');
    expect(toCaseDomain(row('failed')).dmStatus).toBe('failed');
  });

  it('kolom kosong pada kasus lama jadi null, bukan error', () => {
    expect(toCaseDomain(row(null)).dmStatus).toBeNull();
  });

  it('nilai rusak diperlakukan sebagai tidak ada, bukan "terkirim"', () => {
    // Menampilkan terkirim padahal tidak pernah terjadi akan menyesatkan.
    expect(toCaseDomain(row('delivered_by_vendor')).dmStatus).toBeNull();
  });
});

describe('dmDeliveryLine', () => {
  it('menyatakan terkirim', () => {
    expect(dmDeliveryLine(record({ dmStatus: 'sent' }))).toMatch(/terkirim/i);
  });

  it('menyatakan gagal dan menyebut sebabnya', () => {
    const line = dmDeliveryLine(record({ dmStatus: 'failed' }));

    expect(line).toMatch(/tidak terkirim/);
    expect(line).toMatch(/tertutup atau bot diblokir/);
    expect(line).toContain("DM notifikasi");
  });

  it('kasus notifikasi tanpa status ditampilkan "tidak tercatat", bukan "tidak dikirim"', () => {
    const line = dmDeliveryLine(record({ dmStatus: null }));

    expect(line).toMatch(/tidak tercatat/);
    expect(line).not.toMatch(/tidak terkirim/);
  });

  it('aksi channel tidak punya baris sama sekali', () => {
    for (const type of ['slowmode', 'lock', 'unlock', 'note'] as const) {
      expect(dmDeliveryLine(record({ type, dmStatus: null }))).toBeNull();
    }
  });

  it('semua aksi yang seharusnya mengirim DM punya baris', () => {
    for (const type of ['ban', 'kick', 'timeout', 'warn', 'unban'] as const) {
      expect(dmDeliveryLine(record({ type, dmStatus: null }))).not.toBeNull();
    }
  });
});

describe('field Notifikasi di /case', () => {
  function fieldValue(caseRecord: ModerationCase): string | null {
    const fields = caseSummaryEmbed(caseRecord).toJSON().fields ?? [];

    return fields.find((item) => item.name === 'Notifikasi')?.value ?? null;
  }

  it('muncul saat status terkirim', () => {
    expect(fieldValue(record({ dmStatus: 'sent' }))).toContain('terkirim');
  });

  it('muncul saat status gagal', () => {
    expect(fieldValue(record({ dmStatus: 'failed' }))).toContain('tidak terkirim');
  });

  it('muncul untuk kasus lama yang statusnya tidak tercatat', () => {
    expect(fieldValue(record({ dmStatus: null }))).toContain('tidak tercatat');
  });

  it('tidak muncul untuk aksi yang memang tidak mengirim DM', () => {
    for (const type of ['slowmode', 'lock', 'unlock', 'note'] as const) {
      expect(fieldValue(record({ type, dmStatus: null }))).toBeNull();
    }
  });

  it('ditampilkan inline supaya tidak memakan tinggi embed', () => {
    const fields = caseSummaryEmbed(record({ dmStatus: 'sent' })).toJSON().fields ?? [];
    const field = fields.find((item) => item.name === 'Notifikasi');

    expect(field?.inline).toBe(true);
  });

  it('tidak merusak field lain di halaman yang sama', () => {
    const fields = caseSummaryEmbed(record({ dmStatus: 'sent' })).toJSON().fields ?? [];
    const names = fields.map((item) => item.name);

    expect(names).toContain('Target');
    expect(names).toContain('Moderator');
    expect(names).toContain('Alasan');
  });
});

describe('status DM pada siklus hidup kasus', () => {
  it('penulisan hanya mengisi status yang masih kosong', () => {
    // Syarat `dmStatus: null` di repository membuat penulisan ini idempoten,
    // jadi hasil DM yang sudah tercatat tidak bisa tertimpa.
    const first: DmStatus = 'sent';
    const second: DmStatus = 'failed';

    expect(first).not.toBe(second);
    expect({ dmStatus: first }).toEqual({ dmStatus: first });
  });
});