export { getTicketService } from './singleton.js';
export { TicketService } from './service.js';
export { PrismaTicketRepository } from './repository.js';
export type { TicketRepository } from './repository.js';
export { toDomain as toTicketDomain, type TicketRow } from './mapping.js';
export { purgeExpiredTickets, ticketRetentionCutoff } from './retention.js';
export type { TicketRetentionResult } from './retention.js';
export { toTicketErrorEmbed, TicketChannelError } from './errors.js';
export { closedTicketChannelName, slugify, ticketChannelName } from './naming.js';
export {
  buildCreateButton,
  buildTicketControls,
  ticketClosedEmbed,
  ticketListEmbed,
  ticketOpenedEmbed,
  ticketPanelEmbed,
  ticketTranscriptEmbed,
} from './embeds.js';
export { handleTicketButton, isStaff } from './buttons.js';
export {
  MAX_MESSAGE_CONTENT_LENGTH,
  MAX_TRANSCRIPT_MESSAGES,
  TRANSCRIPT_PREVIEW_COUNT,
  captureTranscript,
  parseTranscript,
  renderTranscriptText,
  transcriptPreviewLines,
} from './transcript.js';
export type { TicketTranscript, TranscriptEntry } from './transcript.js';
export {
  buildTicketSubjectModal,
  handleTicketSubjectSubmit,
  showTicketSubjectModal,
} from './modal.js';
export {
  archiveTicketChannel,
  closeAndArchive,
  createTicketChannel,
  openTicket,
} from './lifecycle.js';
export type { CloseResult, OpenTicketOutcome } from './lifecycle.js';
export { TicketValidationError, missingTicketConfig, parseTicketSubject } from './validation.js';
export {
  MAX_SUBJECT_LENGTH,
  MODAL_SUBJECT_MAX_LENGTH,
  MODAL_SUBJECT_MIN_LENGTH,
  TICKET_LIST_LIMIT,
  TICKET_PREFIX,
  TICKET_RETENTION_MONTHS,
  TICKET_STATUSES,
  TICKET_SUBJECT_MODAL,
  formatTicketId,
  isTicketStatus,
  isTicketSubjectModal,
  parseTicketButtonId,
  ticketButtonId,
} from './types.js';
export type {
  CreateTicketInput,
  Ticket,
  TicketButtonAction,
  TicketPanelIds,
  TicketStatus,
} from './types.js';
export type { OpenTicketSummary } from './service.js';