import { Events } from 'discord.js';
import type { BotClient } from '../client.js';
import { getLogger } from './../modules/logger/index.js';

export default {
  name: Events.Warn,
  execute(_client: BotClient, message: string): void {
    getLogger().warn({ message }, 'Peringatan dari Discord client');
  },
};
