import { Events } from 'discord.js';
import type { BotClient } from '../client.js';
import { getLogger } from '../services/logger.js';

export default {
  name: Events.Error,
  execute(_client: BotClient, error: Error): void {
    getLogger().error({ err: error }, 'Error dari Discord client');
  },
};
