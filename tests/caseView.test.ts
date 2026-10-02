import { afterEach, describe, expect, it, vi } from 'vitest';
import { caseHistoryEmbed, caseSummaryEmbed } from '../src/modules/moderation/embeds.js';
import {
  CASE_LOG_WINDOW_MS,
  caseHistoryLine,
  caseLogWindow,
  caseReasonText,
  caseTargetKind,
  currentStateLines,
  describeCaseStatus,
} from '../src/modules/moderation/caseView.js';
import type { ModerationAction, ModerationCase } from '../src/modules/moderation/types.js';

const GUILD_ID = '123456789012345678';
const USER_ID = '222222222222222222';
const CHANNEL_ID = '333333333333333333';
const MOD_ID = '444444444444444444';

const CREATED_AT = new Date('2026-10-02T12:00:00.000Z');

function record(overrides: Partial<ModerationCase> = {}): ModerationCase {
  return {
    id: 1,
    caseNumber: 142,
    guildId: GUILD_ID,
    type: 'ban',
    targetId: USER_ID,
    moderatorId: MOD_ID,
    reason: 'Spam_links',
    createdAt: CREATED_AT,
    expiresAt: null,
    active: true,
    dmStatus: null,
    ...overrides,
  };
}

function warnRecord(overrides: Partial<ModerationCase> = {}): ModerationCase {
  return record({ type: 'warn', reason: null, ...overrides });
}

describe('caseTargetKind', () => {
  it('channel untuk aksi channel', () => {
    for (const type of ['slowmode', 'lock', 'unlock'] as ModerationAction[]) {
      expect(caseTargetKind(record({ type }))).toBe('channel');
    }
  });

  it('user untuk aksi lain', () => {
    for (const type of ['ban', 'kick', 'timeout', 'warn', 'unban', 'note'] as ModerationAction[]) {
      expect(caseTargetKind(record({ type }))).toBe('user');
    }
  });
});

describe('describeCaseStatus', () => {
  it('kasus aktif', () => {
    expect(describeCaseStatus(record())).toBe('✅ Aktif');
  });

  it('peringatan tidak aktif berarti dicabut', () => {
    expect(describeCaseStatus(warnRecord({ active: false }))).toBe('♻️ Dicabut oleh moderator');
  });

  it('aksi lain yang tidak aktif berarti gagal dieksekusi', () => {
    expect(describeCaseStatus(record({ active: false }))).toBe(
      '❌ Nonaktif — aksi Discord gagal dieksekusi',
    );
  });
});

describe('caseLogWindow', () => {
  it('mengambil satu jam sebelum & sesudah waktu kasus', () => {
    const window = caseLogWindow(record());

    expect(window.from.getTime()).toBe(CREATED_AT.getTime() - CASE_LOG_WINDOW_MS);
    expect(window.to.getTime()).toBe(CREATED_AT.getTime() + CASE_LOG_WINDOW_MS);
  });
});

describe('currentStateLines', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ban masih berlaku', () => {
    expect(currentStateLines(record(), { banned: true, timeoutUntil: null })).toEqual([
      '🔒 Masih diblokir dari server',
    ]);
  });

  it('ban sudah tidak berlaku', () => {
    expect(currentStateLines(record(), { banned: false, timeoutUntil: null })).toEqual([
      '✅ Sudah tidak diblokir dari server',
    ]);
  });

  it('status ban yang tidak bisa diperiksa ditandai berbeda dari "sudah tidak diblokir"', () => {
    expect(currentStateLines(record(), null)).toEqual(['⚪ Status blokir tidak bisa diperiksa']);
    expect(currentStateLines(record(), { banned: null, timeoutUntil: null })).toEqual([
      '⚪ Status blokir tidak bisa diperiksa',
    ]);
  });

  it('timeout yang masih berjalan menampilkan sisa waktunya', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T12:00:00.000Z'));

    const until = new Date('2026-10-02T13:00:00.000Z');
    const lines = currentStateLines(record({ type: 'timeout' }), {
      banned: null,
      timeoutUntil: until,
    });

    expect(lines[0]).toContain('Masih timeout sampai');
    expect(lines[0]).toContain(`<t:${Math.floor(until.getTime() / 1_000)}:R>`);
  });

  it('timeout yang sudah lewat dianggap selesai', () => {
    const lines = currentStateLines(record({ type: 'timeout' }), {
      banned: null,
      timeoutUntil: new Date('2026-10-01T00:00:00.000Z'),
    });

    expect(lines).toEqual(['✅ Sudah tidak timeout']);
  });

  it('tidak ada baris untuk aksi yang tidak bisa dibatalkan', () => {
    for (const type of ['kick', 'warn', 'note', 'unban', 'lock', 'slowmode'] as ModerationAction[]) {
      expect(currentStateLines(record({ type }), { banned: true, timeoutUntil: null })).toEqual([]);
    }
  });
});

describe('caseReasonText & caseHistoryLine', () => {
  it('alasan kosong ditandai eksplisit', () => {
    expect(caseReasonText(record({ reason: null }))).toBe('*tidak disebutkan*');
    expect(caseReasonText(record({ reason: '   ' }))).toBe('*tidak disebutkan*');
  });

  it('alasan dipotong ke batas embed', () => {
    expect(caseReasonText(record({ reason: 'a'.repeat(2_000) })).length).toBe(1_000);
  });

  it('baris riwayat menyebut nomor kasus, aksi, waktu, dan moderator', () => {
    const line = caseHistoryLine(record({ caseNumber: 7, type: 'kick' }));

    expect(line).toContain('`7`');
    expect(line).toContain('Kick');
    expect(line).toContain(`<@${MOD_ID}>`);
    expect(line).toContain(`<t:${Math.floor(CREATED_AT.getTime() / 1_000)}:R>`);
  });

  it('kasus nonaktif ditandai di baris riwayat', () => {
    expect(caseHistoryLine(record({ active: false }))).toContain('nonaktif');
  });
});

describe('caseSummaryEmbed', () => {
  it('memuat detail kasus lengkap', () => {
    const json = caseSummaryEmbed(record()).toJSON();

    expect(json.title).toContain('#CASE-0142');
    expect(json.timestamp).toBe(CREATED_AT.toISOString());
    const rendered = JSON.stringify(json);
    expect(rendered).toContain(`<@${USER_ID}>`);
    expect(rendered).toContain(`<@${MOD_ID}>`);
    expect(rendered).toContain('Spam_links');
    expect(rendered).toContain('Kondisi sekarang');
  });

  it('target channel ditampilkan sebagai channel', () => {
    const json = caseSummaryEmbed(record({ type: 'lock', targetId: CHANNEL_ID })).toJSON();

    expect(JSON.stringify(json)).toContain(`<#${CHANNEL_ID}>`);
    expect(JSON.stringify(json)).not.toContain(`<@${CHANNEL_ID}>`);
  });

  it('tidak ada field kondisi untuk aksi yang tidak bisa dibatalkan', () => {
    const json = caseSummaryEmbed(record({ type: 'kick' })).toJSON();
    const names = (json.fields ?? []).map((field) => field.name);

    expect(names).not.toContain('Kondisi sekarang');
  });

  it('masa berlaku yang sudah lewat ditandai', () => {
    const json = caseSummaryEmbed(
      record({ type: 'timeout', expiresAt: new Date('2026-10-01T00:00:00.000Z') }),
    ).toJSON();
    const field = (json.fields ?? []).find((item) => item.name === 'Berakhir');

    expect(field?.value).toContain('sudah lewat');
  });

  it('masa berlaku yang masih jalan menampilkan waktu relatif', () => {
    const until = new Date('2026-10-09T12:00:00.000Z');
    const json = caseSummaryEmbed(record({ type: 'timeout', expiresAt: until })).toJSON();
    const field = (json.fields ?? []).find((item) => item.name === 'Berakhir');

    expect(field?.value).toContain(`<t:${Math.floor(until.getTime() / 1_000)}:R>`);
    expect(field?.value).not.toContain('sudah lewat');
  });
});

describe('caseHistoryEmbed', () => {
  it('kosong tetap punya kalimat yang jelas', () => {
    const json = caseHistoryEmbed(record(), [], 0).toJSON();

    expect(json.description).toContain('satu-satunya kasusnya');
  });

  it('menampilkan daftar kasus dan jumlahnya', () => {
    const history = [
      record({ caseNumber: 99, type: 'warn' }),
      record({ caseNumber: 100, type: 'kick', active: false }),
    ];

    const json = caseHistoryEmbed(record(), history, 9).toJSON();

    expect(json.description).toContain('`99`');
    expect(json.description).toContain('`100`');
    expect(json.description).toContain('+7 kasus lain');
    expect(json.footer?.text).toBe('9 kasus lain tercatat untuk target ini');
  });
});
