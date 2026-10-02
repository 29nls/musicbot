import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoggingRepository } from '../src/modules/logging/repository.js';
import { LoggingService } from '../src/modules/logging/service.js';
import type { LogCategory, LogSubscription } from '../src/modules/logging/types.js';
import { LoggingValidationError } from '../src/modules/logging/validation.js';

const GUILD_ID = '123456789012345678';
const CHANNEL_ID = '111111111111111111';
const OTHER_CHANNEL_ID = '222222222222222222';

class FakeLoggingRepository implements LoggingRepository {
  public readonly rows = new Map<string, Map<LogCategory, string>>();
  public listCalls = 0;
  public saveCalls = 0;

  async list(guildId: string): Promise<LogSubscription[]> {
    this.listCalls += 1;
    return [...(this.rows.get(guildId)?.entries() ?? [])].map(([category, channelId]) => ({
      guildId,
      category,
      channelId,
    }));
  }

  async save(guildId: string, category: LogCategory, channelId: string): Promise<void> {
    this.saveCalls += 1;
    const map = this.rows.get(guildId) ?? new Map<LogCategory, string>();
    map.set(category, channelId);
    this.rows.set(guildId, map);
  }

  async remove(guildId: string, category: LogCategory): Promise<void> {
    this.rows.get(guildId)?.delete(category);
  }
}

function makeService(cacheTtlMs = 60_000): {
  repository: FakeLoggingRepository;
  service: LoggingService;
} {
  const repository = new FakeLoggingRepository();
  return { repository, service: new LoggingService(repository, { cacheTtlMs }) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('LoggingService', () => {
  it('mengembalikan null kalau kategori belum punya routing', async () => {
    const { service } = makeService();

    await expect(service.getChannel(GUILD_ID, 'member')).resolves.toBeNull();
  });

  it('set/get/clear routing per kategori', async () => {
    const { service } = makeService();

    await service.setChannel(GUILD_ID, 'message', CHANNEL_ID);
    await expect(service.getChannel(GUILD_ID, 'message')).resolves.toBe(CHANNEL_ID);
    await expect(service.getChannel(GUILD_ID, 'member')).resolves.toBeNull();

    await service.clearChannel(GUILD_ID, 'message');
    await expect(service.getChannel(GUILD_ID, 'message')).resolves.toBeNull();
  });

  it('daftar subscription lengkap', async () => {
    const { service } = makeService();

    await service.setChannel(GUILD_ID, 'member', CHANNEL_ID);
    await service.setChannel(GUILD_ID, 'voice', OTHER_CHANNEL_ID);

    const subscriptions = await service.getSubscriptions(GUILD_ID);

    expect(subscriptions).toHaveLength(2);
    expect(subscriptions).toEqual(
      expect.arrayContaining([
        { guildId: GUILD_ID, category: 'member', channelId: CHANNEL_ID },
        { guildId: GUILD_ID, category: 'voice', channelId: OTHER_CHANNEL_ID },
      ]),
    );
  });

  it('membaca database sekali selama cache berlaku dan langsung invalid setelah tulis', async () => {
    const { repository, service } = makeService();

    await service.getChannel(GUILD_ID, 'member');
    await service.getChannel(GUILD_ID, 'member');
    expect(repository.listCalls).toBe(1);

    await service.setChannel(GUILD_ID, 'member', CHANNEL_ID);
    await service.getChannel(GUILD_ID, 'member');
    expect(repository.listCalls).toBe(2);
  });

  it('cache kedaluwarsa setelah TTL', async () => {
    vi.useFakeTimers();

    const { repository, service } = makeService(1_000);

    await service.getChannel(GUILD_ID, 'member');
    vi.advanceTimersByTime(1_500);
    await service.getChannel(GUILD_ID, 'member');

    expect(repository.listCalls).toBe(2);
  });

  it('cache bisa dimatikan (TTL 0)', async () => {
    const { repository, service } = makeService(0);

    await service.getChannel(GUILD_ID, 'member');
    await service.getChannel(GUILD_ID, 'member');

    expect(repository.listCalls).toBe(2);
  });

  it('menolak kategori dan channel yang tidak valid', async () => {
    const { service } = makeService();

    await expect(service.setChannel(GUILD_ID, 'kategori-aneh', CHANNEL_ID)).rejects.toBeInstanceOf(
      LoggingValidationError,
    );
    await expect(service.setChannel(GUILD_ID, 'member', 'bukan-id')).rejects.toBeInstanceOf(
      LoggingValidationError,
    );
    await expect(service.clearChannel(GUILD_ID, 'kategori-aneh')).rejects.toBeInstanceOf(
      LoggingValidationError,
    );
  });
});
