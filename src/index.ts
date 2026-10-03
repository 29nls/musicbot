import { BotClient } from './client.js';
import { EnvError, getEnv } from './config/env.js';
import { loadCommands } from './handlers/commandHandler.js';
import { loadEvents } from './handlers/eventHandler.js';
import { startHealthServer, type HealthServerHandle } from './modules/health/index.js';
import { getMusicService, initMusic, isMusicConnected } from './modules/music/index.js';
import { clearCaseLinks } from './modules/moderation/index.js';
import { connectDatabase, disconnectDatabase, pingDatabase } from './services/database.js';
import { getLogger } from './services/logger.js';
import { createKeyValueStore, type KeyValueStoreHandle } from './services/kvStore.js';
import { setCooldownStore } from './utils/cooldown.js';
import { startPanelExpiryJob, type PanelExpiryJob } from './services/panelExpiryJob.js';
import { startRetentionJob, type RetentionJob } from './services/retentionJob.js';
import { startStayJob, type StayJob } from './services/stayJob.js';
import {
  getMetricsRegistry,
  initMetrics,
  startMetricsProbe,
  type MetricsProbe,
} from './modules/metrics/index.js';
import { getStatsService } from './modules/stats/index.js';
import { describeStartupFailure } from './utils/startupFailure.js';

// Disimpan di scope modul supaya bisa ditutup dengan bersih saat startup gagal.
let client: BotClient | undefined;
let retentionJob: RetentionJob | undefined;
let panelExpiryJob: PanelExpiryJob | undefined;
let stayJob: StayJob | undefined;
let metricsProbe: MetricsProbe | undefined;
let healthServer: HealthServerHandle | null = null;
let keyValueStore: KeyValueStoreHandle | undefined;

/** Kapan proses ini start — dipakai health check untuk menghitung uptime. */
const startedAt = Date.now();

async function main(): Promise<void> {
  // Validasi config lebih dulu: gagal cepat kalau .env belum lengkap.
  const env = getEnv();
  const logger = getLogger();

  client = new BotClient();

  await loadCommands(client.commands);
  await loadEvents(client);

  // Wajib sebelum login: shoukaku memasang listener `clientReady` untuk
  // mendaftarkan node Lavalink, dan listener itu hanya terpasang sekali.
  initMusic(client);

  registerProcessHandlers(client);

  // Store kunci-nilai (Redis kalau bisa dihubungi, memori kalau tidak). Rate
  // limit lewat sini supaya berlaku lintas proses; kegagalan Redis sengaja
  // tidak menghentikan bot, hanya menulis peringatan di log.
  keyValueStore = await createKeyValueStore();
  setCooldownStore(keyValueStore.store);

  // Metrik proses (PRD §11): satu registry dipakai seluruh proses supaya
  // angka di /metrics sama dengan yang terlihat di log.
  initMetrics(startedAt);

  // Database: bot tetap dijalankan walau DB mati (perintah seperti /ping tidak
  // butuh DB), tapi perintah yang butuh konfigurasi akan gagal dengan pesan jelas.
  await connectDatabase();

  // Retensi data (kasus & peringatan > 12 bulan) berjalan di dalam proses:
  // ikut berhenti saat bot berhenti, tanpa cron di host.
  retentionJob = startRetentionJob(undefined, { statsRunner: getStatsService() });

  // Endpoint health check (PRD §5.1). Dijalankan sebelum login supaya
  // monitoring bisa melihat "proses hidup, gateway belum siap" selama bot
  // masih handshake.
  healthServer = startHealthServer({
    port: env.HEALTH_PORT,
    // HEALTH_PORT=0 = matikan endpoint, bukan "pakai port acak".
    enabled: env.HEALTH_PORT > 0,
    startedAt,
    gatewayReady: () => client?.isReady() ?? false,
    lavalinkConnected: () => isMusicConnected(),
    guildCount: () => client?.guilds.cache.size ?? 0,
    pingDatabase: () => pingDatabase(),
    metrics: () => getMetricsRegistry().snapshot(),
  });

  logger.info(
    { node: process.version, lavalink: `${env.LAVALINK_HOST}:${env.LAVALINK_PORT}` },
    'Menghubungkan ke Discord…',
  );

  await client.login(env.DISCORD_TOKEN);

  // Baru setelah login: job ini mengubah pesan Discord, jadi butuh guild yang
  // sudah ada di cache. Dijalankan setelah login supaya sapuan pertamanya tidak
  // dilewati begitu saja.
  panelExpiryJob = startPanelExpiryJob({
    guilds: () => [...(client?.guilds.cache.values() ?? [])],
  });

  // Mode 24/7 (PRD 5.2): menyambungkan bot ke voice channel, jadi juga
  // butuh shard yang siap. Karena itu baru dijalankan setelah login.
  stayJob = startStayJob({
    guilds: () => [...(client?.guilds.cache.values() ?? [])],
  });

  // Probe latensi Lavalink (PRD §11): satu permintaan murah tiap 30 detik ke
  // /stats node, tanpa menyentuh player. Dijalankan setelah login supaya
  // engine musik sudah ada saat probe pertama.
  metricsProbe = startMetricsProbe({
    measure: () => getMusicService().measureLavalinkLatency(),
    onSample: (latencyMs) => {
      const metrics = getMetricsRegistry();
      if (latencyMs === null) metrics.recordLavalinkUnreachable();
      else metrics.recordLavalinkLatency(latencyMs);
    },
  });
}

function registerProcessHandlers(bot: BotClient): void {
  const logger = getLogger();
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'Sinyal berhenti diterima, menutup koneksi…');

    // Tautan kasus berumur pendek dan tidak perlu bertahan melewati restart.
    clearCaseLinks();
    retentionJob?.stop();
    panelExpiryJob?.stop();
    stayJob?.stop();
    metricsProbe?.stop();

    // Jaring pengaman kalau destroy() menggantung (mis. socket tidak menutup).
    const forceExit = setTimeout(() => process.exit(1), 10_000);
    forceExit.unref();

    void Promise.allSettled([
      healthServer?.close() ?? Promise.resolve(),
      keyValueStore?.store.close() ?? Promise.resolve(),
      disconnectDatabase(),
      stopMusic(),
      bot.destroy(),
    ]).then(() => {
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

/** Tutup mesin musik tanpa membuat proses gagal kalau Lavalink sudah mati. */
async function stopMusic(): Promise<void> {
  try {
    await getMusicService().shutdown();
  } catch {
    // Belum sempat diinisialisasi atau sudah ditutup — tidak perlu dilaporkan.
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof EnvError) {
    console.error(`\n✖ ${error.message}\n`);
  } else {
    console.error(`\n✖ Bot gagal dijalankan:\n${describeStartupFailure(error)}\n`);
  }

  // Tutup koneksi lebih dulu supaya proses keluar rapi: memanggil process.exit()
  // saat socket masih aktif memicu assertion libuv di Windows.
  await Promise.allSettled([disconnectDatabase(), stopMusic(), client?.destroy() ?? Promise.resolve()]);
  process.exitCode = 1;

  // Watchdog: kalau ada handle yang tidak menutup, jangan menggantung selamanya.
  const watchdog = setTimeout(() => process.exit(1), 5_000);
  watchdog.unref();
}
