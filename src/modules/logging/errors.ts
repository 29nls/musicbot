import type { EmbedBuilder } from 'discord.js';
import { getLogger } from '../../services/logger.js';
import { isDatabaseUnavailableError } from '../../services/prismaErrors.js';
import { errorEmbed } from '../../utils/embeds.js';
import { LoggingValidationError } from './validation.js';

/** Ubah error lapisan logging menjadi embed yang bisa dibaca user. */
export function toLoggingErrorEmbed(error: unknown): EmbedBuilder {
  if (error instanceof LoggingValidationError) {
    return errorEmbed(error.message, '❌ Pengaturan Log Ditolak');
  }

  if (isDatabaseUnavailableError(error)) {
    return errorEmbed(
      'Database tidak bisa dihubungi, jadi routing log belum bisa dibaca atau disimpan.\n' +
        'Jalankan `npm run infra:up` (atau `docker compose up -d postgres`) lalu coba lagi.',
      '❌ Database Offline',
    );
  }

  getLogger().error({ err: error }, 'Operasi logging gagal');

  return errorEmbed('Terjadi kesalahan saat mengakses pengaturan log. Detailnya sudah dicatat di log bot.');
}
