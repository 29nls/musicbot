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
export { RETENTION_MONTHS, purgeExpiredRecords, retentionCutoff } from './retention.js';
export type { RetentionResult } from './retention.js';
export { formatCaseId, parseCaseNumber } from './caseNumber.js';
export {
  CASE_HISTORY_LIMIT,
  CASE_LOG_LIMIT,
  CASE_LOG_WINDOW_MS,
  caseHistoryLine,
  caseLogWindow,
  caseReasonText,
  caseTargetKind,
  currentStateLines,
  describeCaseStatus,
  dmDeliveryLine,
} from './caseView.js';
export type { CaseTargetState } from './caseView.js';
export {
  PRIOR_CASE_HINT_LIMIT,
  buildPriorCaseSummary,
  priorCaseNoteLines,
  priorCaseRecentLines,
} from './priorCases.js';
export type { PriorCaseSummary, TargetActionRow } from './priorCases.js';
export {
  CHANNEL_TARGET_ACTIONS,
  MODERATOR_ACTIVE_WINDOW_DAYS,
  MODERATOR_PROFILE_RECENT_LIMIT,
  actionBar,
  actionShare,
  buildModeratorProfile,
  casesPerTarget,
  moderatorActionLines,
  moderatorCaseLine,
  moderatorFailedTotal,
  moderatorOverviewLines,
  moderatorRevokedTotal,
  moderatorTargetKind,
} from './modProfile.js';
export type {
  ModeratorActionRow,
  ModeratorActionStat,
  ModeratorProfile,
  ModeratorTotals,
} from './modProfile.js';
export {
  LINKED_CASE_ACTIONS,
  clearCaseLinks,
  consumeCaseLink,
  pendingCaseLinkCount,
  registerCaseLink,
} from './caseLink.js';
export type { CaseLink } from './caseLink.js';
export { describeTimeout, parseTimeoutDuration } from './timeout.js';
export { MAX_SLOWMODE_SEC, describeSlowmode, parseSlowmodeSeconds } from './slowmode.js';
export {
  DEFAULT_GOODBYE_MESSAGE,
  DEFAULT_WELCOME_MESSAGE,
  greetingTemplate,
  renderGreeting,
} from './greetings.js';
export { moderationLogCategory, sendGuildEmbed } from './logging.js';
export { toModerationErrorEmbed } from './errors.js';
export {
  caseHistoryEmbed,
  caseSummaryEmbed,
  moderatorProfileEmbed,
  moderatorRecentCasesEmbed,
  moderationDmEmbed,
  moderationLogEmbed,
  moderationResultEmbed,
  notesEmbed,
  priorCaseEmbed,
  purgeLogEmbed,
  warningRevokedDmEmbed,
  warningRevokedLogEmbed,
  warningsEmbed,
} from './embeds.js';
export type { TargetKind } from './embeds.js';
export {
  ACTION_LABELS,
  DM_STATUSES,
  isDmStatus,
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
  DmStatus,
  ModerationAction,
  ModerationCase,
  NotifiableAction,
  WarningRecord,
} from './types.js';
