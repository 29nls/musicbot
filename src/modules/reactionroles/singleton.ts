import { getPrisma } from '../../services/database.js';
import { PrismaReactionRoleRepository } from './repository.js';
import { ReactionRoleService } from './service.js';

let service: ReactionRoleService | undefined;

/** Service reaction role (lazy, satu instance per proses bot). */
export function getReactionRoleService(): ReactionRoleService {
  if (!service) {
    service = new ReactionRoleService(new PrismaReactionRoleRepository(getPrisma()));
  }

  return service;
}