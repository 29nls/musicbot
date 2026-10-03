import { getLogger } from '../../services/logger.js';
import type { CustomCommandRepository } from './repository.js';
import {
  GUILD_CACHE_LIMIT,
  GUILD_CACHE_TTL_MS,
  CUSTOM_COMMAND_LIST_LIMIT,
  type CreateCustomCommandInput,
  type CustomCommand,
  type DeleteCustomCommandResult,
  type EditCustomCommandResult,
  type SaveCustomCommandResult,
} from './types.js';
import { nameKey, parseResponse, parseTriggerName } from './validation.js';

/**
 * Berapa perintah yang boleh disimpan di cache satu server.
 * Di luar ini, server dengan ribuan perintah tidak ikut menahan memori.
 */
const MAX_CACHED_COMMANDS = 200;

interface GuildCache {
  commands: Map<string, CustomCommand>;
  expiresAt: number;
}

export interface CustomCommandServiceOptions {
  now?: () => number;
  cacheTtlMs?: number;
  cacheLimit?: number;
}

export interface SaveOptions {
  /** Nama lain yang tidak boleh dipakai — perintah slash yang sedang aktif. */
  reserved?: readonly string[];
}

/**
 * Custom command: lookup, CRUD, dan cache per server.
 *
 * Cache-nya ada karena pemicu datang dari **setiap pesan di server**: tanpa
 * cache, satu `!perintah` berarti satu query, dan server dengan satu-dua
 * perintah tetap membayar query itu berulang. Tulisannya (create/edit/delete)
 * selalu membaca langsung ke database dan langsung membuang cache supaya admin
 * yang baru saja mengubah perintah tidak harus menunggu 60 detik untuk melihat
 * hasilnya.
 */
export class CustomCommandService {
  private readonly caches = new Map<string, GuildCache>();
  private readonly now: () => number;
  private readonly cacheTtlMs: number;
  private readonly cacheLimit: number;

  constructor(
    private readonly repository: CustomCommandRepository,
    options: CustomCommandServiceOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.cacheTtlMs = options.cacheTtlMs ?? GUILD_CACHE_TTL_MS;
    this.cacheLimit = options.cacheLimit ?? GUILD_CACHE_LIMIT;
  }

  /** Daftar perintah server ini (langsung dari database, bukan cache). */
  async list(guildId: string): Promise<CustomCommand[]> {
    return this.repository.list(guildId, CUSTOM_COMMAND_LIST_LIMIT);
  }

  /**
   * Cari perintah per nama untuk dipanggil member.
   *
   * Nama yang tidak ada **tidak** membocorkan apa pun: bot diam, persis seperti
   * kalau pemicunya memang bukan perintah custom.
   */
  async find(guildId: string, rawName: string): Promise<CustomCommand | null> {
    const name = nameKey(rawName);
    if (name.length === 0) return null;

    const cache = this.readCache(guildId);
    if (cache) return cache.commands.get(name) ?? null;

    const commands = await this.repository.list(guildId, MAX_CACHED_COMMANDS);
    const byName = new Map<string, CustomCommand>();

    for (const command of commands) {
      byName.set(nameKey(command.name), command);
    }

    this.writeCache(guildId, byName);

    return byName.get(name) ?? null;
  }

  /** Buat perintah baru, atau ganti balasan kalau namanya sudah dipakai. */
  async create(
    input: CreateCustomCommandInput,
    options: SaveOptions = {},
  ): Promise<SaveCustomCommandResult> {
    const name = parseTriggerName(input.name, { reserved: options.reserved });
    const response = parseResponse(input.response);
    const now = new Date(this.now());

    const existing = await this.repository.findByName(input.guildId, name);

    if (existing) {
      const updated = await this.repository.updateResponse(existing.id, response, now);
      this.invalidate(input.guildId);

      if (!updated) {
        // Barisnya hilang di antara find dan update (admin lain menghapus
        // perintah yang sama). Buat ulang supaya perintah yang diminta admin
        // benar-benar ada setelah perintah ini selesai.
        const created = await this.repository.create(
          { ...input, name, response },
          now,
        );
        this.invalidate(input.guildId);
        return { kind: 'created', command: created };
      }

      return { kind: 'replaced', command: updated };
    }

    const command = await this.repository.create({ ...input, name, response }, now);
    this.invalidate(input.guildId);

    return { kind: 'created', command };
  }

  /** Ganti isi balasan perintah yang sudah ada. */
  async edit(guildId: string, rawName: string, rawResponse: string): Promise<EditCustomCommandResult> {
    const name = parseTriggerName(rawName);
    const response = parseResponse(rawResponse);

    const existing = await this.repository.findByName(guildId, name);
    if (!existing) return { kind: 'not-found' };

    const updated = await this.repository.updateResponse(existing.id, response, new Date(this.now()));
    this.invalidate(guildId);

    return updated ? { kind: 'updated', command: updated } : { kind: 'not-found' };
  }

  /** Hapus perintah; balasan "tidak ada" kalau memang tidak ada. */
  async remove(guildId: string, rawName: string): Promise<DeleteCustomCommandResult> {
    const name = parseTriggerName(rawName);

    const removed = await this.repository.deleteByName(guildId, name);
    this.invalidate(guildId);

    return removed ? { kind: 'deleted', command: removed } : { kind: 'not-found' };
  }

  /** Buang cache satu server, atau semuanya kalau guildId tidak diisi. */
  invalidate(guildId?: string): void {
    if (guildId === undefined) {
      this.caches.clear();
      return;
    }

    this.caches.delete(guildId);
  }

  /** Berapa server yang sedang menyimpan cache (dipakai tes & diagnostik). */
  get cachedGuilds(): number {
    return this.caches.size;
  }

  private readCache(guildId: string): GuildCache | null {
    const cache = this.caches.get(guildId);
    if (!cache) return null;

    if (cache.expiresAt <= this.now()) {
      this.caches.delete(guildId);
      return null;
    }

    return cache;
  }

  private writeCache(guildId: string, commands: Map<string, CustomCommand>): void {
    if (this.caches.size >= this.cacheLimit) {
      const oldest = this.caches.keys().next();
      if (!oldest.done) this.caches.delete(oldest.value);
    }

    // Sisip ulang supaya urutan Map selalu menunjukkan umur cache.
    this.caches.delete(guildId);
    this.caches.set(guildId, { commands, expiresAt: this.now() + this.cacheTtlMs });

    getLogger().debug({ guild: guildId, total: commands.size }, 'Cache perintah custom diperbarui');
  }
}