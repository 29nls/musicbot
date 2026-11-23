/**
 * Barrel modul musik.
 *
 * Implementasi (singleton, service, handler komponen) tetap di file masing-masing;
 * file ini hanya mengoleksi ulang apa yang boleh dipakai modul lain.
 */
export {
  getMusicService,
  getSearchSessionStore,
  getStayService,
  initMusic,
  isMusicConnected,
  resetMusicSingletons,
} from './singleton.js';
export { MusicService } from './musicService.js';
export {
  DASHBOARD_CLAIM_PREFIX,
  DASHBOARD_COMMANDS,
  DASHBOARD_FAILURE_REASONS,
  DASHBOARD_MUSIC_CHANNEL,
  DASHBOARD_PLAYER_CONTROLS,
  DASHBOARD_RESULT_PREFIX,
  DASHBOARD_RESULT_TTL_MS,
  MAX_DASHBOARD_COMMAND_AGE_MS,
  MAX_DASHBOARD_QUERY_LENGTH,
  SEARCH_SOURCES,
  audioSourceOf,
  claimDashboardCommand,
  dashboardClaimKey,
  dashboardResultKey,
  decodeDashboardMusicCommand,
  decodeDashboardResult,
  encodeDashboardMusicCommand,
  isRequestId,
  isSnowflake,
  publishDashboardMusicCommand,
  subscribeDashboardMusicCommands,
  toDashboardTrack,
  writeDashboardResult,
} from './dashboard.js';
export type {
  DashboardAction,
  DashboardCommand,
  DashboardCommandMessage,
  DashboardFailureReason,
  DashboardResult,
  DashboardTrack,
  DecodedDashboardCommand,
  SearchSource,
  StoredDashboardResult,
} from './dashboard.js';
export {
  PLAYER_SNAPSHOT_QUEUE_PREVIEW,
  PLAYER_STATE_HEARTBEAT_MS,
  PLAYER_STATE_KEY_PREFIX,
  PLAYER_STATE_TTL_MS,
  buildPlayerSnapshot,
  decodePlayerSnapshot,
  playerStateKey,
} from './playerState.js';
export type {
  PlayerSnapshot,
  PlayerSnapshotInput,
  PlayerTrackSummary,
} from './playerState.js';
export {
  PLAYER_OWNER_RENEW_MS,
  PLAYER_OWNER_TTL_MS,
  PlayerOwnedElsewhereError,
  PlayerOwnership,
  playerOwnerKey,
} from './ownership.js';
export type { PlayerOwnershipClaim } from './ownership.js';
export {
  MAX_LAVALINK_NODES,
  lavalinkNodeName,
  parseLavalinkNodes,
  summarizeLavalinkNodes,
} from './nodes.js';
export type { LavalinkNodeList, LavalinkNodeReport, LavalinkNodeSpec, LavalinkNodeStatus } from './nodes.js';
export type {
  AttachmentPlayRequest,
  EnqueueRequest,
  MusicNodeOptions,
  MusicServiceOptions,
  PlayRequest,
} from './musicService.js';
export {
  ATTACHMENT_TTL_MS,
  AttachmentStore,
  attachmentTitle,
} from './attachments.js';
export type {
  AttachmentSaveFailure,
  AttachmentSaveResult,
  AttachmentSource,
  AttachmentStoreOptions,
  StoredAttachment,
} from './attachments.js';
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
export { SEARCH_RESULT_LIMIT, foundTracks, pickTracks } from './selection.js';
export type { TrackPickPurpose } from './selection.js';
export {
  MAX_OPTION_DESCRIPTION_LENGTH,
  MAX_OPTION_LABEL_LENGTH,
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
  sessionKey,
} from './searchSession.js';
export type { SearchSelection, SearchSession, TokenFactory } from './searchSession.js';
export {
  SHARED_STATE_KEY_PREFIX,
  SHARED_STATE_TTL_MS,
  SharedMusicState,
  sharedStateKey,
} from './sharedState.js';
export type { AddQueueResult, SharedMusicStateOptions } from './sharedState.js';
export {
  MAX_STORED_TRACKS,
  decodeSharedMusicState,
  emptyRecord,
  encodeSharedMusicState,
} from './sharedStateCodec.js';
export type { SharedMusicRecord } from './sharedStateCodec.js';
export {
  LONG_TRACK_THRESHOLD_MS,
  MAX_ATTACHMENT_BYTES,
  MAX_TRACK_DURATION_MS,
  checkTrackLimit,
  splitByTrackLimits,
  trackLimitReason,
  trackLimitRejectionMessage,
} from './limits.js';
export type { TrackLimitInput, TrackLimitSplit, TrackLimitVerdict } from './limits.js';
export { planStay, stayLabel } from './stay.js';
export type { StayAction, StayPlan, StayPlanInput } from './stay.js';
export { StayService } from './stayService.js';
export type { StayDeps, StayMusicPort, StayOutcome } from './stayService.js';
export {
  QUEUE_PAGE_PREFIX,
  QUEUE_PAGE_SIZE,
  buildQueuePage,
  clampQueuePage,
  parseQueuePageCustomId,
  queuePageCustomId,
  totalQueuePages,
} from './queuePage.js';
export type { QueuePage } from './queuePage.js';
export { handleQueuePage, queueNavRow } from './queueNav.js';
export type { QueueNavDeps } from './queueNav.js';
export { buildSearchIdentifier, isUrl } from './search.js';
export { shuffleTracks } from './shuffle.js';
export type { RandomSource } from './shuffle.js';
export { describeTrack, formatTrackDuration, progressBar, toTrackInfo } from './track.js';
export type {
  PlayOutcome,
  QueueSnapshot,
  RawTrack,
  SearchOutcome,
  SpotifySourceInfo,
  TrackInfo,
} from './types.js';