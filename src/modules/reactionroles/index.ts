export { getReactionRoleService } from './singleton.js';

export { ReactionRoleService } from './service.js';
export { ReactionRoleEmptyError } from './service.js';
export { PrismaReactionRoleRepository } from './repository.js';
export type { ReactionRoleRepository } from './repository.js';
export { toReactionRoleErrorEmbed } from './errors.js';
export {
  ReactionRoleValidationError,
  assertPanelKeepsOneOption,
  assertSnowflake,
  normalizeRoleInputs,
  parseRoleMentions,
} from './validation.js';
export {
  buildPanelComponents,
  buildRoleSelect,
  optionLabel,
  panelEmbed,
  panelListEmbed,
  panelUpdatedEmbed,
} from './embeds.js';
export { handleReactionRoleSelect } from './select.js';
export {
  MAX_CHANNEL_NAME_LENGTH,
  MAX_OPTION_DESCRIPTION_LENGTH,
  MAX_OPTION_LABEL_LENGTH,
  MAX_PANEL_OPTIONS,
  REACTION_ROLE_PREFIX,
  parseRoleOptionCustomId,
  roleOptionCustomId,
} from './types.js';
export type {
  CreatePanelInput,
  PanelOptionLookup,
  ReactionRoleOption,
  ReactionRolePanel,
  RoleInput,
} from './types.js';
