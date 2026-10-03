import type { EmbedBuilder } from 'discord.js';
import { defaultTranslator, type Translator } from '../i18n/index.js';
import { getLogger } from '../../services/logger.js';
import { isDatabaseUnavailableError } from '../../services/prismaErrors.js';
import { errorEmbed } from '../../utils/embeds.js';
import { LoggingValidationError } from './validation.js';

/** Ubah error lapisan logging menjadi embed yang bisa dibaca user. */
export function toLoggingErrorEmbed(
  error: unknown,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  if (error instanceof LoggingValidationError) {
    // Pesannya sudah ikut bahasa server: `LoggingValidationError` membawa kunci
    // katalog, bukan kalimat yang sudah jadi.
    return errorEmbed(t(error.key, error.params), t('log.error.rejectedTitle'));
  }

  if (isDatabaseUnavailableError(error)) {
    return errorEmbed(t('log.error.dbOffline'), t('log.error.dbOfflineTitle'));
  }

  getLogger().error({ err: error }, 'Operasi logging gagal');

  return errorEmbed(t('log.error.generic'));
}
