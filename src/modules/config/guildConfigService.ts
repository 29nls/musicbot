import type { GuildConfigRepository } from './repository.js';
import {
  DEFAULT_IDLE_TIMEOUT_SEC,
  DEFAULT_MODULES,
  type GuildConfig,
  type GuildConfigPatch,
  type ModulesEnabled,
} from './types.js';
import { validatePatch } from './validation.js';

export interface GuildConfigDefaults {
  defaultVolume: number;
  idleTimeoutSec?: number;
  modules?: ModulesEnabled;
  locale?: string;
}

export interface GuildConfigServiceOptions {
  defaults: GuildConfigDefaults;
  /**
   * Umur cache (ms). Perubahan lewat `update()` langsung menulis ulang cache,
   * jadi TTL hanya memengaruhi perubahan yang datang dari proses lain.
   * 0 = cache dimatikan.
   */
  cacheTtlMs?: number;
}

interface CacheEntry {
  config: GuildConfig;
  expiresAt: number;
}

/**
 * Sumber kebenaran konfigurasi per server.
 *
 * - Baca: cache di memori (default 60 detik) supaya perintah tidak menabrak DB.
 * - Tulis: langsung ke database lalu cache diperbarui — berlaku tanpa restart.
 */
export class GuildConfigService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;
  private readonly defaults: Required<GuildConfigDefaults>;

  constructor(
    private readonly repository: GuildConfigRepository,
    options: GuildConfigServiceOptions,
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
    this.defaults = {
      defaultVolume: options.defaults.defaultVolume,
      idleTimeoutSec: options.defaults.idleTimeoutSec ?? DEFAULT_IDLE_TIMEOUT_SEC,
      modules: options.defaults.modules ?? DEFAULT_MODULES,
      locale: options.defaults.locale ?? 'id',
    };
  }

  /** Konfigurasi server; server yang belum pernah di-setup mendapat nilai default. */
  async get(guildId: string): Promise<GuildConfig> {
    const cached = this.readCache(guildId);
    if (cached) return cached;

    const stored = await this.repository.find(guildId);
    const config = stored ?? this.defaultsFor(guildId);
    this.writeCache(guildId, config);

    return config;
  }

  /**
   * Ubah sebagian konfigurasi. Field yang tidak dikirim tidak tersentuh,
   * dan bagian `modules` di-merge supaya tidak mematikan modul lain.
   */
  async update(guildId: string, patch: GuildConfigPatch): Promise<GuildConfig> {
    const { modules, ...rest } = validatePatch(patch);
    const current = await this.get(guildId);

    const next: GuildConfig = {
      ...current,
      ...rest,
      modules: { ...current.modules, ...(modules ?? {}) },
      guildId,
    };

    const saved = await this.repository.upsert(next);
    this.writeCache(guildId, saved);

    return saved;
  }

  /** Kembalikan server ke default dan hapus barisnya di database. */
  async reset(guildId: string): Promise<GuildConfig> {
    await this.repository.remove(guildId);

    const config = this.defaultsFor(guildId);
    this.writeCache(guildId, config);

    return config;
  }

  async isModuleEnabled(guildId: string, module: keyof ModulesEnabled): Promise<boolean> {
    const config = await this.get(guildId);
    return config.modules[module];
  }

  /** Buang cache satu server (atau seluruhnya) — dipakai setelah perubahan dari luar proses ini. */
  invalidate(guildId?: string): void {
    if (guildId) this.cache.delete(guildId);
    else this.cache.clear();
  }

  private defaultsFor(guildId: string): GuildConfig {
    return {
      guildId,
      logChannelId: null,
      welcomeChannelId: null,
      goodbyeChannelId: null,
      djRoleId: null,
      autoroleId: null,
      autoroleBotId: null,
      welcomeMessage: null,
      goodbyeMessage: null,
      defaultVolume: this.defaults.defaultVolume,
      idleTimeoutSec: this.defaults.idleTimeoutSec,
      ticketPanelChannelId: null,
      ticketCategoryId: null,
      ticketStaffRoleId: null,
      ticketPanelMessageId: null,
      stayChannelId: null,
      modules: { ...this.defaults.modules },
      locale: this.defaults.locale,
    };
  }

  private readCache(guildId: string): GuildConfig | undefined {
    if (this.cacheTtlMs <= 0) return undefined;

    const entry = this.cache.get(guildId);
    if (!entry) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(guildId);
      return undefined;
    }

    return entry.config;
  }

  private writeCache(guildId: string, config: GuildConfig): void {
    if (this.cacheTtlMs <= 0) return;
    this.cache.set(guildId, { config, expiresAt: Date.now() + this.cacheTtlMs });
  }
}
