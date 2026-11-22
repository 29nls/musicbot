import { MessageFlags, type ButtonInteraction, type EmbedBuilder } from 'discord.js';
import { getLogger } from '../../services/logger.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { translatorFor, type Translator } from '../i18n/index.js';
import { toGiveawayErrorEmbed } from './errors.js';
import { getGiveawayService } from './singleton.js';
import type { JoinOutcome } from './service.js';
import { parseGiveawayJoinCustomId } from './types.js';

/**
 * Dependency handler tombol ikut. Bawaannya memakai service sungguhan; tes
 * menyuntikkan fake supaya seluruh jalur balasan bisa diperiksa tanpa database.
 */
export interface GiveawayJoinDeps {
  join: (guildId: string, giveawayId: number, userId: string) => Promise<JoinOutcome>;
}

function defaultJoinDeps(): GiveawayJoinDeps {
  return {
    join: (guildId, giveawayId, userId) =>
      getGiveawayService().join(guildId, giveawayId, userId),
  };
}

export async function handleGiveawayJoin(
  interaction: ButtonInteraction,
  deps: GiveawayJoinDeps = defaultJoinDeps(),
): Promise<void> {
  if (!interaction.inCachedGuild()) return;

  const giveawayId = parseGiveawayJoinCustomId(interaction.customId);
  if (giveawayId === null) return;

  // Disalin sebelum await: penyempitan `inCachedGuild` tidak bertahan.
  const guildId = interaction.guildId;
  const t = await translatorFor(guildId);

  try {
    const outcome = await deps.join(guildId, giveawayId, interaction.user.id);
    await reply(interaction, joinReply(outcome, t));
  } catch (error) {
    getLogger().warn(
      { err: error, guild: guildId, user: interaction.user.id, giveawayId },
      'Tombol giveaway gagal diproses',
    );
    await reply(interaction, toGiveawayErrorEmbed(error, t));
  }
}

function joinReply(outcome: JoinOutcome, t: Translator): EmbedBuilder {
  if (outcome === 'added') {
    return successEmbed(t('giveaway.join.ok'), t('giveaway.join.title'));
  }
  if (outcome === 'duplicate') {
    return warningEmbed(t('giveaway.join.already'), t('giveaway.join.title'));
  }
  if (outcome === 'closed') {
    return warningEmbed(t('giveaway.join.closed'), t('giveaway.join.title'));
  }

  return warningEmbed(t('giveaway.join.missing'), t('giveaway.join.title'));
}

async function reply(interaction: ButtonInteraction, embed: EmbedBuilder): Promise<void> {
  try {
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } catch (error) {
    // Tombol punya jendela balasan 3 detik; kalau sudah kedaluwarsa tidak ada
    // yang bisa dilakukan selain mencatatnya.
    getLogger().warn({ err: error }, 'Gagal membalas tombol giveaway');
  }
}
