import { BotClient } from './client.js';
import { EnvError, getEnv } from './config/env.js';
import { assertShardingReady, parseShardList } from './config/sharding.js';
import { loadCommands } from './handlers/commandHandler.js';
import { loadEvents } from './handlers/eventHandler.js';
import { startHealthServer, type HealthServerHandle } from './modules/health/index.js';
import { getMusicService, initMusic, isMusicConnected } from './modules/music/index.js';
import { clearCaseLinks } from './modules/moderation/index.js';
import { connectDatabase, disconnectDatabase, pingDatabase } from './services/database.js';
import {
  createConfigChangedHandler,
  subscribeConfigChanged,
} from './modules/config/invalidation.js';
import { createServiceInvalidationTargets } from './modules/config/invalidationWiring.js';
import { getLogger } from './services/logger.js';
import { createKeyValueStore, getKeyValueStore, setKeyValueStore, type KeyValueStoreHandle } from './services/kvStore.js';
import { processInstanceId } from './services/instanceId.js';
import { SweepLease } from './services/sweepLease.js';
import { setCooldownStore } from './utils/cooldown.js';
import { startPanelExpiryJob, type PanelExpiryJob } from './services/panelExpiryJob.js';
import { startRetentionJob, type RetentionJob } from './services/retentionJob.js';
import { startStayJob, type StayJob } from './services/stayJob.js';
import {
  collectFleetMetrics,
  getMetricsRegistry,
  initMetrics,
  startFleetReporter,
  startMetricsProbe,
  type FleetReporter,
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
let fleetReporter: FleetReporter | undefined;
let healthServer: HealthServerHandle | null = null;
let keyValueStore: KeyValueStoreHandle | undefined;
/** Fungsi berhenti langganan invalidasi konfigurasi; null = store tanpa pub/sub. */
let configInvalidationStop: (() => Promise<void>) | null = null;

/** Kapan proses ini start — dipakai health check untuk menghitung uptime. */
const startedAt = Date.now();

/**
 * Umur lease job retensi.
 *
 * Sengaja jauh lebih pendek dari jeda sapuan (default 6 jam): lease ini bukan
 * cara membagi jadwal, melainkan cara mencegah dua proses mengerjakan
 * pekerjaan yang sama bersamaan. Kalau proses yang memegang lease mati di
 * tengah sapuan, proses lain mengambil alih dalam seperempat jam, bukan
 * menunggu jadwal berikutnya enam jam lagi.
 */
const RETENTION_LEASE_TTL_MS = 15 * 60_000;

async function main(): Promise<void> {
  // Validasi config lebih dulu: gagal cepat kalau .env belum lengkap.
  const env = getEnv();
  const logger = getLogger();

  // Store kunci-nilai (Redis kalau bisa dihubungi, memori kalau tidak)
  // dibangun DI AWAL, sebelum ada modul yang memakainya. Urutan ini bukan
  // detail: modul musik, cache perintah custom, dan lease kepemilikan player
  // mengambil store dari `getKeyValueStore()` saat dibangun. Kalau store dibuat
  // belakangan, semuanya menangkap store memori bawaan dan tetap jalan —
  // jadi bot terlihat memakai Redis padahal state-nya tidak pernah keluar dari
  // satu proses. Kegagalan Redis sendiri sengaja tidak menghentikan bot, hanya
  // menulis peringatan di log.
  keyValueStore = await createKeyValueStore();
  setKeyValueStore(keyValueStore);
  setCooldownStore(keyValueStore.store);

  // Invalidasi konfigurasi lintas proses (PRD-DASHBOARD D2): dashboard web
  // menulis langsung ke database, jadi proses bot ini harus diberi tahu kalau
  // baris guild berubah — kalau tidak, cache 60 detik membuat perubahan orang
  // terlihat seperti tidak tersimpan.
  //
  // Kegagalan berlangganan TIDAK menghentikan bot: `null` dari fungsi ini
  // berarti store memori (tidak ada kanal lintas proses), dan error dilewatkan
  // sebagai peringatan. Konsekuensinya harus jelas, jadi disebut di log:
  // perubahan dari dashboard baru berlaku setelah cache kedaluwarsa.
  try {
    configInvalidationStop = await subscribeConfigChanged(
      keyValueStore.store,
      createConfigChangedHandler(createServiceInvalidationTargets(), {
        onError: (target, error) =>
          logger.warn({ err: error, target }, 'Cache gagal dibuang setelah perubahan konfigurasi'),
        onIgnored: (raw) =>
          logger.warn({ panjang: raw.length }, 'Pesan invalidasi konfigurasi ditolak'),
      }),
    );
  } catch (error) {
    logger.warn(
      { err: error },
      'Langganan invalidasi konfigurasi gagal — perubahan dari dashboard baru berlaku setelah cache kedaluwarsa',
    );
  }

  if (configInvalidationStop) {
    logger.info('Langganan invalidasi konfigurasi aktif');
  }

  client = new BotClient();

  await loadCommands(client.commands);
  await loadEvents(client);

  // Wajib sebelum login: shoukaku memasang listener `clientReady` untuk
  // mendaftarkan node Lavalink, dan listener itu hanya terpasang sekali.
  initMusic(client);

  registerProcessHandlers(client);

  // Sharding tanpa store bersama berarti beberapa proses saling menimpa state
  // yang seharusnya satu pemilik: rate limit, antrean, dan lease player.
  // Menolak start lebih jujur daripada menjalankan bot yang merusak state
  // diam-diam lalu melapor "antrean kosong" tanpa penjelasan.
  assertShardingReady({
    maxShards: env.DISCORD_MAX_SHARDS,
    shardList: parseShardList(env.DISCORD_SHARD_LIST, env.DISCORD_MAX_SHARDS),
    driver: keyValueStore.driver,
  });

  // Metrik proses (PRD §11): satu registry dipakai seluruh proses supaya
  // angka di /metrics sama dengan yang terlihat di log.
  initMetrics(startedAt);

  // Database: bot tetap dijalankan walau DB mati (perintah seperti /ping tidak
  // butuh DB), tapi perintah yang butuh konfigurasi akan gagal dengan pesan jelas.
  await connectDatabase();

  // Retensi data (kasus & peringatan > 12 bulan) berjalan di dalam proses:
  // ikut berhenti saat bot berhenti, tanpa cron di host.
  //
  // Penghapusannya bersifat global, jadi harus dikunci: tanpa lease, tiap
  // proses menjalankan sapuan yang sama bersamaan dan angkanya saling
  // bertentangan di log (PRD §5.3 dan §11).
  retentionJob = startRetentionJob(undefined, {
    statsRunner: getStatsService(),
    lease: new SweepLease(
      () => getKeyValueStore(),
      'retention',
      processInstanceId(),
      RETENTION_LEASE_TTL_MS,
    ),
  });

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
    // Agregat lintas shard (PRD §13): satu angka bot, bukan satu angka
    // shard. Store dibaca saat scrape, bukan saat start, supaya kalau Redis
    // belum siap endpoint tetap menjawab dengan seri prosesnya.
    fleetMetrics: () => collectFleetMetrics(getKeyValueStore()),
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

  // Pelapor metrik lintas shard: setiap proses menulis registry-nya ke store
  // bersama, dan /metrics menjumlahkan seluruh laporan jadi satu angka (PRD §13).
  //
  // Dijalankan sebelum login supaya laporan pertama sudah ada saat monitoring
  // mulai menarik angka; tidak butuh Discord maupun Lavalink yang sudah siap.
  fleetReporter = startFleetReporter({
    // Getter, bukan store yang diambil saat ini: store bersama baru siap
    // setelah createKeyValueStore() di atas, dan menangkapnya di sini
    // membuat laporan ditulis ke store memori lokal yang tidak pernah dibaca
    // shard lain.
    store: () => getKeyValueStore(),
    instanceId: processInstanceId(),
    snapshot: () => getMetricsRegistry().snapshot(),
    guildCount: () => client?.guilds.cache.size ?? 0,
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
    fleetReporter?.stop();

    // Jaring pengaman kalau destroy() menggantung (mis. socket tidak menutup).
    const forceExit = setTimeout(() => process.exit(1), 10_000);
    forceExit.unref();

    void Promise.allSettled([
      healthServer?.close() ?? Promise.resolve(),
      configInvalidationStop?.() ?? Promise.resolve(),
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
