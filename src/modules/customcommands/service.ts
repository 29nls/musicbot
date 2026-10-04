import { getLogger } from '../../services/logger.js';
import { getKeyValueStore, type KeyValueStore } from '../../services/kvStore.js';
import { decodeCommandCache, encodeCommandCache } from './cacheCodec.js';
import type { CustomCommandRepository } from './repository.js';
import {
  CUSTOM_COMMAND_LIST_LIMIT,
  GUILD_CACHE_TTL_MS,
  type CreateCustomCommandInput,
  type CustomCommand,
  type DeleteCustomCommandResult,
  type EditCustomCommandResult,
  type SaveCustomCommandResult,
} from './types.js';
import { nameKey, parseResponse, parseTriggerName } from './validation.js';

/** Berapa perintah yang boleh masuk cache satu server. */
const MAX_CACHED_COMMANDS = 200;

const CACHE_PREFIX = 'harmony:customcommands:';

/**
 * Batas key yang dicatat proses ini untuk keperluan "buang semua".
 *
 * Store bersama tidak menyediakan "hapus semua key dengan awalan tertentu", jadi
 * proses menyimpan daftar key yang pernah ia tulis sendiri. Daftar ini dibatasi
 * supaya bot yang berdiri lama di banyak server tidak tumbuh terus; key yang
 * keluar dari daftar hanya berarti barisnya tidak dihapus saat invalidate-all, dan
 * TTL di sisi store sudah mengurusnya sendiri.
 */
const TRACKED_KEYS_LIMIT = 500;

export interface CustomCommandServiceOptions {
  now?: () => number;
  cacheTtlMs?: number;
  /** Store bersama; default-nya store proses (Redis atau memori). */
  store?: KeyValueStore;
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
 *
 * Cache-nya sekarang hidup di `KeyValueStore` (§9.4), jadi ikut berlaku lintas
 * proses kalau Redis hidup: perintah yang baru dibuat admin langsung terlihat
 * di proses lain tanpa menunggu TTL habis.
 *
 * **Semua kegagalan store tidak boleh menjatuhkan fitur.** Kalau Redis sedang
 * mati, `find()` tetap menjawab dari database — cache hanya penghematan query,
 * bukan sumber kebenaran.
 */
export class CustomCommandService {
  private readonly trackedKeys = new Set<string>();
  private readonly now: () => number;
  private readonly cacheTtlMs: number;
  private readonly store: KeyValueStore;

  constructor(
    private readonly repository: CustomCommandRepository,
    options: CustomCommandServiceOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.cacheTtlMs = options.cacheTtlMs ?? GUILD_CACHE_TTL_MS;
    this.store = options.store ?? getKeyValueStore();
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

    const cached = await this.readCache(guildId);
    if (cached) return byName(cached).get(name) ?? null;

    const commands = await this.repository.list(guildId, MAX_CACHED_COMMANDS);
    await this.writeCache(guildId, commands);

    return byName(commands).get(name) ?? null;
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
      await this.invalidate(input.guildId);

      if (!updated) {
        // Barisnya hilang di antara find dan update (admin lain menghapus
        // perintah yang sama). Buat ulang supaya perintah yang diminta admin
        // benar-benar ada setelah perintah ini selesai.
        const created = await this.repository.create({ ...input, name, response }, now);
        await this.invalidate(input.guildId);
        return { kind: 'created', command: created };
      }

      return { kind: 'replaced', command: updated };
    }

    const command = await this.repository.create({ ...input, name, response }, now);
    await this.invalidate(input.guildId);

    return { kind: 'created', command };
  }

  /** Ganti isi balasan perintah yang sudah ada. */
  async edit(guildId: string, rawName: string, rawResponse: string): Promise<EditCustomCommandResult> {
    const name = parseTriggerName(rawName);
    const response = parseResponse(rawResponse);

    const existing = await this.repository.findByName(guildId, name);
    if (!existing) return { kind: 'not-found' };

    const updated = await this.repository.updateResponse(
      existing.id,
      response,
      new Date(this.now()),
    );
    await this.invalidate(guildId);

    return updated ? { kind: 'updated', command: updated } : { kind: 'not-found' };
  }

  /** Hapus perintah; balasan "tidak ada" kalau memang tidak ada. */
  async remove(guildId: string, rawName: string): Promise<DeleteCustomCommandResult> {
    const name = parseTriggerName(rawName);

    const removed = await this.repository.deleteByName(guildId, name);
    await this.invalidate(guildId);

    return removed ? { kind: 'deleted', command: removed } : { kind: 'not-found' };
  }

  /**
   * Buang cache satu server, atau semua yang dicatat proses ini.
   *
   * Tidak pernah melempar: invalidate gagal berarti satu query tambahan,
   * sedangkan melempar dari sini akan menggagalkan penulisan yang sebenarnya
   * sudah berhasil di database.
   */
  async invalidate(guildId?: string): Promise<void> {
    const keys = guildId === undefined ? [...this.trackedKeys] : [cacheKey(guildId)];

    for (const key of keys) {
      try {
        await this.store.delete(key);
        this.trackedKeys.delete(key);
      } catch (error) {
        getLogger().warn({ err: error, key }, 'Gagal membuang cache perintah custom');
      }
    }
  }

  /** Berapa server yang key cache-nya pernah dicatat proses ini. */
  get cachedGuilds(): number {
    return this.trackedKeys.size;
  }

  /**
   * Baca cache satu server.
   *
   * `null` berarti "tidak ada cache yang bisa dipakai": key hilang, JSON rusak,
   * atau store sedang bermasalah. Ketiganya sama-sama berakhir dengan satu
   * query ke database, jadi tidak perlu dibedakan di pemanggil.
   */
  private async readCache(guildId: string): Promise<CustomCommand[] | null> {
    try {
      const raw = await this.store.get(cacheKey(guildId));

      const decoded = decodeCommandCache(raw);

      // Daftar kosong berarti cache tidak pernah diisi (atau isinya rusak),
      // jadi pemanggil harus membaca database.
      return decoded.length > 0 ? decoded : null;
    } catch (error) {
      getLogger().warn({ err: error, guildId }, 'Gagal membaca cache perintah custom');
      return null;
    }
  }

  private async writeCache(guildId: string, commands: readonly CustomCommand[]): Promise<void> {
    const key = cacheKey(guildId);

    try {
      await this.store.set(key, encodeCommandCache(commands), { ttlMs: this.cacheTtlMs });
      this.track(key);
      getLogger().debug({ guildId, total: commands.length }, 'Cache perintah custom diperbarui');
    } catch (error) {
      // Cache gagal ditulis hanya berarti satu query lagi di pemanggilan
      // berikutnya; kegagalan itu tidak boleh membuat `!perintah` gagal.
      getLogger().warn({ err: error, guildId }, 'Gagal menyimpan cache perintah custom');
    }
  }

  private track(key: string): void {
    if (this.trackedKeys.has(key)) return;

    if (this.trackedKeys.size >= TRACKED_KEYS_LIMIT) {
      const oldest = this.trackedKeys.values().next();
      if (!oldest.done) this.trackedKeys.delete(oldest.value);
    }

    this.trackedKeys.add(key);
  }
}

/** Index daftar perintah berdasarkan nama pemicu yang sudah dibersihkan. */
function byName(commands: readonly CustomCommand[]): Map<string, CustomCommand> {
  const index = new Map<string, CustomCommand>();

  for (const command of commands) {
    index.set(nameKey(command.name), command);
  }

  return index;
}

function cacheKey(guildId: string): string {
  return `${CACHE_PREFIX}${guildId}`;
}