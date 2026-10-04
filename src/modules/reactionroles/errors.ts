import type { EmbedBuilder } from 'discord.js';
import { defaultTranslator, type Translator } from '../i18n/index.js';
import { getLogger } from '../../services/logger.js';
import { isDatabaseUnavailableError } from '../../services/prismaErrors.js';
import { errorEmbed } from '../../utils/embeds.js';
import { ReactionRoleEmptyError } from './service.js';
import { ReactionRoleValidationError } from './validation.js';

/**
 * Ubah error lapisan reaction role menjadi embed yang aman ditampilkan.
 *
 * Pesan validasi sudah membawa kunci katalog, jadi embed-nya ikut bahasa
 * server; penyebab lain (database mati, error tak terduga) punya kalimatnya
 * sendiri di katalog.
 */
export function toReactionRoleErrorEmbed(
  error: unknown,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  if (error instanceof ReactionRoleValidationError || error instanceof ReactionRoleEmptyError) {
    return errorEmbed(t(error.key, error.params), t('embed.title.error'));
  }

  if (isDatabaseUnavailableError(error)) {
    return errorEmbed(t('rr.err.dbOffline'), t('rr.err.dbOfflineTitle'));
  }

  getLogger().error({ err: error }, 'Reaction role gagal diproses');

  return errorEmbed(t('rr.err.generic'), t('embed.title.error'));
}
