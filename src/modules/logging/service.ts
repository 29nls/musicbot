import { getLogger } from '../../services/logger.js';
import type { LoggingRepository } from './repository.js';
import { clampLogSummary } from './summary.js';
import {
  DEFAULT_LOG_RETENTION_DAYS,
  type LogCategory,
  type LogRecordInput,
  type LogSearchFilter,
  type LogSearchResult,
  type LogSubscription,
} from './types.js';
import { assertCategory, assertSnowflake } from './validation.js';

const RETENTION_MS = DEFAULT_LOG_RETENTION_DAYS * 86_400_000;
const MAX_EVENT_KEY_LENGTH = 50;
const MAX_TITLE_LENGTH = 200;

/** Nomor kasus disimpan polos (tanpa `#`) supaya mudah difilter & diindeks. */
function normalizeCaseId(caseNumber: number | null | undefined): string | null {
  if (caseNumber === null || caseNumber === undefined) return null;
  if (!Number.isInteger(caseNumber) || caseNumber < 1) return null;

  return String(caseNumber);
}

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

  /**
   * Simpan satu entri riwayat log (dasar `/logs`).
   *
   * Best-effort: pencatatan tidak boleh menggagalkan event Discord, jadi
   * kegagalan ditulis ke log bot dan diabaikan. Mengembalikan id baris supaya
   * pemanggil bisa menempelkan ID pesan log, atau null bila gagal disimpan.
   */
  async record(guildId: string, input: LogRecordInput): Promise<number | null> {
    try {
      return await this.repository.insert({
        guildId,
        category: input.category,
        eventKey: input.eventKey.slice(0, MAX_EVENT_KEY_LENGTH),
        title: input.title.slice(0, MAX_TITLE_LENGTH),
        summary: clampLogSummary(input.summary ?? ''),
        executorId: input.executorId ?? null,
        targetId: input.targetId ?? null,
        channelId: input.channelId ?? null,
        logChannelId: input.logChannelId ?? null,
        caseId: normalizeCaseId(input.caseNumber),
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + RETENTION_MS),
      });
    } catch (error) {
      getLogger().warn(
        { err: error, guildId, eventKey: input.eventKey },
        'Gagal menyimpan riwayat log — pengiriman log tetap dilanjutkan',
      );
      return null;
    }
  }

  /** Tempelkan ID pesan log agar `/logs` bisa memberi tautan lompat. */
  async attachMessage(entryId: number, messageId: string, logChannelId: string): Promise<void> {
    try {
      await this.repository.attachMessage(entryId, messageId, logChannelId);
    } catch (error) {
      getLogger().warn({ err: error, entryId }, 'Gagal menempelkan ID pesan log');
    }
  }

  /** Pencarian riwayat log. Sengaja melempar error agar user melihat pesan DB offline. */
  async search(filter: LogSearchFilter): Promise<LogSearchResult> {
    return this.repository.search(filter);
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
