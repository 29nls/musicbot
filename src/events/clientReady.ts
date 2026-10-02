import { ActivityType, Events, type Client } from 'discord.js';
import type { BotClient } from '../client.js';
import { BOT_NAME } from '../config/constants.js';
import { getLogger } from '../services/logger.js';

export default {
  name: Events.ClientReady,
  once: true,
  execute(client: BotClient): void {
    const logger = getLogger();
    const user: Client['user'] = client.user;
    if (!user) return;

    user.setPresence({
      status: 'online',
      activities: [{ name: '/help • musik & admin', type: ActivityType.Listening }],
    });

    logger.info(
      {
        tag: user.tag,
        id: user.id,
        server: client.guilds.cache.size,
        perintah: client.commands.size,
      },
      `✅ ${BOT_NAME} siap menerima perintah`,
    );
  },
};
