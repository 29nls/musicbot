import { getPrisma } from '../../services/database.js';
import { PrismaPlaylistRepository } from './repository.js';
import { PlaylistService } from './service.js';

let service: PlaylistService | undefined;

/** Service playlist (lazy, satu instance per proses bot). */
export function getPlaylistService(): PlaylistService {
  if (!service) {
    service = new PlaylistService(new PrismaPlaylistRepository(getPrisma()));
  }

  return service;
}