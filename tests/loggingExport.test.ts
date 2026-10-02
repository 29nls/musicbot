import { describe, expect, it } from 'vitest';
import {
  EXPORT_MAX_ROWS,
  buildLogExport,
  describeExportCategories,
  logExportFilename,
  recordsToCsv,
  recordsToJson,
} from '../src/modules/logging/export.js';
import type { LogRecord, LogSearchFilter } from '../src/modules/logging/types.js';

const GUILD_ID = '123456789012345678';
// Waktu tetap dalam UTC supaya ekspektasi tes tidak bergantung zona waktu mesin.
const GENERATED_AT = new Date('2026-10-02T14:05:00.000Z');

function filter(overrides: Partial<LogSearchFilter> = {}): LogSearchFilter {
  return {
    guildId: GUILD_ID,
    categories: ['member'],
    caseNumber: null,
    userId: '222222222222222222',
    channelId: null,
    keyword: null,
    from: new Date('2026-09-01T00:00:00.000Z'),
    to: null,
    page: 1,
    pageSize: EXPORT_MAX_ROWS,
    ...overrides,
  };
}

function record(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    id: 1,
    guildId: GUILD_ID,
    category: 'member',
    eventKey: 'guildBanAdd',
    title: '🔨 Member Ban',
    summary: 'Alasan: spam',
    executorId: '333333333333333333',
    targetId: '222222222222222222',
    channelId: null,
    logChannelId: '444444444444444444',
    logMessageId: '555555555555555555',
    caseId: '142',
    createdAt: new Date('2026-10-01T08:30:00.000Z'),
    ...overrides,
  };
}

describe('logExportFilename', () => {
  it('memakai pola yang urut dan ekstensi sesuai format', () => {
    expect(logExportFilename(GUILD_ID, 'csv', GENERATED_AT)).toBe(
      `harmony-logs-${GUILD_ID}-20261002-1405.csv`,
    );
    expect(logExportFilename(GUILD_ID, 'json', GENERATED_AT).endsWith('.json')).toBe(true);
  });

  it('menyatoshi nama file yang sama untuk waktu yang sama', () => {
    const first = logExportFilename(GUILD_ID, 'json', GENERATED_AT);
    const second = logExportFilename(GUILD_ID, 'json', new Date(GENERATED_AT));

    expect(first).toBe(second);
  });
});

describe('recordsToJson', () => {
  it('menyimpan metadata arsip beserta filter asal', () => {
    const payload = JSON.parse(
      recordsToJson(
        {
          format: 'json',
          records: [record()],
          guildId: GUILD_ID,
          guildName: 'Server Uji',
          total: 1,
          filter: filter(),
        },
        GENERATED_AT,
      ),
    ) as Record<string, unknown>;

    expect(payload.generatedAt).toBe('2026-10-02T14:05:00.000Z');
    expect(payload.guild).toEqual({ id: GUILD_ID, name: 'Server Uji' });
    expect(payload.total).toBe(1);
    expect(payload.exported).toBe(1);
    expect(payload.truncated).toBe(false);
    expect(payload.filter).toMatchObject({
      categories: ['member'],
      userId: '222222222222222222',
      from: '2026-09-01T00:00:00.000Z',
      to: null,
    });
  });

  it('memuat setiap entri dengan nomor kasusnya', () => {
    const payload = JSON.parse(
      recordsToJson(
        {
          format: 'json',
          records: [record()],
          guildId: GUILD_ID,
          total: 1,
          filter: filter(),
        },
        GENERATED_AT,
      ),
    ) as { entries: Record<string, unknown>[] };

    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0]).toMatchObject({
      timestamp: '2026-10-01T08:30:00.000Z',
      category: 'member',
      eventKey: 'guildBanAdd',
      caseId: '142',
      executorId: '333333333333333333',
    });
  });

  it('nama guild boleh kosong', () => {
    const payload = JSON.parse(
      recordsToJson(
        { format: 'json', records: [], guildId: GUILD_ID, total: 0, filter: filter() },
        GENERATED_AT,
      ),
    ) as { guild: { name: string | null } };

    expect(payload.guild.name).toBeNull();
  });
});

describe('recordsToCsv', () => {
  it('menulis header walau tidak ada baris', () => {
    expect(recordsToCsv([])).toBe(
      'timestamp,category,event_key,title,case_id,executor_id,target_id,channel_id,log_channel_id,log_message_id,summary\n',
    );
  });

  it('mengisi kolom kosong sebagai sel kosong, bukan "null"', () => {
    const line = recordsToCsv([record({ caseId: null, channelId: null })]).split('\n')[1] ?? '';

    // case_id kosong: tepat satu koma ganda di sebelah title.
    expect(line).toContain('🔨 Member Ban,,333333333333333333');
    // channel_id kosong: tepat satu koma ganda di sebelah target.
    expect(line).toContain('222222222222222222,,444444444444444444');
    expect(line).not.toContain('null');
  });

  it('mengapit tanda koma dan kutip di dalam sel', () => {
    const line = recordsToCsv([record({ summary: 'katakan "halo", lalu' })]).split('\n')[1] ?? '';

    expect(line.endsWith('"katakan ""halo"", lalu"')).toBe(true);
  });

  it('mengapit baris baru di dalam sel', () => {
    const csv = recordsToCsv([record({ summary: 'baris satu\nbaris dua' })]);

    expect(csv).toContain('"baris satu\nbaris dua"');
    // Record-nya membungkus newline, jadi file punya 4 baris fisik:
    // header, dua potongan sel, lalu baris kosong dari newline penutup.
    const lines = csv.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe('');
    expect(lines[1]).toContain('"baris satu');
    // summary adalah kolom terakhir, jadi sel ditutup tanpa koma susulan.
    expect(lines[2]).toBe('baris dua"');
  });

  it('menjaga nilai yang diawali formula agar tidak dieksekusi spreadsheet', () => {
    const line = recordsToCsv([record({ summary: '=1+1' })]).split('\n')[1] ?? '';

    expect(line.endsWith("'=1+1")).toBe(true);
  });

  it('menjaga sel yang diawali tanda +, -, atau @', () => {
    for (const prefix of ['+1', '-2+3', '@SUM(A1)']) {
      const line = recordsToCsv([record({ summary: prefix })]).split('\n')[1] ?? '';
      expect(line.endsWith(`'${prefix}`)).toBe(true);
    }
  });

  it('membiarkan nilai biasa apa adanya', () => {
    const line = recordsToCsv([record({ summary: 'alasan biasa' })]).split('\n')[1] ?? '';

    expect(line.endsWith('alasan biasa')).toBe(true);
  });
});

describe('buildLogExport', () => {
  it('menandai hasil yang terpotong oleh batas baris', () => {
    const file = buildLogExport({
      format: 'csv',
      records: [record()],
      guildId: GUILD_ID,
      total: 12,
      filter: filter(),
      generatedAt: GENERATED_AT,
    });

    expect(file.truncated).toBe(true);
    expect(file.exported).toBe(1);
    expect(file.bytes).toBeGreaterThan(0);
    expect(file.filename.endsWith('.csv')).toBe(true);
  });

  it('tidak menandai terpotong saat hasil muat', () => {
    const file = buildLogExport({
      format: 'json',
      records: [record()],
      guildId: GUILD_ID,
      total: 1,
      filter: filter(),
      generatedAt: GENERATED_AT,
    });

    expect(file.truncated).toBe(false);
  });

  it('ukuran file dihitung dalam byte, bukan panjang karakter', () => {
    const file = buildLogExport({
      format: 'csv',
      records: [record({ summary: '😀' })],
      guildId: GUILD_ID,
      total: 1,
      filter: filter(),
      generatedAt: GENERATED_AT,
    });

    expect(file.bytes).toBeGreaterThan(file.content.length);
  });
});

describe('describeExportCategories', () => {
  it('menyebutkan label kategori', () => {
    expect(describeExportCategories(filter({ categories: ['member', 'voice'] }))).toBe(
      'Member, Voice',
    );
  });

  it('menyatakan semua kategori saat filter kosong', () => {
    expect(describeExportCategories(filter({ categories: [] }))).toBe('semua kategori');
  });
});
