import { describe, expect, it } from 'vitest';
import {
  LoggingValidationError,
  parseDateFilter,
  parseLogSearch,
} from '../src/modules/logging/validation.js';

const GUILD_ID = '123456789012345678';
const USER_ID = '222222222222222222';
const CHANNEL_ID = '333333333333333333';

// 2 Oktober 2026, 15:30 waktu lokal
const NOW = new Date(2026, 9, 2, 15, 30, 0);

describe('parseDateFilter', () => {
  it('menerima rentang relatif (m/h/d/w)', () => {
    expect(parseDateFilter('30m', 'from', { now: NOW })).toEqual(new Date(2026, 9, 2, 15, 0, 0));
    expect(parseDateFilter('6h', 'from', { now: NOW })).toEqual(new Date(2026, 9, 2, 9, 30, 0));
    expect(parseDateFilter('7d', 'from', { now: NOW })).toEqual(new Date(2026, 8, 25, 15, 30, 0));
    expect(parseDateFilter('2w', 'from', { now: NOW })).toEqual(new Date(2026, 8, 18, 15, 30, 0));
  });

  it('membaca kalender YYYY-MM-DD sebagai waktu lokal', () => {
    expect(parseDateFilter('2026-09-01', 'from', { now: NOW })).toEqual(
      new Date(2026, 8, 1, 0, 0, 0, 0),
    );
  });

  it('membaca kalender DD/MM/YYYY (format lokal)', () => {
    expect(parseDateFilter('01/09/2026', 'from', { now: NOW })).toEqual(
      new Date(2026, 8, 1, 0, 0, 0, 0),
    );
  });

  it('batas atas (`to`) mencakup seluruh hari itu', () => {
    expect(parseDateFilter('2026-10-02', 'to', { now: NOW, endOfDay: true })).toEqual(
      new Date(2026, 9, 2, 23, 59, 59, 999),
    );
  });

  it('menolak format asing dan tanggal yang tidak ada', () => {
    expect(() => parseDateFilter('besok', 'from', { now: NOW })).toThrow(LoggingValidationError);
    expect(() => parseDateFilter('31/02/2026', 'from', { now: NOW })).toThrow(
      LoggingValidationError,
    );
  });

  it('pesan error menyebut nama field dan contoh format', () => {
    expect(() => parseDateFilter('nanti', 'from', { now: NOW })).toThrow(/from/);
    expect(() => parseDateFilter('nanti', 'from', { now: NOW })).toThrow(/7d/);
  });
});

describe('parseLogSearch', () => {
  it('default: semua kategori, tanpa batas waktu, halaman 1', () => {
    const filter = parseLogSearch(GUILD_ID, {}, NOW);

    expect(filter).toEqual({
      guildId: GUILD_ID,
      categories: [],
      caseNumber: null,
      userId: null,
      channelId: null,
      keyword: null,
      from: null,
      to: null,
      page: 1,
      pageSize: 10,
    });
  });

  it('menerima beberapa kategori sekaligus lalu mendeduplikasi', () => {
    const filter = parseLogSearch(GUILD_ID, { category: 'member,message,member' }, NOW);

    expect(filter.categories).toEqual(['member', 'message']);
  });

  it('menolak kategori yang tidak dikenal', () => {
    expect(() => parseLogSearch(GUILD_ID, { category: 'member,ngawur' }, NOW)).toThrow(
      LoggingValidationError,
    );
  });

  it('menyimpan user & channel sebagai snowflake tervalidasi', () => {
    const filter = parseLogSearch(
      GUILD_ID,
      { userId: USER_ID, channelId: CHANNEL_ID, keyword: ' spam ' },
      NOW,
    );

    expect(filter.userId).toBe(USER_ID);
    expect(filter.channelId).toBe(CHANNEL_ID);
    expect(filter.keyword).toBe('spam');
  });

  it('menolak ID yang bukan snowflake', () => {
    expect(() => parseLogSearch(GUILD_ID, { userId: 'abc' }, NOW)).toThrow(/tidak valid/);
    expect(() => parseLogSearch(GUILD_ID, { channelId: '123' }, NOW)).toThrow(/channel/);
  });

  it('menolak kata kunci kepanjangan', () => {
    expect(() => parseLogSearch(GUILD_ID, { keyword: 'x'.repeat(101) }, NOW)).toThrow(
      /maks 100/,
    );
  });

  it('menolak rentang tanggal terbalik', () => {
    expect(() =>
      parseLogSearch(GUILD_ID, { from: '2026-10-02', to: '2026-10-01' }, NOW),
    ).toThrow(/terbalik/);
  });

  it('menerima rentang relatif yang wajar', () => {
    const filter = parseLogSearch(GUILD_ID, { from: '24h', to: '30m' }, NOW);

    expect(filter.from).toEqual(new Date(2026, 9, 1, 15, 30, 0));
    expect(filter.to).toEqual(new Date(2026, 9, 2, 15, 0, 0));
  });

  it('menerima nomor kasus dalam beberapa format', () => {
    expect(parseLogSearch(GUILD_ID, { caseNumber: '#CASE-0142' }, NOW).caseNumber).toBe(142);
    expect(parseLogSearch(GUILD_ID, { caseNumber: '0142' }, NOW).caseNumber).toBe(142);
    expect(parseLogSearch(GUILD_ID, { caseNumber: '7' }, NOW).caseNumber).toBe(7);
  });

  it('menolak nomor kasus yang bukan angka', () => {
    expect(() => parseLogSearch(GUILD_ID, { caseNumber: 'kasus-142' }, NOW)).toThrow(
      LoggingValidationError,
    );
  });

  it('membatasi nomor halaman', () => {
    expect(parseLogSearch(GUILD_ID, { page: 3 }, NOW).page).toBe(3);
    expect(() => parseLogSearch(GUILD_ID, { page: 0 }, NOW)).toThrow(LoggingValidationError);
    expect(() => parseLogSearch(GUILD_ID, { page: 1_001 }, NOW)).toThrow(/maksimal/);
  });

  it('string kosong dianggap filter tidak ada', () => {
    const filter = parseLogSearch(
      GUILD_ID,
      { category: '  ', userId: '', channelId: '', keyword: '  ', from: '', to: '' },
      NOW,
    );

    expect(filter.categories).toEqual([]);
    expect(filter.userId).toBeNull();
    expect(filter.keyword).toBeNull();
    expect(filter.from).toBeNull();
  });
});
