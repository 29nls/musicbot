import type { EmbedBuilder } from 'discord.js';
import { getLogger } from '../../services/logger.js';
import { isDatabaseUnavailableError } from '../../services/prismaErrors.js';
import { errorEmbed } from '../../utils/embeds.js';
import { ReactionRoleEmptyError } from './service.js';
import { ReactionRoleValidationError } from './validation.js';

/** Ubah error lapisan reaction role menjadi embed yang aman ditampilkan. */
export function toReactionRoleErrorEmbed(error: unknown): EmbedBuilder {
  if (error instanceof ReactionRoleValidationError || error instanceof ReactionRoleEmptyError) {
    return errorEmbed(error.message);
  }

  if (isDatabaseUnavailableError(error)) {
    return errorEmbed(
      'Database tidak bisa dihubungi, jadi panel role tidak bisa disimpan.\n' +
        'Jalankan `npm run infra:up` (atau `docker compose up -d postgres`) lalu coba lagi.',
      '❌ Database Offline',
    );
  }

  getLogger().error({ err: error }, 'Reaction role gagal diproses');

  return errorEmbed(
    'Terjadi kesalahan saat memproses panel role. Detailnya sudah dicatat di log bot.',
  );
}
