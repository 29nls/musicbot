import type { Guild } from 'discord.js';
import { getLogger } from '../../services/logger.js';
import { isGuildTextChannel } from '../../utils/discord.js';
import type { Translator } from '../i18n/index.js';
import { giveawayEndedEmbed, giveawayWinnerContent } from './embeds.js';
import type { Giveaway } from './types.js';

export interface FinishGiveawayResult {
  /** true kalau hasil terkirim, baik lewat edit pesan lama maupun pesan baru. */
  announced: boolean;
  /** true kalau pesan giveaway lama berhasil diedit. */
  messageUpdated: boolean;
}

/**
 * Umumkan hasil giveaway di channel asalnya.
 *
 * Pesan lama diedit kalau masih ada; kalau sudah dihapus, hasil dikirim sebagai
 * pesan baru supaya pemenang tetap disebut. Channel yang hilang bukan alasan
 * melempar — job mencatatnya dan melanjutkan giveaway lain.
 */
export async function finishGiveaway(
  guild: Guild,
  giveaway: Giveaway,
  winners: readonly string[],
  entryCount: number,
  t: Translator,
): Promise<FinishGiveawayResult> {
  const channel = await guild.channels.fetch(giveaway.channelId).catch(() => null);
  if (!isGuildTextChannel(channel)) {
    return { announced: false, messageUpdated: false };
  }

  const payload = {
    content: giveawayWinnerContent(giveaway, winners, t),
    embeds: [giveawayEndedEmbed(giveaway, winners, entryCount, t)],
    components: [],
  };

  try {
    if (giveaway.messageId) {
      const message = await channel.messages
        .fetch(giveaway.messageId)
        .catch(() => null);
      if (message) {
        await message.edit(payload);
        return { announced: true, messageUpdated: true };
      }
    }

    await channel.send(payload);
    return { announced: true, messageUpdated: false };
  } catch (error) {
    getLogger().warn(
      { err: error, guild: guild.id, giveawayId: giveaway.id },
      'Gagal mengumumkan hasil giveaway',
    );

    return { announced: false, messageUpdated: false };
  }
}
