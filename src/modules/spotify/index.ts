/**
 * Barrel modul Spotify.
 *
 * Yang diekspor ke perintah cukup sedikit: `/play` hanya butuh
 * `resolveSpotifyPlay`, dan sisanya dipakai tes.
 */
export { getSpotifyService, resetSpotifyService } from './singleton.js';
export {
  DEFAULT_SPOTIFY_API_URL,
  SPOTIFY_TIMEOUT_MS,
  SPOTIFY_TOKEN_TTL_MS,
  SPOTIFY_TOKEN_URL,
  SpotifyMetadataService,
  fetchSpotify,
  mapTrack,
} from './service.js';
export type {
  SpotifyHttpRequest,
  SpotifyHttpResponse,
  SpotifyServiceOptions,
  SpotifyTransport,
} from './service.js';
export { resolveSpotifyPlay, searchQueryFor, toPlayInfo } from './bridge.js';
export type { SpotifyPlayDeps, SpotifyPlayInfo, SpotifyPlayResult } from './bridge.js';
export { toTrackInfo as toSpotifyTrackInfo } from '../music/index.js';
export { DURATION_SOFT_LIMIT_MS, DURATION_TOLERANCE_MS, matchNote, pickSpotifyMatch } from './match.js';
export type { MatchInput, SpotifyMatch } from './match.js';
export { parseSpotifyLink, unsupportedLinkMessage } from './parse.js';
export type { SpotifyLink } from './parse.js';
export { toSpotifyMeta } from './types.js';
export type { CreateSpotifyMetaInput, SpotifyResult, SpotifyTrackMeta } from './types.js';