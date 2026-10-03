/**
 * Barrel modul statistik (Fase 3, PRD §5.3).
 *
 * Implementasi (repository, service, embed) tetap di file masing-masing; file
 * ini hanya mengoleksi ulang apa yang boleh dipakai modul lain.
 */
export { getStatsService } from './singleton.js';
export { StatsService } from './service.js';
export { statsEmbed } from './embeds.js';
export { PrismaPlaybackStatRepository } from './repository.js';
export type { PlaybackStatRepository } from './repository.js';
export { toDomain as toStatDomain, toDomainList as toStatDomainList } from './mapping.js';
export type { PlaybackStatRow } from './mapping.js';
export {
  STAT_RETENTION_DAYS,
  purgeStatsBefore,
  statRetentionCutoff,
} from './retention.js';
export type { StatRetentionResult } from './retention.js';
export {
  bar,
  buildSummary,
  countActiveDays,
  dailyTotals,
  mergeEntries,
  peakDay,
  rankTotals,
  sharePercent,
} from './aggregate.js';
export {
  MS_PER_DAY,
  dayKey,
  dayRange,
  eachDay,
  parseDayKey,
  startOfUtcDay,
} from './day.js';
export {
  StatValidationError,
  assertStatInput,
  commandKey,
  isStatKind,
  statLabel,
  trackKey,
} from './validation.js';
export {
  MAX_STAT_KEY_LENGTH,
  MAX_STAT_LABEL_LENGTH,
  STAT_BAR_WIDTH,
  STAT_DEFAULT_DAYS,
  STAT_KINDS,
  STAT_MAX_DAYS,
  STAT_MIN_DAYS,
  STAT_TOP_LIMIT,
} from './types.js';
export type {
  StatDailyTotal,
  StatDayPoint,
  StatEntry,
  StatKind,
  StatSummary,
  StatTotal,
} from './types.js';