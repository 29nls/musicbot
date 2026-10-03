import { getPrisma } from '../../services/database.js';
import { PrismaCustomCommandRepository } from './repository.js';
import { CustomCommandService } from './service.js';

let service: CustomCommandService | undefined;

/**
 * Service custom command (lazy, satu instance per proses bot).
 *
 * Cache daftar perintah per server ikut hidup di service ini — sama seperti
 * antrean musik, jadi ia **tidak shared antar proses**. Konsekuensinya
 * (perintah baru bisa terlambat sebentar di guild yang cache-nya belum
 * kedaluwarsa) ditulis di README, bukan disembunyikan.
 */
export function getCustomCommandService(): CustomCommandService {
  service ??= new CustomCommandService(new PrismaCustomCommandRepository(getPrisma()));

  return service;
}

/** Buang service beserta cache-nya (dipakai saat bot berhenti). */
export function resetCustomCommandService(): void {
  service?.invalidate();
  service = undefined;
}