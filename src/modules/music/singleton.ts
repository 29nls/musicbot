import type { Client } from 'discord.js';
import { getEnv } from '../../config/env.js';
import { processInstanceId } from '../../services/instanceId.js';
import { getLogger } from '../../services/logger.js';
import { getGuildConfigService } from '../config/index.js';
import { getMetricsRegistry } from '../metrics/index.js';
import { getStatsService } from '../stats/index.js';
import { MusicService } from './musicService.js';
import { lavalinkNodeName, parseLavalinkNodes } from './nodes.js';
import { PlayerOwnership } from './ownership.js';
import { getKeyValueStore } from '../../services/kvStore.js';
import { SearchSessionStore } from './searchSession.js';
import { StayService } from './stayService.js';

/**
 * Batas minimum durasi dengar sebelum lagu dihitung.
 *
 * Tanpa ini, satu `/play` lalu `/skip` langsung sudah menghasilkan satu
 * "tidak pernah didengarkan", dan leaderboard bisa dimanipulasi tanpa
 * ada yang benar-benar mendengarkannya.
 */
const MIN_LISTENED_MS = 10_000;

let service: MusicService | undefined;
let searchSessions: SearchSessionStore | undefined;
let stayService: StayService | undefined;

/**
 * Siapkan mesin musik. **Harus dipanggil sebelum `client.login()`** karena
 * shoukaku memasang listener `clientReady` untuk mendaftarkan node Lavalink.
 */
export function initMusic(client: Client): MusicService {
  if (service) return service;

  const env = getEnv();
  const nodeList = parseLavalinkNodes(env.LAVALINK_NODES, {
    host: env.LAVALINK_HOST,
    port: env.LAVALINK_PORT,
  });

  // Entri yang dibuang disebut apa adanya: operator yang salah ketik harus
  // tahu node mana yang tidak terpakai, bukan hanya melihat playback turun.
  if (nodeList.skipped.length > 0) {
    getLogger().warn(
      { skipped: nodeList.skipped, nodes: nodeList.nodes.length },
      'Entri LAVALINK_NODES tidak bisa dipakai dan dilewati',
    );
  }

  service = new MusicService(client, {
    nodes: nodeList.nodes.map((node) => ({
      host: node.host,
      port: node.port,
      password: env.LAVALINK_PASSWORD,
      name: lavalinkNodeName(node),
    })),
    maxQueueSize: env.MAX_QUEUE_SIZE,
    // Kepemilikan player di store bersama. Store-nya diambil lewat fungsi, bukan
    // objek, karena modul musik dibangun sebelum store kunci-nilai selesai
    // dibuat — kalau objeknya yang diambil, yang tertangkap adalah store memori
    // bawaan dan lease ownership tidak pernah keluar dari satu proses.
    // Kalau store-nya tidak bisa menegakkan satu pemilik (Redis mati),
    // `PlayerOwnership.available` false dan MusicService tidak memblokir apa pun.
    ownership: new PlayerOwnership(() => getKeyValueStore(), processInstanceId()),
    getConfig: (guildId) => getGuildConfigService().get(guildId),
    // Statistik playback (Fase 3, §5.3). Modul musik tidak tahu soal database,
    // jadi hanya menerima callback: statistik boleh gagal tanpa playback ikut gagal.
    onTrackFinished: (event) => {
      // Metrik "lagu diputar" (§11) dihitung tanpa aturan 10 detik: lagu yang
      // baru berbunyi 2 detik tetap satu lagu yang diputar. Aturan 10 detik
      // hanya berlaku untuk statistik per-server, yang soal kegunaan.
      getMetricsRegistry().recordTrackPlayed();

      if (event.listenedMs < MIN_LISTENED_MS) return;

      void getStatsService().recordTrack({
        guildId: event.guildId,
        title: event.title,
        uri: event.uri,
        listenedMs: event.listenedMs,
      });
    },
  });

  return service;
}

/** Mesin musik yang sudah diinisialisasi (melempar kalau lupa `initMusic`). */
export function getMusicService(): MusicService {
  if (!service) {
    throw new Error('MusicService belum diinisialisasi — panggil initMusic(client) saat startup.');
  }

  return service;
}

/** true kalau ada node Lavalink yang siap (dipakai untuk pesan error yang jelas). */
export function isMusicConnected(): boolean {
  return service?.isConnected ?? false;
}

/**
 * Session pencarian `/search` untuk proses ini.
 *
 * Dibuat malas: store bersama baru siap setelah `createKeyValueStore()` di
 * startup, dan perintah musik lain tidak boleh ikut bergantung padanya.
 */
export function getSearchSessionStore(): SearchSessionStore {
  searchSessions ??= new SearchSessionStore();
  return searchSessions;
}

/**
 * Layanan mode 24/7 untuk proses ini.
 *
 * Dibuat malas supaya perintah musik biasa (`/play`, `/queue`) tidak ikut bergantung padanya,
 * dan supaya `StayService` bisa dipakai di tes tanpa harus membuat
 * `MusicService` (bot) sungguhan.
 */
export function getStayService(): StayService {
  stayService ??= new StayService({
    music: getMusicService(),
    getConfig: (guildId) => getGuildConfigService().get(guildId),
  });

  return stayService;
}

/** Bersihkan state musik saat bot berhenti (dipakai saat shutdown). */
export function resetMusicSingletons(): void {
  service = undefined;
  stayService = undefined;
  // Di-lewat supaya shutdown tidak menunggu satu putaran Redis per session.
  void searchSessions?.clear();
  searchSessions = undefined;
}