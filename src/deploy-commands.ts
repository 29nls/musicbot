import { Collection, REST, Routes } from 'discord.js';
import { getEnv } from './config/env.js';
import { loadCommands } from './handlers/commandHandler.js';
import { getLogger } from './services/logger.js';
import type { BotCommand } from './types/command.js';

const env = getEnv();
const logger = getLogger();

const commands = new Collection<string, BotCommand>();
await loadCommands(commands);

const body = [...commands.values()].map((command) => command.data.toJSON());
const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);

if (env.DEV_GUILD_ID) {
  await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DEV_GUILD_ID), { body });
  logger.info(
    { jumlah: body.length, guild: env.DEV_GUILD_ID },
    'Perintah didaftarkan ke guild dev — langsung tersedia',
  );
  logger.warn('Perintah global lama (kalau ada) tetap tampil. Hapus lewat Developer Portal → Integrations.');
} else {
  await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body });
  logger.info({ jumlah: body.length }, 'Perintah didaftarkan global — butuh ±1 jam untuk muncul');
}
