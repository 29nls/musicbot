import { getPrisma } from '../../services/database.js';
import { PrismaPlaybackStatRepository } from './repository.js';
import { StatsService } from './service.js';

let service: StatsService | undefined;

/**
 * Service statistik (lazy, satu instance per proses bot).
 *
 * Lazy supaya modul lain yang cuma butuh modul murni (`day`, `aggregate`) tidak
 * ikut membangun koneksi Prisma.
 */
export function getStatsService(): StatsService {
  service ??= new StatsService(new PrismaPlaybackStatRepository(getPrisma()));

  return service;
}