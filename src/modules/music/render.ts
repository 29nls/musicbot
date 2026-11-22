import type { EmbedBuilder } from 'discord.js';
import { getEnv } from '../../config/env.js';
import { defaultTranslator, type Translator } from '../i18n/index.js';
import { errorEmbed, warningEmbed } from '../../utils/embeds.js';
import { addedToQueueEmbed } from './embeds.js';
import { MAX_ATTACHMENT_BYTES, trackLimitRejectionMessage } from './limits.js';
import type { PlayOutcome } from './types.js';

/**
 * Hasil `/play` → embed yang siap dikirim.
 *
 * Dipisah dari perintah supaya handler komponen `/search` bisa memakai render
 * yang sama setelah user memilih lagu dari select menu.
 */
export function renderPlayOutcome(
  outcome: PlayOutcome,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  switch (outcome.kind) {
    case 'added':
      return addedToQueueEmbed(outcome, t);
    case 'empty':
      return errorEmbed(t('music.play.emptyResult'), t('embed.title.error'));
    case 'error':
      return errorEmbed(t('music.play.loadFailed', { message: outcome.message }), t('embed.title.error'));
    case 'queue-full':
      return warningEmbed(
        t('music.play.queueFullMessage', { max: getEnv().MAX_QUEUE_SIZE }),
      );
    case 'attachment-failed':
      if (outcome.reason === 'too-large') {
        return errorEmbed(
          t('music.play.attachmentTooLarge', {
            size: formatMegabytes(outcome.size ?? 0),
            max: formatMegabytes(MAX_ATTACHMENT_BYTES),
          }),
          t('embed.title.error'),
        );
      }

      return errorEmbed(
        t(
          outcome.reason === 'failed'
            ? 'music.play.attachmentFailed'
            : 'music.play.attachmentUnsupported',
        ),
        t('embed.title.error'),
      );
    case 'rejected':
      return warningEmbed(
        trackLimitRejectionMessage(outcome.reason, outcome.count, t),
        t('music.play.rejectedTitle'),
      );
    case 'unavailable':
    default:
      return errorEmbed(t('music.play.lavalinkDown'), t('embed.title.error'));
  }
}

/** Ukuran file untuk pesan batas; satu desimal cukup untuk dibaca. */
function formatMegabytes(bytes: number): string {
  return `${Number((Math.max(bytes, 0) / (1024 * 1024)).toFixed(1))} MB`;
}