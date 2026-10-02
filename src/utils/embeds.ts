import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../config/constants.js';

export function baseEmbed(color: number = EMBED_COLORS.primary): EmbedBuilder {
  return new EmbedBuilder().setColor(color).setTimestamp();
}

export function infoEmbed(title: string, description?: string): EmbedBuilder {
  const embed = baseEmbed().setTitle(title);
  if (description) embed.setDescription(description);
  return embed;
}

export function successEmbed(description: string, title = '✅ Berhasil'): EmbedBuilder {
  return baseEmbed(EMBED_COLORS.success).setTitle(title).setDescription(description);
}

export function warningEmbed(description: string, title = '⚠️ Perhatian'): EmbedBuilder {
  return baseEmbed(EMBED_COLORS.warning).setTitle(title).setDescription(description);
}

export function errorEmbed(description: string, title = '❌ Terjadi Kesalahan'): EmbedBuilder {
  return baseEmbed(EMBED_COLORS.error).setTitle(title).setDescription(description);
}
