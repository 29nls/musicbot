import type { LoggingRepository } from './repository.js';
import type { LogCategory, LogSubscription } from './types.js';
import { assertCategory, assertSnowflake } from './validation.js';

export interface LoggingServiceOptions {
  /** Umur cache (ms); 0 = cache dimatikan. */
  cacheTtlMs?: number;
}

interface CacheEntry {
  channels: Map<LogCategory, string>;
  expiresAt: number;
}

/**
 * Routing channel log per kategori.
 *
 * - Baca: cache in-memory (default 60 detik) karena setiap event Discord
 *   menanyakan routing ini.
 * - Tulis: simpan ke DB lalu buang cache — perubahan berlaku seketika.
 * - Tanpa baris = tidak ada channel khusus; pemanggil memakai `logChannelId`.
 */
export class LoggingService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;

  constructor(
    private readonly repository: LoggingRepository,
    options: LoggingServiceOptions = {},
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
  }

  async getSubscriptions(guildId: string): Promise<LogSubscription[]> {
    const channels = await this.getChannelMap(guildId);

    return [...channels.entries()].map(([category, channelId]) => ({
      guildId,
      category,
      channelId,
    }));
  }

  /** Channel khusus kategori ini; null = pakai channel log global. */
  async getChannel(guildId: string, category: LogCategory): Promise<string | null> {
    const channels = await this.getChannelMap(guildId);
    return channels.get(category) ?? null;
  }

  async setChannel(guildId: string, category: string, channelId: string): Promise<LogSubscription> {
    const validCategory = assertCategory(category);
    const validChannel = assertSnowflake(channelId, 'channel');

    await this.repository.save(guildId, validCategory, validChannel);
    this.invalidate(guildId);

    return { guildId, category: validCategory, channelId: validChannel };
  }

  /** Hapus routing kategori → kembali memakai channel log global. */
  async clearChannel(guildId: string, category: string): Promise<void> {
    await this.repository.remove(guildId, assertCategory(category));
    this.invalidate(guildId);
  }

  invalidate(guildId?: string): void {
    if (guildId) this.cache.delete(guildId);
    else this.cache.clear();
  }

  private async getChannelMap(guildId: string): Promise<Map<LogCategory, string>> {
    const cached = this.readCache(guildId);
    if (cached) return cached;

    const subscriptions = await this.repository.list(guildId);
    const map = new Map(subscriptions.map((item) => [item.category, item.channelId] as const));
    this.writeCache(guildId, map);

    return map;
  }

  private readCache(guildId: string): Map<LogCategory, string> | undefined {
    if (this.cacheTtlMs <= 0) return undefined;

    const entry = this.cache.get(guildId);
    if (!entry) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(guildId);
      return undefined;
    }

    return entry.channels;
  }

  private writeCache(guildId: string, channels: Map<LogCategory, string>): void {
    if (this.cacheTtlMs <= 0) return;
    this.cache.set(guildId, { channels, expiresAt: Date.now() + this.cacheTtlMs });
  }
}
