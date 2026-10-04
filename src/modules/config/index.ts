import { getEnv } from '../../config/env.js';
import { getPrisma } from '../../services/database.js';
import { GuildConfigService } from './guildConfigService.js';
import { PrismaGuildConfigRepository } from './repository.js';

let service: GuildConfigService | undefined;

/** Service konfigurasi per-server (lazy, satu instance per proses bot). */
export function getGuildConfigService(): GuildConfigService {
  if (!service) {
    service = new GuildConfigService(new PrismaGuildConfigRepository(getPrisma()), {
      defaults: { defaultVolume: getEnv().DEFAULT_VOLUME },
    });
  }

  return service;
}

export { GuildConfigService } from './guildConfigService.js';
export type { GuildConfig, GuildConfigPatch, ModulesEnabled } from './types.js';
export { MODULE_LABELS } from './types.js';
export { moduleDescription, moduleLabel } from './labels.js';
export { renderConfigEmbed } from './embeds.js';
export { toConfigErrorEmbed } from './errors.js';
export { ConfigValidationError } from './validation.js';
