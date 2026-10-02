import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BotClient } from '../client.js';
import { getLogger } from '../services/logger.js';
import type { BotEvent } from '../types/event.js';
import { importDefault, listModuleFiles } from '../utils/moduleLoader.js';

const EVENTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'events');

function isBotEvent(value: unknown): value is BotEvent {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Record<string, unknown>;
  return typeof candidate.execute === 'function' && typeof candidate.name === 'string';
}

/** Daftarkan semua file di src/events/ ke gateway Discord. */
export async function loadEvents(client: BotClient): Promise<void> {
  const logger = getLogger();
  const files = listModuleFiles(EVENTS_DIR);

  for (const file of files) {
    const event = await importDefault(file);

    if (!isBotEvent(event)) {
      throw new Error(`Modul event tidak valid (butuh default export { name, execute }): ${file}`);
    }

    // Handler dibungkus supaya error di satu event tidak mematikan proses.
    const listener = (...args: unknown[]): void => {
      const reportFailure = (error: unknown): void => {
        logger.error({ err: error, event: event.name }, 'Handler event gagal');
      };

      try {
        // Satu-satunya cast di loader: `name` bertipe union, sehingga TS tidak
        // bisa mencocokkan daftar argumen runtime dengan signature event-nya.
        // File event sendiri tetap ter-type penuh.
        const execute = event.execute as (client: BotClient, ...eventArgs: unknown[]) => unknown;
        const result = execute(client, ...args);
        if (result instanceof Promise) result.catch(reportFailure);
      } catch (error) {
        reportFailure(error);
      }
    };

    if (event.once) client.once(event.name, listener);
    else client.on(event.name, listener);

    logger.debug({ file, event: event.name, once: event.once ?? false }, 'Event terpasang');
  }

  logger.info({ total: files.length }, 'Semua event terpasang');
}
