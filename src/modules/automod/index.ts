import { getPrisma } from '../../services/database.js';
import { SeenMessageGuard } from './dedupe.js';
import { PrismaAutomodRepository } from './repository.js';
import { AutomodService } from './service.js';
import { AutomodTracker } from './tracker.js';

let service: AutomodService | undefined;
let tracker: AutomodTracker | undefined;
let seenGuard: SeenMessageGuard | undefined;

/** Service rule automod (lazy, satu instance per proses bot). */
export function getAutomodService(): AutomodService {
  if (!service) {
    service = new AutomodService(new PrismaAutomodRepository(getPrisma()));
  }

  return service;
}

/** State anti-spam & anti-duplicate (satu instance per proses bot). */
export function getAutomodTracker(): AutomodTracker {
  tracker ??= new AutomodTracker();

  return tracker;
}

/**
 * Penjaga pesan yang sudah diproses (PRD §9.4 idempotensi).
 *
 * Satu instance per proses bot, sama seperti tracker: yang dilindungi bukan
 * data yang harus bertahan melewati restart, cuma event yang terkirim ulang
 * di sekitar sesi yang sama.
 */
export function getSeenMessageGuard(): SeenMessageGuard {
  seenGuard ??= new SeenMessageGuard();

  return seenGuard;
}

export { AutomodService, buildPolicy } from './service.js';
export { SeenMessageGuard, DEFAULT_SEEN_MESSAGE_TTL_MS } from './dedupe.js';
export { AutomodTracker } from './tracker.js';
export {
  analyzeMessage,
  capsPercent,
  extractHosts,
  findBadword,
  findInviteCodes,
  isExempt,
} from './engine.js';
export { toAutomodErrorEmbed } from './errors.js';
export { AutomodValidationError } from './validation.js';
export { automodLogEmbed, automodShowEmbed } from './embeds.js';
export {
  AUTOMOD_ACTIONS,
  AUTOMOD_RULES,
  AUTOMOD_TIMEOUT_MS,
  DEFAULT_ACTIONS,
  DEFAULT_THRESHOLDS,
  RULE_META,
  SPAM_WINDOW_MS,
  THRESHOLD_RANGES,
  actionLabel,
  describeThreshold,
  isAutomodAction,
  isAutomodRuleType,
  ruleDescription,
  ruleLabel,
} from './types.js';
export type {
  AutomodAction,
  AutomodPolicy,
  AutomodRule,
  AutomodRuleType,
  AutomodWhitelist,
} from './types.js';
export type { AutomodMessageInput, AutomodState, AutomodViolation } from './engine.js';
export type { AutomodExemptionKind, AutomodListField } from './service.js';
export type { AutomodRepository } from './repository.js';
