/**
 * Barrel modul custom command.
 *
 * Implementasi (repository, service, embed) tetap di file masing-masing; file
 * ini hanya mengoleksi ulang apa yang boleh dipakai modul lain.
 */
export { getCustomCommandService, resetCustomCommandService } from './singleton.js';
export { decodeCommandCache, encodeCommandCache } from './cacheCodec.js';
export type { CachedCommand } from './cacheCodec.js';
export { CustomCommandService } from './service.js';
export type { CustomCommandServiceOptions, SaveOptions } from './service.js';
export { PrismaCustomCommandRepository } from './repository.js';
export type { CustomCommandRepository } from './repository.js';
export { toDomain as toCustomCommandDomain } from './mapping.js';
export type { CustomCommandRow } from './mapping.js';
export {
  creatorLabel,
  customCommandDeletedEmbed,
  customCommandDetailEmbed,
  customCommandListEmbed,
} from './embeds.js';
export type { CustomCommandPreview } from './embeds.js';
export {
  parseTrigger,
  PLACEHOLDER_HELP,
  placeholderValues,
  renderResponse,
  renderedMessage,
} from './trigger.js';
export type { ParsedTrigger, ParseTriggerOptions, RenderContext } from './trigger.js';
export {
  CustomCommandValidationError,
  isSameName,
  nameKey,
  parseResponse,
  parseTriggerName,
} from './validation.js';
export {
  CUSTOM_COMMAND_LIST_LIMIT,
  GUILD_CACHE_TTL_MS,
  MAX_NAME_LENGTH,
  MAX_RESPONSE_LENGTH,
  PLACEHOLDER_TOKENS,
  TRIGGER_COOLDOWN_SECONDS,
  TRIGGER_PREFIX,
} from './types.js';
export type {
  CreateCustomCommandInput,
  CustomCommand,
  DeleteCustomCommandResult,
  EditCustomCommandResult,
  SaveCustomCommandResult,
} from './types.js';