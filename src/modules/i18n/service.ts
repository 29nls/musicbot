import { getLogger } from '../../services/logger.js';
import type { GuildConfig } from '../config/index.js';
import { DEFAULT_LOCALE, toLocale, type Locale } from './types.js';

/**
 * Menyimpan bahasa mana yang dipakai sebuah server.
 *
 * **Kenapa cache-nya ada.** Config satu server dibaca berkali-kali dalam satu
 * perintah — gate musik, render embed, pesan akhir — dan setiap pembacaan itu
 * query database. Bahasa biasanya tidak berubah di tengah satu perintah, jadi
 * satu pembacaan per server dalam rentang singkat cukup, dan
 * `/config set locale` langsung membuang cache-nya supaya admin melihat
 * perubahan pada perintah berikutnya, bukan setelah TTL habis.
 *
 * **Kegagalan tidak pernah menjatuhkan perintah.** Config yang tidak bisa dibaca
 * menghasilkan bahasa bawaan, bukan error: lebih baik membalas dalam bahasa
 * yang agak meleset daripada tidak membalas sama sekali.
 */

/** TTL cache; cukup untuk satu perintah, pendek supaya perubahannya terasa. */
export const DEFAULT_LOCALE_CACHE_TTL_MS = 30_000;

export interface LocaleServiceOptions {
  /** Baca konfigurasi server; default-nya memakai service config singleton. */
  getConfig: (guildId: string) => Promise<GuildConfig>;
  /** Masa berlaku cache; default `DEFAULT_LOCALE_CACHE_TTL_MS`. */
  ttlMs?: number;
  /** Jam; bisa disuntik saat tes. */
  now?: () => number;
}

interface CacheEntry {
  locale: Locale;
  expiresAt: number;
}

export class LocaleService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly options: LocaleServiceOptions) {
    this.ttlMs = options.ttlMs ?? DEFAULT_LOCALE_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /** Bahasa server ini; selalu locale yang sah, tidak pernah melempar. */
  async localeFor(guildId: string): Promise<Locale> {
    const cached = this.cache.get(guildId);
    if (cached && cached.expiresAt > this.now()) return cached.locale;

    try {
      const locale = toLocale((await this.options.getConfig(guildId)).locale);
      this.cache.set(guildId, { locale, expiresAt: this.now() + this.ttlMs });
      return locale;
    } catch (error) {
      getLogger().debug({ err: error, guildId }, 'Gagal membaca bahasa server — memakai bawaan');
      return DEFAULT_LOCALE;
    }
  }

  /** Buang cache satu server; dipanggil setelah `/config set locale`. */
  invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }

  /** Buang semua cache; untuk tes dan saat shutdown. */
  invalidateAll(): void {
    this.cache.clear();
  }
}