import type { EmbedBuilder } from 'discord.js';
import { isDatabaseUnavailableError } from '../../services/prismaErrors.js';
import { getLogger } from '../../services/logger.js';
import { errorEmbed } from '../../utils/embeds.js';
import { defaultTranslator, type Translator } from '../i18n/index.js';
import { ConfigValidationError } from './validation.js';

/**
 * Ubah error dari lapisan konfigurasi menjadi embed yang bisa dibaca user:
 * kesalahan input ditampilkan apa adanya, error tak terduga hanya dicatat di log.
 *
 * `ConfigValidationError` menyimpan kunci katalog, bukan kalimat, supaya pesan
 * yang sama bisa dirender dalam bahasa server yang berbeda. Kalimatnya tetap
 * bisa dibaca di log internal karena `message`-nya diturunkan dari bahasa
 * bawaan.
 */
export function toConfigErrorEmbed(
  error: unknown,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  if (error instanceof ConfigValidationError) {
    return errorEmbed(t(error.key, error.params), t('config.err.invalidTitle'));
  }

  if (isDatabaseUnavailableError(error)) {
    return errorEmbed(t('config.err.dbOffline'), t('config.err.dbOfflineTitle'));
  }

  getLogger().error({ err: error }, 'Operasi konfigurasi server gagal');

  return errorEmbed(t('config.err.generic'), t('embed.title.error'));
}