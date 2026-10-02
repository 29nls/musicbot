import { describe, expect, it } from 'vitest';
import { toDomain, toLogRecord, type LogEntryRow } from '../src/modules/logging/mapping.js';

describe('toDomain', () => {
  it('memetakan baris subscription', () => {
    const subscription = toDomain({
      guildId: '123456789012345678',
      category: 'voice',
      channelId: '111111111111111111',
    });

    expect(subscription).toEqual({
      guildId: '123456789012345678',
      category: 'voice',
      channelId: '111111111111111111',
    });
  });

  it('mengabaikan kategori yang tidak dikenal (data lama)', () => {
    expect(
      toDomain({
        guildId: '123456789012345678',
        category: 'kategori-lama',
        channelId: '111111111111111111',
      }),
    ).toBeNull();
  });
});

const ROW: LogEntryRow = {
  id: 12,
  guildId: '123456789012345678',
  category: 'message',
  eventKey: 'messageDelete',
  title: '🗑️ Pesan Dihapus',
  summary: 'Channel: <#111>',
  executorId: null,
  targetId: '222222222222222222',
  channelId: '111111111111111111',
  logChannelId: '444444444444444444',
  logMessageId: '555555555555555555',
  caseId: null,
  createdAt: new Date('2026-10-02T08:00:00.000Z'),
};

describe('toLogRecord', () => {
  it('memetakan baris riwayat log', () => {
    expect(toLogRecord(ROW)).toEqual({
      id: 12,
      guildId: '123456789012345678',
      category: 'message',
      eventKey: 'messageDelete',
      title: '🗑️ Pesan Dihapus',
      summary: 'Channel: <#111>',
      executorId: null,
      targetId: '222222222222222222',
      channelId: '111111111111111111',
      logChannelId: '444444444444444444',
      logMessageId: '555555555555555555',
      caseId: null,
      createdAt: new Date('2026-10-02T08:00:00.000Z'),
    });
  });

  it('membawa nomor kasus untuk entri dari perintah moderasi', () => {
    const record = toLogRecord({ ...ROW, caseId: '142' });

    expect(record?.caseId).toBe('142');
  });

  it('membuang baris dengan kategori tak dikenal', () => {
    expect(toLogRecord({ ...ROW, category: 'kategori-lama' })).toBeNull();
  });

  it('membuang baris dengan tanggal rusak', () => {
    expect(toLogRecord({ ...ROW, createdAt: new Date('bukan tanggal') })).toBeNull();
  });
});
