import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { EMBED_COLORS } from '../../config/constants.js';
import { defaultTranslator, type Translator } from '../i18n/index.js';
import type { Giveaway } from './types.js';
import { giveawayJoinCustomId } from './types.js';

function endsAtLabel(giveaway: Giveaway): string {
  return `<t:${Math.floor(giveaway.endsAt.getTime() / 1_000)}:R>`;
}

/** Embed giveaway aktif; tombol ikut dikirim terpisah oleh command. */
export function giveawayEmbed(
  giveaway: Giveaway,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle(t('giveaway.embed.title', { prize: giveaway.prize }))
    .setDescription(t('giveaway.embed.description'))
    .addFields(
      {
        name: t('giveaway.field.winners'),
        value: String(giveaway.winnersCount),
        inline: true,
      },
      {
        name: t('giveaway.field.ends'),
        value: endsAtLabel(giveaway),
        inline: true,
      },
    )
    .setFooter({ text: t('giveaway.embed.footer', { id: String(giveaway.id) }) });
}

/** Tombol ikut; `disabled` dipakai kalau pesan lama masih menampilkan tombol. */
export function giveawayComponents(
  giveawayId: number,
  t: Translator = defaultTranslator,
): ActionRowBuilder<ButtonBuilder> {
  const button = new ButtonBuilder()
    .setCustomId(giveawayJoinCustomId(giveawayId))
    .setLabel(t('giveaway.button.join'))
    .setStyle(ButtonStyle.Success);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
}

/** Embed pengganti setelah giveaway ditutup. */
export function giveawayEndedEmbed(
  giveaway: Giveaway,
  winners: readonly string[],
  entryCount: number,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const winnerText = winners.map((id) => `<@${id}>`).join(', ');

  return new EmbedBuilder()
    .setColor(winners.length > 0 ? EMBED_COLORS.success : EMBED_COLORS.warning)
    .setTitle(t('giveaway.ended.title'))
    .setDescription(
      winners.length > 0
        ? t('giveaway.ended.winners', { winners: winnerText })
        : t('giveaway.ended.noEntries'),
    )
    .addFields(
      { name: t('giveaway.field.prize'), value: giveaway.prize, inline: true },
      {
        name: t('giveaway.field.entries'),
        value: String(entryCount),
        inline: true,
      },
    )
    .setFooter({ text: t('giveaway.embed.footer', { id: String(giveaway.id) }) });
}

/** Teks mention pemenang; undefined kalau tidak ada yang menang. */
export function giveawayWinnerContent(
  giveaway: Giveaway,
  winners: readonly string[],
  t: Translator = defaultTranslator,
): string | undefined {
  if (winners.length === 0) return undefined;

  return t('giveaway.announce.winners', {
    winners: winners.map((id) => `<@${id}>`).join(', '),
    prize: giveaway.prize,
  });
}
