/**
 * Barrel modul playlist.
 *
 * Implementasi (repository, service, embed) tetap di file masing-masing; file ini
 * hanya mengoleksi ulang apa yang boleh dipakai modul lain.
 */
export { getPlaylistService } from './singleton.js';
export { PlaylistService } from './service.js';
export type { AddedTracks } from './service.js';
export { PrismaPlaylistRepository } from './repository.js';
export type { PlaylistRepository } from './repository.js';
export { toDomain as toPlaylistDomain } from './mapping.js';
export { playlistDetailEmbed, playlistListEmbed, playlistSummary, storedTrackLine } from './embeds.js';
export {
  RESOLVE_CHUNK_SIZE,
  hasSameTrack,
  parseStoredTracks,
  resolveStoredTracks,
  serializeTracks,
  toStoredTrack,
} from './tracks.js';
export type { ResolvedPlaylist, TrackResolver } from './tracks.js';
export {
  isSamePlaylistName,
  nameKey,
  parsePlaylistName,
  PlaylistNameError,
} from './validation.js';
export {
  MAX_PLAYLIST_NAME_LENGTH,
  MAX_PLAYLIST_TRACKS,
  PERSONAL_PLAYLIST_GUILD_ID,
  PLAYLIST_LIST_LIMIT,
  PLAYLIST_TRACK_PREVIEW,
} from './types.js';
export type {
  CreatePlaylistInput,
  Playlist,
  PlaylistFailure,
  PlaylistResult,
  PlaylistScope,
  StoredTrack,
} from './types.js';