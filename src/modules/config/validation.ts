import { z } from 'zod';
import {
  MAX_IDLE_TIMEOUT_SEC,
  MAX_VOLUME,
  MAX_WELCOME_MESSAGE_LENGTH,
  MIN_IDLE_TIMEOUT_SEC,
  type GuildConfigPatch,
} from './types.js';

/** Error validasi yang pesannya aman ditampilkan ke user Discord. */
export class ConfigValidationError extends Error {
  public override readonly name = 'ConfigValidationError';

  constructor(message: string) {
    super(message);
  }
}

const snowflakeOrNull = z.union([
  z.string().regex(/^\d{17,20}$/, 'harus berupa ID Discord'),
  z.null(),
]);

const modulesSchema = z
  .object({
    music: z.boolean(),
    moderation: z.boolean(),
    automod: z.boolean(),
    logging: z.boolean(),
    reactions: z.boolean(),
    tickets: z.boolean(),
    customCommands: z.boolean(),
  })
  .partial();

export const guildConfigPatchSchema = z.object({
  logChannelId: snowflakeOrNull.optional(),
  welcomeChannelId: snowflakeOrNull.optional(),
  goodbyeChannelId: snowflakeOrNull.optional(),
  djRoleId: snowflakeOrNull.optional(),
  autoroleId: snowflakeOrNull.optional(),
  autoroleBotId: snowflakeOrNull.optional(),
  welcomeMessage: z
    .union([z.string().max(MAX_WELCOME_MESSAGE_LENGTH, `maksimal ${MAX_WELCOME_MESSAGE_LENGTH} karakter`), z.null()])
    .optional(),
  goodbyeMessage: z
    .union([z.string().max(MAX_WELCOME_MESSAGE_LENGTH, `maksimal ${MAX_WELCOME_MESSAGE_LENGTH} karakter`), z.null()])
    .optional(),
  defaultVolume: z.number().int().min(0).max(MAX_VOLUME, `maksimal ${MAX_VOLUME}`).optional(),
  idleTimeoutSec: z
    .number()
    .int()
    .min(MIN_IDLE_TIMEOUT_SEC, `minimal ${MIN_IDLE_TIMEOUT_SEC} detik`)
    .max(MAX_IDLE_TIMEOUT_SEC, `maksimal ${MAX_IDLE_TIMEOUT_SEC} detik`)
    .optional(),
  ticketPanelChannelId: snowflakeOrNull.optional(),
  ticketCategoryId: snowflakeOrNull.optional(),
  ticketStaffRoleId: snowflakeOrNull.optional(),
  ticketPanelMessageId: snowflakeOrNull.optional(),
  stayChannelId: snowflakeOrNull.optional(),
  modules: modulesSchema.optional(),
  // Hanya dua bahasa yang benar-benar ada katalognya. Menerima string bebas
  // di sini berarti bahasa yang tidak dikenal bisa tersimpan dan diam-diam
  // tidak pernah dipakai — jenis konfigurasi yang paling sering dilupakan.
  locale: z.enum(['id', 'en']).optional(),
});

/**
 * Validasi patch konfigurasi. Melempar ConfigValidationError dengan daftar
 * field yang bermasalah supaya bisa langsung ditampilkan ke user.
 */
export function validatePatch(patch: GuildConfigPatch): GuildConfigPatch {
  const result = guildConfigPatchSchema.safeParse(patch);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `• \`${issue.path.join('.') || '(root)'}\`: ${issue.message}`)
      .join('\n');
    throw new ConfigValidationError(`Nilai konfigurasi tidak valid:\n${details}`);
  }

  return result.data;
}
