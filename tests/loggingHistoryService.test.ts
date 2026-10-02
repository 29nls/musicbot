import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoggingRepository, NewLogEntry } from '../src/modules/logging/repository.js';
import { LoggingService } from '../src/modules/logging/service.js';
import type { LogStats } from '../src/modules/logging/stats.js';
import {
  LOG_CATEGORIES,
  type LogCategory,
  type LogRecord,
  type LogSearchFilter,
  type LogSearchResult,
  type LogSubscription,
} from '../src/modules/logging/types.js';

const GUILD_ID = '123456789012345678';
const USER_ID = '222222222222222222';
const CHANNEL_ID = '333333333333333333';

/** Statistik kosong — dipakai fake yang tidak menguji agregasi. */
function emptyStats(): LogStats {
  return {
    total: 0,
    categories: LOG_CATEGORIES.map((category) => ({ category, count: 0 })),
    topActions: [],
    topMembers: [],
  };
}

class FakeHistoryRepository implements LoggingRepository {
  public readonly inserted: NewLogEntry[] = [];
  public readonly attached: { id: number; messageId: string; logChannelId: string }[] = [];
  public searchFilter: LogSearchFilter | null = null;
  public statsFilter: LogSearchFilter | null = null;
  public failInsert = false;
  public failStats = false;
  public failAttach = false;
  public searchResult: LogSearchResult = { rows: [], total: 0 };

  async list(): Promise<LogSubscription[]> {
    return [];
  }
  async save(): Promise<void> {}
  async remove(): Promise<void> {}

  async insert(entry: NewLogEntry): Promise<number> {
    if (this.failInsert) throw new Error('koneksi database terputus');
    this.inserted.push(entry);
    return this.inserted.length;
  }

  async attachMessage(id: number, messageId: string, logChannelId: string): Promise<void> {
    if (this.failAttach) throw new Error('koneksi database terputus');
    this.attached.push({ id, messageId, logChannelId });
  }

  async search(filter: LogSearchFilter): Promise<LogSearchResult> {
    this.searchFilter = filter;
    return this.searchResult;
  }

  async stats(filter: LogSearchFilter): Promise<LogStats> {
    if (this.failStats) throw new Error('koneksi database terputus');
    this.statsFilter = filter;
    return emptyStats();
  }
}

function makeService(): { repository: FakeHistoryRepository; service: LoggingService } {
  const repository = new FakeHistoryRepository();
  return { repository, service: new LoggingService(repository) };
}

const NOW = new Date(2026, 9, 2, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LoggingService.record', () => {
  it('menulis entri dengan nilai yang sudah dibersihkan', async () => {
    const { repository, service } = makeService();

    const id = await service.record(GUILD_ID, {
      category: 'member',
      eventKey: 'guildBanAdd',
      title: '🔨 Member Ban',
      summary: 'Alasan:  spam  (link)',
      executorId: USER_ID,
      targetId: '444444444444444444',
      channelId: null,
      logChannelId: CHANNEL_ID,
    });

    expect(id).toBe(1);
    expect(repository.inserted).toHaveLength(1);

    const entry = repository.inserted[0];
    expect(entry).toBeDefined();
    expect(entry?.guildId).toBe(GUILD_ID);
    expect(entry?.category).toBe('member' satisfies LogCategory);
    expect(entry?.summary).toBe('Alasan: spam (link)');
    expect(entry?.executorId).toBe(USER_ID);
    expect(entry?.channelId).toBeNull();
    expect(entry?.logChannelId).toBe(CHANNEL_ID);
  });

  it('mengisi kolom kosong dengan null', async () => {
    const { repository, service } = makeService();

    await service.record(GUILD_ID, { category: 'server', eventKey: 'guildUpdate', title: 'x' });

    const entry = repository.inserted[0];
    expect(entry?.summary).toBe('');
    expect(entry?.executorId).toBeNull();
    expect(entry?.targetId).toBeNull();
    expect(entry?.channelId).toBeNull();
    expect(entry?.logChannelId).toBeNull();
  });

  it('menandai retensi 30 hari ke depan', async () => {
    const { repository, service } = makeService();

    await service.record(GUILD_ID, { category: 'voice', eventKey: 'voiceStateUpdate', title: 'x' });

    expect(repository.inserted[0]?.createdAt).toEqual(NOW);
    expect(repository.inserted[0]?.expiresAt).toEqual(new Date(NOW.getTime() + 30 * 86_400_000));
  });

  it('menyimpan nomor kasus polos untuk aksi dari perintah Harmony', async () => {
    const { repository, service } = makeService();

    await service.record(GUILD_ID, {
      category: 'member',
      eventKey: 'moderation.ban',
      title: '🔨 Kasus #CASE-0142 · Ban',
      caseNumber: 142,
    });

    expect(repository.inserted[0]?.caseId).toBe('142');
  });

  it('aksi di luar Harmony tidak punya nomor kasus', async () => {
    const { repository, service } = makeService();

    await service.record(GUILD_ID, {
      category: 'member',
      eventKey: 'guildBanAdd',
      title: '🔨 Member Ban',
      caseNumber: null,
    });

    expect(repository.inserted[0]?.caseId).toBeNull();
  });

  it('memotong judul, kunci event, dan ringkasan sesuai kolom database', async () => {
    const { repository, service } = makeService();

    await service.record(GUILD_ID, {
      category: 'message',
      eventKey: 'k'.repeat(80),
      title: 't'.repeat(400),
      summary: 's'.repeat(1_500),
    });

    const entry = repository.inserted[0];
    expect(entry?.eventKey).toHaveLength(50);
    expect(entry?.title).toHaveLength(200);
    expect(entry?.summary).toHaveLength(1_000);
  });

  it('best-effort: kegagalan insert ditelan dan dikembalikan null', async () => {
    const { repository, service } = makeService();
    repository.failInsert = true;

    await expect(
      service.record(GUILD_ID, { category: 'role', eventKey: 'guildRoleCreate', title: 'x' }),
    ).resolves.toBeNull();
  });
});

describe('LoggingService.attachMessage', () => {
  it('menyerap ID pesan ke entri yang sudah tersimpan', async () => {
    const { repository, service } = makeService();

    await service.attachMessage(7, '555555555555555555', CHANNEL_ID);

    expect(repository.attached).toEqual([
      { id: 7, messageId: '555555555555555555', logChannelId: CHANNEL_ID },
    ]);
  });

  it('best-effort: kegagalan tidak dilempar ke event handler', async () => {
    const { repository, service } = makeService();
    repository.failAttach = true;

    await expect(service.attachMessage(1, '2', CHANNEL_ID)).resolves.toBeUndefined();
  });
});

describe('LoggingService.search', () => {
  it('meneruskan filter dan mengembalikan hasil repository', async () => {
    const { repository, service } = makeService();
    const rows: LogRecord[] = [];
    repository.searchResult = { rows, total: 42 };

    const filter: LogSearchFilter = {
      guildId: GUILD_ID,
      categories: ['message'],
      caseNumber: null,
      userId: USER_ID,
      channelId: null,
      keyword: 'spam',
      from: new Date(2026, 8, 1),
      to: null,
      page: 2,
      pageSize: 10,
    };

    await expect(service.search(filter)).resolves.toEqual({ rows, total: 42 });
    expect(repository.searchFilter).toBe(filter);
  });
});

describe('LoggingService.stats', () => {
  it('meneruskan filter dan mengembalikan agregat repository', async () => {
    const { repository, service } = makeService();
    const filter: LogSearchFilter = {
      guildId: GUILD_ID,
      categories: ['member'],
      caseNumber: null,
      userId: null,
      channelId: null,
      keyword: null,
      from: new Date(2026, 8, 1),
      to: new Date(2026, 9, 2),
      page: 1,
      pageSize: 10,
    };

    await expect(service.stats(filter)).resolves.toEqual(emptyStats());
    expect(repository.statsFilter).toBe(filter);
  });

  it('melempar kegagalan database supaya user melihat pesan yang benar', async () => {
    const { repository, service } = makeService();
    repository.failStats = true;

    await expect(service.stats(makeStatsFilter())).rejects.toThrow('koneksi database terputus');
  });
});

function makeStatsFilter(): LogSearchFilter {
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
  };
}
