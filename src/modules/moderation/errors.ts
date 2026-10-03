import type { EmbedBuilder } from 'discord.js';
import { getLogger } from '../../services/logger.js';
import { isDatabaseUnavailableError } from '../../services/prismaErrors.js';
import { defaultTranslator, type Translator } from '../i18n/index.js';
import { errorEmbed } from '../../utils/embeds.js';

/**
 * Ubah error lapisan moderasi menjadi embed yang ramah.
 * Aksi moderasi dicatat sebagai kasus di database, jadi database mati berarti
 * aksi tidak dijalankan sama sekali (bukan dieksekusi setengah jalan).
 */
export function toModerationErrorEmbed(
  error: unknown,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  if (isDatabaseUnavailableError(error)) {
    return errorEmbed(t('mod.databaseDown'), `❌ ${t('mod.databaseDownTitle')}`);
  }

  getLogger().error({ err: error }, 'Aksi moderasi gagal');

  return errorEmbed(t('mod.internalError'));
}
