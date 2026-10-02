import type { EmbedBuilder } from 'discord.js';
import { getLogger } from '../../services/logger.js';
import { isDatabaseUnavailableError } from '../../services/prismaErrors.js';
import { errorEmbed } from '../../utils/embeds.js';

/**
 * Ubah error lapisan moderasi menjadi embed yang ramah.
 * Aksi moderasi dicatat sebagai kasus di database, jadi database mati berarti
 * aksi tidak dijalankan sama sekali (bukan dieksekusi setengah jalan).
 */
export function toModerationErrorEmbed(error: unknown): EmbedBuilder {
  if (isDatabaseUnavailableError(error)) {
    return errorEmbed(
      'Database tidak bisa dihubungi, jadi aksi moderasi tidak dijalankan dan tidak ada yang dicatat.\n' +
        'Jalankan `npm run infra:up` (atau `docker compose up -d postgres`) lalu coba lagi.',
      '❌ Database Offline',
    );
  }

  getLogger().error({ err: error }, 'Aksi moderasi gagal');

  return errorEmbed('Terjadi kesalahan saat memproses aksi moderasi. Detailnya sudah dicatat di log bot.');
}
