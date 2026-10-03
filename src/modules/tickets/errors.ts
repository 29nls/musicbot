import type { EmbedBuilder } from 'discord.js';
import { getLogger } from '../../services/logger.js';
import { isDatabaseUnavailableError } from '../../services/prismaErrors.js';
import { errorEmbed } from '../../utils/embeds.js';
import { TicketValidationError } from './validation.js';

/**
 * Ubah error lapisan tiket menjadi embed yang aman ditampilkan.
 *
 * Detail internal tidak pernah bocor ke user; pesan di sini ditulis supaya
 * penyebab yang sering terjadi (izin Discord kurang, channel dihapus) punya
 * penjelasan yang bisa ditindaklanjuti.
 */
export function toTicketErrorEmbed(error: unknown): EmbedBuilder {
  if (isDatabaseUnavailableError(error)) {
    return errorEmbed(
      'Database tidak bisa dihubungi, jadi tiket tidak bisa dicatat.\n' +
        'Periksa `DATABASE_URL` di .env dan koneksi internetmu; `npm run infra:up` hanya berlaku kalau memakai Postgres lokal.',
      '❌ Database Offline',
    );
  }

  if (error instanceof TicketChannelError || error instanceof TicketValidationError) {
    return errorEmbed(error.message);
  }

  getLogger().error({ err: error }, 'Sistem tiket gagal diproses');

  return errorEmbed(
    'Terjadi kesalahan saat memproses tiket. Detailnya sudah dicatat di log bot.',
  );
}

/** Kesalahan yang diketahui penyebabnya dan bisa dijelaskan ke member. */
export class TicketChannelError extends Error {
  public override readonly name = 'TicketChannelError';

  constructor(message: string) {
    super(message);
  }
}