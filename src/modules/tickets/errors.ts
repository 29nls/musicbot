import type { EmbedBuilder } from 'discord.js';
import { defaultTranslator, type MessageKey, type Translator } from '../i18n/index.js';
import { getLogger } from '../../services/logger.js';
import { isDatabaseUnavailableError } from '../../services/prismaErrors.js';
import { errorEmbed } from '../../utils/embeds.js';
import { TicketValidationError } from './validation.js';

/**
 * Ubah error lapisan tiket menjadi embed yang aman ditampilkan.
 *
 * Detail internal tidak pernah bocor ke user; pesan di sini ditulis supaya
 * penyebab yang sering terjadi (izin Discord kurang, channel dihapus) punya
 * penjelasan yang bisa ditindaklanjuti. Pesan yang datang dari error ber-kunci
 * ikut bahasa server.
 */
export function toTicketErrorEmbed(
  error: unknown,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  if (isDatabaseUnavailableError(error)) {
    return errorEmbed(t('ticket.err.dbOffline'), t('ticket.err.dbOfflineTitle'));
  }

  if (error instanceof TicketChannelError || error instanceof TicketValidationError) {
    return errorEmbed(t(error.key, error.params));
  }

  getLogger().error({ err: error }, 'Sistem tiket gagal diproses');

  return errorEmbed(t('ticket.err.generic'));
}

/** Kesalahan yang diketahui penyebabnya dan bisa dijelaskan ke member. */
export class TicketChannelError extends Error {
  public override readonly name = 'TicketChannelError';

  constructor(
    public readonly key: MessageKey,
    public readonly params?: Record<string, string | number>,
  ) {
    super(defaultTranslator(key, params));
  }
}
