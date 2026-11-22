import { getPrisma } from '../../services/database.js';
import { PrismaGiveawayRepository } from './repository.js';
import { GiveawayService } from './service.js';

let service: GiveawayService | undefined;

/** Service giveaway (lazy, satu instance per proses bot). */
export function getGiveawayService(): GiveawayService {
  if (!service) {
    service = new GiveawayService(new PrismaGiveawayRepository(getPrisma()));
  }

  return service;
}
