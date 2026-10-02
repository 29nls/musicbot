import { describe, expect, it } from 'vitest';
import { logEntriesEmbed, logRecordSummary } from '../src/modules/logging/embeds.js';
import { buildLogEntryWhere, prioritizeCaseLogs } from '../src/modules/logging/searchQuery.js';
import type { LogRecord, LogSearchFilter } from '../src/modules/logging/types.js';

const GUILD_ID = '123456789012345678';
const USER_ID = '222222222222222222';
const CASE_NUMBER = 142;

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

function record(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    id: 1,
    guildId: GUILD_ID,
    category: 'member',
    eventKey: 'guildMemberRemove',
    title: '📤 Member Keluar',
    summary: '',
    executorId: '444444444444444444',
    targetId: USER_ID,
    channelId: null,
    logChannelId: '555555555555555555',
    logMessageId: '666666666666666666',
    caseId: null,
    createdAt: new Date('2026-10-02T12:00:00.000Z'),
    ...overrides,
  };
}

describe('buildLogEntryWhere dengan targetId', () => {
  it('filter targetId hanya menyentuh sisi target', () => {
    expect(buildLogEntryWhere(filter({ targetId: USER_ID }))).toEqual({
      guildId: GUILD_ID,
      AND: [{ targetId: USER_ID }],
    });
  });

  it('bisa digabung dengan filter executor (AND)', () => {
    const where = buildLogEntryWhere(filter({ targetId: USER_ID, categories: ['member'] }));

    expect(where.AND).toEqual([{ category: { in: ['member'] } }, { targetId: USER_ID }]);
  });

  it('tidak ada filter targetId saat kosong', () => {
    expect(buildLogEntryWhere(filter({ targetId: null }))).toEqual({ guildId: GUILD_ID });
  });
});

describe('prioritizeCaseLogs', () => {
  it('entri tertaut ke kasus naik ke atas', () => {
    const older = record({ id: 1, caseId: null, createdAt: new Date('2026-10-02T11:00:00.000Z') });
    const linked = record({ id: 2, caseId: String(CASE_NUMBER), createdAt: new Date('2026-10-02T12:00:00.000Z') });
    const newer = record({ id: 3, caseId: null, createdAt: new Date('2026-10-02T13:00:00.000Z') });

    const ordered = prioritizeCaseLogs([newer, older, linked], CASE_NUMBER);

    expect(ordered.map((item) => item.id)).toEqual([2, 3, 1]);
  });

  it('di antara entri tertaut, yang terbaru lebih dulu', () => {
    const first = record({ id: 1, caseId: String(CASE_NUMBER), createdAt: new Date('2026-10-02T12:00:00.000Z') });
    const second = record({ id: 2, caseId: String(CASE_NUMBER), createdAt: new Date('2026-10-02T13:00:00.000Z') });

    expect(prioritizeCaseLogs([first, second], CASE_NUMBER).map((item) => item.id)).toEqual([2, 1]);
  });

  it('entri dari kasus lain tetap ikut, tidak dibuang', () => {
    const other = record({ id: 1, caseId: '99' });

    expect(prioritizeCaseLogs([other], CASE_NUMBER).map((item) => item.id)).toEqual([1]);
  });

  it('tidak mengubah array asal', () => {
    const rows = [record({ id: 1, caseId: null }), record({ id: 2, caseId: String(CASE_NUMBER) })];

    prioritizeCaseLogs(rows, CASE_NUMBER);

    expect(rows.map((item) => item.id)).toEqual([1, 2]);
  });
});

describe('logRecordSummary', () => {
  it('menyertakan waktu, event, target, moderator, dan tautan lompat', () => {
    const summary = logRecordSummary(record(), GUILD_ID);
    const rendered = summary.lines.join('\n');

    expect(summary.title).toBe('👤 📤 Member Keluar');
    expect(rendered).toContain('<t:1790942400:f>');
    expect(rendered).toContain('`guildMemberRemove`');
    expect(rendered).toContain(`<@${USER_ID}>`);
    expect(rendered).toContain(`<@444444444444444444>`);
    expect(rendered).toContain(
      `[Lompat ke pesan log](https://discord.com/channels/${GUILD_ID}/555555555555555555/666666666666666666)`,
    );
  });

  it('menandai kasus yang tertaut', () => {
    const rendered = logRecordSummary(record({ caseId: String(CASE_NUMBER) }), GUILD_ID)
      .lines.join('\n');

    expect(rendered).toContain('#CASE-0142');
  });

  it('tanpa log message tetap valid tanpa tautan', () => {
    const rendered = logRecordSummary(
      record({ logChannelId: null, logMessageId: null }),
      GUILD_ID,
    ).lines.join('\n');

    expect(rendered).not.toContain('Lompat ke pesan log');
  });
});

describe('logEntriesEmbed', () => {
  it('menampilkan judul, isi, dan kaki sesuai opsi', () => {
    const json = logEntriesEmbed([record()], {
      title: '📎 Log terkait',
      guildId: GUILD_ID,
      total: 1,
      footer: 'Log sekitar ±1 jam',
    }).toJSON();

    expect(json.title).toBe('📎 Log terkait');
    expect(json.description).toContain('Member Keluar');
    expect(json.footer?.text).toBe('Log sekitar ±1 jam');
  });

  it('memberi tahu kalau ada entri yang tidak ditampilkan', () => {
    const json = logEntriesEmbed([record()], {
      title: '📎 Log terkait',
      guildId: GUILD_ID,
      total: 12,
    }).toJSON();

    expect(json.description).toContain('+11 entri lain tidak ditampilkan');
  });

  it('tanpa catatan tambahan kalau semua entri tampil', () => {
    const json = logEntriesEmbed([record()], {
      title: '📎 Log terkait',
      guildId: GUILD_ID,
      total: 1,
    }).toJSON();

    expect(json.description).not.toContain('entri lain');
  });

  it('daftar kosong tetap punya kalimat', () => {
    const json = logEntriesEmbed([], { title: '📎 Log terkait', guildId: GUILD_ID, total: 0 })
      .toJSON();

    expect(json.description).toBe('Tidak ada entri log yang tercatat.');
  });
});
