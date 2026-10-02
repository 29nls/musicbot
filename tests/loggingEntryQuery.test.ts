import { describe, expect, it } from 'vitest';
import { buildLogEntryWhere } from '../src/modules/logging/searchQuery.js';
import type { LogSearchFilter } from '../src/modules/logging/types.js';

const GUILD_ID = '123456789012345678';
const USER_ID = '222222222222222222';
const CHANNEL_ID = '333333333333333333';

function filter(overrides: Partial<LogSearchFilter> = {}): LogSearchFilter {
  return {
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
    ...overrides,
  };
}

describe('buildLogEntryWhere', () => {
  it('tanpa filter hanya membatasi guild', () => {
    expect(buildLogEntryWhere(filter())).toEqual({ guildId: GUILD_ID });
  });

  it('kategori jadi operator in', () => {
    expect(buildLogEntryWhere(filter({ categories: ['member', 'voice'] }))).toEqual({
      guildId: GUILD_ID,
      AND: [{ category: { in: ['member', 'voice'] } }],
    });
  });

  it('satu filter user menutupi target dan executor', () => {
    expect(buildLogEntryWhere(filter({ userId: USER_ID }))).toEqual({
      guildId: GUILD_ID,
      AND: [{ OR: [{ targetId: USER_ID }, { executorId: USER_ID }] }],
    });
  });

  it('channel dicocokkan persis', () => {
    expect(buildLogEntryWhere(filter({ channelId: CHANNEL_ID }))).toEqual({
      guildId: GUILD_ID,
      AND: [{ channelId: CHANNEL_ID }],
    });
  });

  it('kata kunci mencari di title dan summary, mengabaikan huruf besar', () => {
    expect(buildLogEntryWhere(filter({ keyword: 'spam' }))).toEqual({
      guildId: GUILD_ID,
      AND: [
        {
          OR: [
            { title: { contains: 'spam', mode: 'insensitive' } },
            { summary: { contains: 'spam', mode: 'insensitive' } },
          ],
        },
      ],
    });
  });

  it('rentang tanggal memakai gte/lte dan boleh salah satu sisi', () => {
    const from = new Date(2026, 8, 1);
    const to = new Date(2026, 9, 1);

    expect(buildLogEntryWhere(filter({ from, to }))).toEqual({
      guildId: GUILD_ID,
      AND: [{ createdAt: { gte: from, lte: to } }],
    });

    expect(buildLogEntryWhere(filter({ from }))).toEqual({
      guildId: GUILD_ID,
      AND: [{ createdAt: { gte: from } }],
    });

    expect(buildLogEntryWhere(filter({ to }))).toEqual({
      guildId: GUILD_ID,
      AND: [{ createdAt: { lte: to } }],
    });
  });

  it('menggabungkan semua filter dengan AND', () => {
    const where = buildLogEntryWhere(
      filter({
        categories: ['message'],
        userId: USER_ID,
        channelId: CHANNEL_ID,
        keyword: 'halo',
        caseNumber: 142,
        from: new Date(2026, 8, 1),
      }),
    );

    expect(where).toEqual({
      guildId: GUILD_ID,
      AND: [
        { category: { in: ['message'] } },
        { OR: [{ targetId: USER_ID }, { executorId: USER_ID }] },
        { channelId: CHANNEL_ID },
        { caseId: '142' },
        {
          OR: [
            { title: { contains: 'halo', mode: 'insensitive' } },
            { summary: { contains: 'halo', mode: 'insensitive' } },
          ],
        },
        { createdAt: { gte: new Date(2026, 8, 1) } },
      ],
    });
  });

  it('nomor kasus disimpan polos tanpa tanda pagar', () => {
    expect(buildLogEntryWhere(filter({ caseNumber: 7 }))).toEqual({
      guildId: GUILD_ID,
      AND: [{ caseId: '7' }],
    });
  });
});
