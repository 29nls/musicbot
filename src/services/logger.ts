import { createRequire } from 'node:module';
import { pino, type Logger } from 'pino';
import { getEnv } from '../config/env.js';

let instance: Logger | undefined;

function prettyTransport(): { target: string; options: Record<string, unknown> } | undefined {
  try {
    createRequire(import.meta.url).resolve('pino-pretty');
  } catch {
    return undefined; // produksi: pino-pretty tidak diinstal, pakai JSON
  }
  return {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
  };
}

/** Logger tunggal (memoized) — semua modul memakai ini, bukan console.*. */
export function getLogger(): Logger {
  if (instance) return instance;

  const { NODE_ENV, LOG_LEVEL } = getEnv();
  const transport = NODE_ENV === 'production' ? undefined : prettyTransport();

  instance = pino({
    level: LOG_LEVEL,
    base: { service: 'harmony-bot' },
    ...(transport ? { transport } : {}),
  });

  return instance;
}
