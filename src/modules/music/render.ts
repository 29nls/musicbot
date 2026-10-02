import type { EmbedBuilder } from 'discord.js';
import { getEnv } from '../../config/env.js';
import { errorEmbed, warningEmbed } from '../../utils/embeds.js';
import { addedToQueueEmbed } from './embeds.js';
import type { PlayOutcome } from './types.js';

/**
 * Hasil `/play` → embed yang siap dikirim.
 *
 * Dipisah dari perintah supaya handler komponen `/search` bisa memakai render
 * yang sama setelah user memilih lagu dari select menu.
 */
export function renderPlayOutcome(outcome: PlayOutcome): EmbedBuilder {
  switch (outcome.kind) {
    case 'added':
      return addedToQueueEmbed(outcome);
    case 'empty':
      return errorEmbed('Tidak ada hasil untuk pencarian itu. Coba kata kunci lain atau kirim URL.');
    case 'error':
      return errorEmbed(`Lagu ini tidak bisa dimuat: ${outcome.message}`);
    case 'queue-full':
      return warningEmbed(
        `Antrean sudah penuh (batas ${getEnv().MAX_QUEUE_SIZE} lagu). Tunggu sampai ada lagu yang selesai.`,
      );
    case 'unavailable':
    default:
      return errorEmbed(
        'Lavalink belum terhubung, jadi lagu tidak bisa diputar. Cek `docker compose logs lavalink`.',
      );
  }
}