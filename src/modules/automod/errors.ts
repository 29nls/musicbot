import type { EmbedBuilder } from 'discord.js';
import { getLogger } from '../../services/logger.js';
import { isDatabaseUnavailableError } from '../../services/prismaErrors.js';
import { errorEmbed } from '../../utils/embeds.js';
import { AutomodValidationError } from './validation.js';

/**
 * Ubah error lapisan automod menjadi embed yang bisa dibaca user:
 * input salah ditampilkan apa adanya, error tak terduga hanya masuk log.
 */
export function toAutomodErrorEmbed(error: unknown): EmbedBuilder {
  if (error instanceof AutomodValidationError) {
    return errorEmbed(error.message, '❌ Pengaturan Automod Ditolak');
  }

  if (isDatabaseUnavailableError(error)) {
    return errorEmbed(
      'Database tidak bisa dihubungi, jadi pengaturan automod belum bisa dibaca atau disimpan.\n' +
        'Periksa `DATABASE_URL` di .env dan koneksi internetmu; `npm run infra:up` hanya berlaku kalau memakai Postgres lokal.',
      '❌ Database Offline',
    );
  }

  getLogger().error({ err: error }, 'Operasi automod gagal');

  return errorEmbed('Terjadi kesalahan saat mengakses pengaturan automod. Detailnya sudah dicatat di log bot.');
}
