/**
 * Barrel modul lirik.
 *
 * Implementasi (service, parser, embed) tetap di file masing-masing; file ini
 * hanya mengoleksi ulang apa yang boleh dipakai modul lain.
 */
export { getLyricsService, resetLyricsService } from './singleton.js';
export {
  DEFAULT_LYRICS_BASE_URL,
  LyricsService,
  LYRICS_CACHE_LIMIT,
  LYRICS_CACHE_TTL_MS,
  LYRICS_MISS_TTL_MS,
  LYRICS_TIMEOUT_MS,
  LYRICS_USER_AGENT,
  cacheKey,
  fetchLyricsResource,
  toDocument,
} from './service.js';
export type {
  LyricsHttpGet,
  LyricsHttpRequest,
  LyricsHttpResponse,
  LyricsServiceOptions,
} from './service.js';
export {
  LYRICS_CONTEXT_AFTER,
  LYRICS_CONTEXT_BEFORE,
  LYRICS_DESCRIPTION_LIMIT,
  LYRICS_FIELD_LIMIT,
  LYRICS_PLAIN_LINES,
  lyricsEmbed,
} from './embeds.js';
export {
  activeLineAt,
  findActiveLineIndex,
  formatTimecode,
  parseLrc,
  parseLrcTimestamp,
  parsePlainLyrics,
  selectLyricWindow,
  stripLrcTags,
} from './lrc.js';
export type { LrcParseResult, LyricWindowEntry, LyricWindowOptions } from './lrc.js';
export {
  DURATION_TOLERANCE_SECONDS,
  buildLyricsQuery,
  cleanArtistName,
  cleanTrackTitle,
  decodeEntities,
  extractGeniusLyrics,
  firstNonEmpty,
  hasLyrics,
  pickBestCandidate,
} from './query.js';
export type { LyricsCandidate } from './query.js';
export type { LyricLine, LyricsDocument, LyricsQuery, LyricsResult, LyricsSource } from './types.js';