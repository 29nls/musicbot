import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Collection } from 'discord.js';
import { getLogger } from '../services/logger.js';
import type { BotCommand } from '../types/command.js';
import { importDefault, listModuleFiles } from '../utils/moduleLoader.js';

const COMMANDS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'commands');

function isBotCommand(value: unknown): value is BotCommand {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Record<string, unknown>;
  const data = candidate.data;

  return (
    typeof candidate.execute === 'function' &&
    typeof candidate.category === 'string' &&
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { toJSON?: unknown }).toJSON === 'function'
  );
}

/**
 * Muat semua perintah dari src/commands/**, lalu daftarkan ke collection
 * milik client berdasarkan nama slash command-nya.
 */
export async function loadCommands(commands: Collection<string, BotCommand>): Promise<void> {
  const logger = getLogger();
  const files = listModuleFiles(COMMANDS_DIR);

  for (const file of files) {
    const loaded = await importDefault(file);

    if (!isBotCommand(loaded)) {
      throw new Error(`Modul perintah tidak valid (butuh default export BotCommand): ${file}`);
    }

    const name = loaded.data.toJSON().name;
    if (commands.has(name)) {
      throw new Error(`Nama perintah duplikat "${name}" (${file})`);
    }

    commands.set(name, loaded);
    logger.debug({ file, name, category: loaded.category }, 'Perintah dimuat');
  }

  logger.info({ total: commands.size }, 'Semua perintah dimuat');
}
