import {
  SEARCH_SOURCES,
  type DashboardCommand,
  type DashboardFailureReason,
  type SearchSource,
} from '@bot/modules/music/dashboard.js';
import { LOOP_MODES } from '@bot/modules/music/loop.js';

/**
 * Validasi badan permintaan dan pemetaan status untuk route musik.
 *
 * Bot tetap memvalidasi ulang semua yang lewat pub/sub; pemeriksaan di sini
 * hanya supaya kesalahan bentuk dijawab 400 cepat, bukan menjadi timeout yang
 * membingungkan.
 */

export const MAX_QUERY_LENGTH = 200;

export function parseSearchSource(value: unknown): SearchSource | null {
  return typeof value === 'string' && SEARCH_SOURCES.includes(value as SearchSource)
    ? (value as SearchSource)
    : null;
}

export function parseQuery(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const query = value.trim();

  return query.length > 0 && query.length <= MAX_QUERY_LENGTH ? query : null;
}

/** Hanya command yang boleh dikirim dari halaman musik. */
export function parseMusicCommand(value: unknown): DashboardCommand | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const command = value as Record<string, unknown>;
  switch (command.kind) {
    case 'play':
    case 'enqueue': {
      const query = parseQuery(command.query);
      const source = parseSearchSource(command.source) ?? 'youtube';
      return query ? { kind: command.kind, query, source } : null;
    }
    case 'pause':
    case 'resume':
    case 'skip':
    case 'stop':
      return { kind: command.kind };
    case 'loop': {
      const mode = command.mode;
      return typeof mode === 'string' && (LOOP_MODES as readonly string[]).includes(mode)
        ? { kind: 'loop', mode: mode as (typeof LOOP_MODES)[number] }
        : null;
    }
    case 'volume': {
      const level = command.level;
      return typeof level === 'number' && Number.isInteger(level) && level >= 0 && level <= 200
        ? { kind: 'volume', level }
        : null;
    }
    default:
      return null;
  }
}

/** Status HTTP untuk alasan yang berasal dari bot. */
export function failureStatus(reason: DashboardFailureReason): number {
  switch (reason) {
    case 'need-dj-role':
    case 'not-same-voice-channel':
    case 'no-voice':
    case 'forbidden':
      return 403;
    case 'no-session':
      return 401;
    case 'no-guild':
    case 'bad-request':
      return 400;
    case 'playlist-not-found':
    case 'not-found':
      return 404;
    case 'conflict':
    case 'rate-limited':
      return 429;
    case 'player-unavailable':
    case 'music-disabled':
    case 'not-configured':
    case 'empty':
    case 'failed':
      return 409;
    case 'shared-store-down':
    case 'not-sent':
    case 'permission-unknown':
      return 503;
    case 'timeout':
      return 504;
    case 'bad-origin':
      return 403;
  }
}
