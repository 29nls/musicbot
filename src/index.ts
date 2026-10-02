import { DiscordjsError, DiscordjsErrorCodes } from 'discord.js';
import { BotClient } from './client.js';
import { EnvError, getEnv } from './config/env.js';
import { loadCommands } from './handlers/commandHandler.js';
import { loadEvents } from './handlers/eventHandler.js';
import { getLogger } from './services/logger.js';

// Disimpan di scope modul supaya bisa ditutup dengan bersih saat startup gagal.
let client: BotClient | undefined;

async function main(): Promise<void> {
  // Validasi config lebih dulu: gagal cepat kalau .env belum lengkap.
  const env = getEnv();
  const logger = getLogger();

  client = new BotClient();

  await loadCommands(client.commands);
  await loadEvents(client);

  registerProcessHandlers(client);

  logger.info(
    { node: process.version, lavalink: `${env.LAVALINK_HOST}:${env.LAVALINK_PORT}` },
    'Menghubungkan ke Discord…',
  );

  await client.login(env.DISCORD_TOKEN);
}

function registerProcessHandlers(bot: BotClient): void {
  const logger = getLogger();
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'Sinyal berhenti diterima, menutup koneksi…');

    // Jaring pengaman kalau destroy() menggantung (mis. socket tidak menutup).
    const forceExit = setTimeout(() => process.exit(1), 10_000);
    forceExit.unref();

    void bot.destroy().then(() => {
      logger.info('Bot berhenti dengan bersih');
      process.exit(0);
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled rejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception — proses dihentikan');
    process.exit(1);
  });
}

/** Ubah error startup yang umum menjadi petunjuk yang bisa langsung ditindak. */
function describeFailure(error: unknown): string {
  if (error instanceof DiscordjsError) {
    switch (error.code) {
      case DiscordjsErrorCodes.TokenInvalid:
        return 'Token Discord tidak valid. Periksa DISCORD_TOKEN di .env (Developer Portal → Bot → Reset Token).';
      case DiscordjsErrorCodes.DisallowedIntents:
        return [
          'Bot memakai privileged intent yang belum diaktifkan.',
          'Developer Portal → Bot → Privileged Gateway Intents → aktifkan',
          '"Server Members Intent" dan "Message Content Intent".',
        ].join('\n');
      default:
        break;
    }
  }

  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

try {
  await main();
} catch (error) {
  if (error instanceof EnvError) {
    console.error(`\n✖ ${error.message}\n`);
  } else {
    console.error(`\n✖ Bot gagal dijalankan:\n${describeFailure(error)}\n`);
  }

  // Tutup koneksi gateway lebih dulu supaya proses keluar rapi: memanggil
  // process.exit() saat socket masih aktif memicu assertion libuv di Windows.
  await client?.destroy().catch(() => undefined);
  process.exitCode = 1;

  // Watchdog: kalau ada handle yang tidak menutup, jangan menggantung selamanya.
  const watchdog = setTimeout(() => process.exit(1), 5_000);
  watchdog.unref();
}
