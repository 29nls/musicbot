import { PrismaLoggingRepository } from '../logging/repository.js';
import { PrismaModerationRepository } from '../moderation/repository.js';
import { PrismaPlaylistRepository } from '../playlists/repository.js';
import { PrismaTicketRepository } from '../tickets/repository.js';
import { getPrisma } from '../../services/database.js';
import { PrivacyService } from './service.js';

let service: PrivacyService | undefined;

/**
 * Service privasi (lazy, satu instance per proses bot).
 *
 * Repository-nya diambil dari `getPrisma()` yang sama dengan modul lain, jadi
 * tidak ada koneksi kedua ke database.
 */
export function getPrivacyService(): PrivacyService {
  if (!service) {
    const prisma = getPrisma();
    service = new PrivacyService({
      moderation: new PrismaModerationRepository(prisma),
      tickets: new PrismaTicketRepository(prisma),
      logging: new PrismaLoggingRepository(prisma),
      playlists: new PrismaPlaylistRepository(prisma),
    });
  }

  return service;
}

export { PrivacyService } from './service.js';
export type { PrivacyRepositories } from './service.js';
export {
  PSEUDONYM_MAX_LENGTH,
  REASON_ANONYMIZED_MARKER,
  SUBJECT_ANONYMIZED_MARKER,
  emptyAnonymizeOutcome,
  pseudonymFor,
} from './anonymize.js';
export type { AnonymizeOutcome } from './anonymize.js';
export {
  buildInventory,
  emptyInventory,
  inventoryActionLine,
  inventoryRows,
  inventoryTouchedCount,
} from './inventory.js';
export type { DataInventory, InventoryRow } from './inventory.js';
export { MODERATION_RETENTION_YEARS, RETENTION_STATEMENTS } from './retention.js';
export type { RetentionStatement } from './retention.js';
export {
  dataDeleteConfirmEmbed,
  dataDeleteEmbed,
  dataDeleteLogEmbed,
  dataDeleteLogLine,
  privacyEmbed,
} from './embeds.js';
