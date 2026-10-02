/**
 * Barrel modul musik.
 *
 * Implementasi (singleton, service, handler komponen) tetap di file masing-masing;
 * file ini hanya mengoleksi ulang apa yang boleh dipakai modul lain.
 */
export {
  getMusicService,
  getSearchSessionStore,
  initMusic,
  isMusicConnected,
  resetMusicSingletons,
} from './singleton.js';
export { MusicService } from './musicService.js';
export type { EnqueueRequest, MusicServiceOptions, PlayRequest } from './musicService.js';
export { canControlMusic, clampVolume, isInSameVoiceChannel } from './permissions.js';
export { renderPlayOutcome } from './render.js';
export { handleSearchSelect, searchSelectRow } from './searchSelect.js';
export {
  addedToQueueEmbed,
  nowPlayingEmbed,
  queueEmbed,
  searchResultsEmbed,
} from './embeds.js';
export {
  LOOP_MODES,
  loopModeHint,
  loopModeLabel,
  parseLoopMode,
} from './loop.js';
export type { LoopMode } from './loop.js';
export {
  FILTER_MODES,
  FILTER_SAFETY,
  filterModeHint,
  filterModeLabel,
  filterParamsFor,
  isWithinSafeBounds,
  parseFilterMode,
} from './filters.js';
export type { AudioFilterParams, EqualizerBand, FilterMode } from './filters.js';
export {
  MAX_SEEK_MS,
  parsePosition,
  resolveSeekPosition,
  seekErrorMessage,
} from './position.js';
export type { PositionFailure, PositionResult } from './position.js';
export {
  MAX_OPTION_DESCRIPTION_LENGTH,
  MAX_OPTION_LABEL_LENGTH,
  SEARCH_RESULT_LIMIT,
  SEARCH_SELECT_PREFIX,
  SEARCH_SESSION_TTL_MS,
  SearchSessionStore,
  clampOptionText,
  formatSeconds,
  parseSearchCustomId,
  parseSearchOptionValue,
  searchOptionDescription,
  searchOptionLabel,
  searchOptionValue,
  searchSelectCustomId,
} from './searchSession.js';
export type { SearchSelection, SearchSession, TokenFactory } from './searchSession.js';
export { buildSearchIdentifier, isUrl } from './search.js';
export { shuffleTracks } from './shuffle.js';
export type { RandomSource } from './shuffle.js';
export { describeTrack, formatTrackDuration, progressBar, toTrackInfo } from './track.js';
export type { PlayOutcome, QueueSnapshot, RawTrack, SearchOutcome, TrackInfo } from './types.js';