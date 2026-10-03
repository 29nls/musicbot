import { getPrisma } from '../../services/database.js';
import { getKeyValueStore } from '../../services/kvStore.js';
import { PrismaCustomCommandRepository } from './repository.js';
import { CustomCommandService } from './service.js';

let service: CustomCommandService | undefined;

/**
 * Service custom command (lazy, satu instance per proses bot).
 *
 * Cache daftar perintah per server **ikut shared antar proses** lewat
 * `KeyValueStore` (§9.4): kalau Redis hidup, perintah yang baru dibuat admin
 * langsung terlihat di proses lain tanpa menunggu TTL 60 detik habis.
 */
export function getCustomCommandService(): CustomCommandService {
  service ??= new CustomCommandService(new PrismaCustomCommandRepository(getPrisma()), {
    store: getKeyValueStore(),
  });

  return service;
}

/** Buang service beserta cache-nya (dipakai saat bot berhenti). */
export function resetCustomCommandService(): void {
  void service?.invalidate();
  service = undefined;
}