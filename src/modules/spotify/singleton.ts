import { getEnv } from '../../config/env.js';
import { SpotifyMetadataService } from './service.js';

let service: SpotifyMetadataService | undefined;

/**
 * Service metadata Spotify (lazy).
 *
 * Dibuat saat pertama kali dipakai; kalau kredensial belum diisi di `.env`,
 * service tetap ada tetapi `isConfigured` false dan `/play` memilih jalur
 * Lavalink biasa.
 */
export function getSpotifyService(): SpotifyMetadataService {
  const env = getEnv();

  service ??= new SpotifyMetadataService({
    clientId: env.SPOTIFY_CLIENT_ID ?? '',
    clientSecret: env.SPOTIFY_CLIENT_SECRET ?? '',
  });

  return service;
}

/** Buang service beserta token yang di-cache (dipakai saat bot berhenti). */
export function resetSpotifyService(): void {
  service?.clearTokenCache();
  service = undefined;
}