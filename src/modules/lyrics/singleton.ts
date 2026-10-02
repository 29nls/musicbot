import { getEnv } from '../../config/env.js';
import { LyricsService } from './service.js';

let service: LyricsService | undefined;

/**
 * Service lirik untuk proses ini.
 *
 * Dibuat saat pertama kali dipakai supaya perintah yang tidak pernah memanggil
 * `/lyrics` tidak membayar biaya pembuatan koneksi apa pun.
 */
export function getLyricsService(): LyricsService {
  service ??= new LyricsService({
    baseUrl: getEnv().LYRCLIB_BASE_URL,
    geniusToken: getEnv().GENIUS_ACCESS_TOKEN,
  });

  return service;
}

/** Buang service beserta cache-nya (dipakai saat bot berhenti). */
export function resetLyricsService(): void {
  service?.clearCache();
  service = undefined;
}