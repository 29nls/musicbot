import type { EmbedBuilder } from 'discord.js';
import { getLogger } from '../logger/index.js';
import { errorEmbed, warningEmbed } from '../../utils/embeds.js';
import type { Translator } from '../i18n/index.js';
import { GiveawayValidationError } from './validation.js';

/** Ubah error domain menjadi embed; error tak dikenal tidak membocorkan detail. */
export function toGiveawayErrorEmbed(error: unknown, t: Translator): EmbedBuilder {
  if (error instanceof GiveawayValidationError) {
    return warningEmbed(t(error.key, error.params), t('embed.title.warning'));
  }

  getLogger().error({ err: error }, 'Giveaway gagal diproses');
  return errorEmbed(t('giveaway.err.generic'), t('embed.title.error'));
}
