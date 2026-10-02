import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildLogExport } from '../src/modules/logging/export.js';
import { saveLogExport } from '../src/modules/logging/exportFile.js';
import type { LogRecord, LogSearchFilter } from '../src/modules/logging/types.js';

const GUILD_ID = '123456789012345678';
const GENERATED_AT = new Date('2026-10-02T14:05:00.000Z');

const FILTER: LogSearchFilter = {
  guildId: GUILD_ID,
  categories: ['member'],
  caseNumber: null,
  userId: null,
  channelId: null,
  keyword: null,
  from: null,
  to: null,
  page: 1,
  pageSize: 500,
};

const RECORD: LogRecord = {
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
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'harmony-export-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('saveLogExport', () => {
  it('menulis file dengan isi yang sama persis', async () => {
    const file = buildLogExport({
      format: 'csv',
      records: [RECORD],
      guildId: GUILD_ID,
      total: 1,
      filter: FILTER,
      generatedAt: GENERATED_AT,
    });

    const saved = await saveLogExport(file, dir);

    expect(saved).toBe(path.join(dir, file.filename));
    await expect(readFile(saved as string, 'utf8')).resolves.toBe(file.content);
  });

  it('membuat folder tujuan kalau belum ada', async () => {
    const nested = path.join(dir, 'arsip', '2026');
    const file = buildLogExport({
      format: 'json',
      records: [],
      guildId: GUILD_ID,
      total: 0,
      filter: FILTER,
      generatedAt: GENERATED_AT,
    });

    const saved = await saveLogExport(file, nested);

    expect(saved).not.toBeNull();
    await expect(readFile(saved as string, 'utf8')).resolves.toContain('"entries": []');
  });

  it('mengembalikan null tanpa melempar error kalau folder tidak bisa ditulis', async () => {
    // Parent-nya berupa file, jadi mkdir di dalamnya pasti gagal (ENOTDIR) —
    // ini yang terjadi saat folder arsip tidak bisa dibuat di disk.
    const blocker = path.join(dir, 'bukan-folder.txt');
    await writeFile(blocker, 'isi', 'utf8');
    const file = buildLogExport({
      format: 'csv',
      records: [RECORD],
      guildId: GUILD_ID,
      total: 1,
      filter: FILTER,
      generatedAt: GENERATED_AT,
    });

    await expect(saveLogExport(file, path.join(blocker, 'arsip'))).resolves.toBeNull();
  });
});
