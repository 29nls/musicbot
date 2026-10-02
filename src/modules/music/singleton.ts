import type { Client } from 'discord.js';
import { getEnv } from '../../config/env.js';
import { getGuildConfigService } from '../config/index.js';
import { MusicService } from './musicService.js';
import { SearchSessionStore } from './searchSession.js';

let service: MusicService | undefined;
let searchSessions: SearchSessionStore | undefined;

/**
 * Siapkan mesin musik. **Harus dipanggil sebelum `client.login()`** karena
 * shoukaku memasang listener `clientReady` untuk mendaftarkan node Lavalink.
 */
export function initMusic(client: Client): MusicService {
  if (service) return service;

  const env = getEnv();
  service = new MusicService(client, {
    node: {
      host: env.LAVALINK_HOST,
      port: env.LAVALINK_PORT,
      password: env.LAVALINK_PASSWORD,
      name: 'harmony',
    },
    maxQueueSize: env.MAX_QUEUE_SIZE,
    getConfig: (guildId) => getGuildConfigService().get(guildId),
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

/** Session pencarian `/search` untuk proses ini. */
export function getSearchSessionStore(): SearchSessionStore {
  searchSessions ??= new SearchSessionStore();
  return searchSessions;
}

/** Bersihkan state musik saat bot berhenti (dipakai saat shutdown). */
export function resetMusicSingletons(): void {
  service = undefined;
  searchSessions?.clear();
  searchSessions = undefined;
}