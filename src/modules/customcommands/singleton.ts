import { getPrisma } from '../../services/database.js';
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
  // Store tidak diteruskan, supaya `CustomCommandService` mengambilnya saat
  // dipakai. Service ini dibangun lazily dan bisa lebih dulu dari store kunci-
  // nilai proses, jadi meneruskan store di sini menangkap store memori bawaan.
  service ??= new CustomCommandService(new PrismaCustomCommandRepository(getPrisma()));

  return service;
}

/** Buang service beserta cache-nya (dipakai saat bot berhenti). */
export function resetCustomCommandService(): void {
  void service?.invalidate();
  service = undefined;
}