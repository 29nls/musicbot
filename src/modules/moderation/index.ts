import { getPrisma } from '../../services/database.js';
import { PrismaModerationRepository } from './repository.js';
import { ModerationService } from './service.js';

let service: ModerationService | undefined;

/** Service moderasi (lazy, satu instance per proses bot). */
export function getModerationService(): ModerationService {
  if (!service) {
    service = new ModerationService(new PrismaModerationRepository(getPrisma()));
  }

  return service;
}

export { ModerationService } from './service.js';
export { PrismaModerationRepository } from './repository.js';
export type { ModerationRepository } from './repository.js';
export type { WarningSummary } from './service.js';
export { checkModerationHierarchy } from './hierarchy.js';
export { formatCaseId, parseCaseNumber } from './caseNumber.js';
export { describeTimeout, parseTimeoutDuration } from './timeout.js';
export { MAX_SLOWMODE_SEC, describeSlowmode, parseSlowmodeSeconds } from './slowmode.js';
export {
  DEFAULT_GOODBYE_MESSAGE,
  DEFAULT_WELCOME_MESSAGE,
  greetingTemplate,
  renderGreeting,
} from './greetings.js';
export { sendGuildEmbed } from './logging.js';
export { toModerationErrorEmbed } from './errors.js';
export {
  moderationDmEmbed,
  moderationLogEmbed,
  moderationResultEmbed,
  notesEmbed,
  purgeLogEmbed,
  warningRevokedDmEmbed,
  warningRevokedLogEmbed,
  warningsEmbed,
} from './embeds.js';
export type { TargetKind } from './embeds.js';
export {
  ACTION_LABELS,
  MAX_NOTES_SHOWN,
  MAX_PURGE_COUNT,
  MAX_REASON_LENGTH,
  MAX_TIMEOUT_MS,
  MAX_WARNINGS_SHOWN,
  NOTIFIABLE_ACTIONS,
} from './types.js';
export type {
  CreateCaseInput,
  CreateWarningInput,
  ModerationAction,
  ModerationCase,
  NotifiableAction,
  WarningRecord,
} from './types.js';
