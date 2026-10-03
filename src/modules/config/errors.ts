import type { EmbedBuilder } from 'discord.js';
import { isDatabaseUnavailableError } from '../../services/prismaErrors.js';
import { getLogger } from '../../services/logger.js';
import { errorEmbed } from '../../utils/embeds.js';
import { ConfigValidationError } from './validation.js';

/**
 * Ubah error dari lapisan konfigurasi menjadi embed yang bisa dibaca user:
 * kesalahan input ditampilkan apa adanya, error tak terduga hanya dicatat di log.
 */
export function toConfigErrorEmbed(error: unknown): EmbedBuilder {
  if (error instanceof ConfigValidationError) {
    return errorEmbed(error.message, '❌ Konfigurasi Ditolak');
  }

  if (isDatabaseUnavailableError(error)) {
    return errorEmbed(
      'Database tidak bisa dihubungi, jadi konfigurasi belum bisa dibaca atau disimpan.\n' +
        'Periksa `DATABASE_URL` di .env dan koneksi internetmu; `npm run infra:up` hanya berlaku kalau memakai Postgres lokal.',
      '❌ Database Offline',
    );
  }

  getLogger().error({ err: error }, 'Operasi konfigurasi server gagal');

  return errorEmbed('Terjadi kesalahan saat mengakses konfigurasi. Detailnya sudah dicatat di log bot.');
}
