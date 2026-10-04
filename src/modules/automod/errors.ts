import type { EmbedBuilder } from 'discord.js';
import { defaultTranslator, type Translator } from '../i18n/index.js';
import { getLogger } from '../../services/logger.js';
import { isDatabaseUnavailableError } from '../../services/prismaErrors.js';
import { errorEmbed } from '../../utils/embeds.js';
import { AutomodValidationError } from './validation.js';

/**
 * Ubah error lapisan automod menjadi embed yang bisa dibaca user:
 * input salah ditampilkan apa adanya, error tak terduga hanya masuk log.
 */
export function toAutomodErrorEmbed(
  error: unknown,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  if (error instanceof AutomodValidationError) {
    // Pesannya sudah ikut bahasa server: `AutomodValidationError` membawa kunci
    // katalog, bukan kalimat yang sudah jadi.
    return errorEmbed(t(error.key, error.params), t('automod.err.rejectedTitle'));
  }

  if (isDatabaseUnavailableError(error)) {
    return errorEmbed(t('automod.err.dbOffline'), t('automod.err.dbOfflineTitle'));
  }

  getLogger().error({ err: error }, 'Operasi automod gagal');

  return errorEmbed(t('automod.err.generic'), t('embed.title.error'));
}
