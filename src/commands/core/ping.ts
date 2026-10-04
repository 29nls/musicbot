import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { translatorForGuild } from '../../modules/i18n/index.js';
import type { BotCommand } from '../../types/command.js';
import { infoEmbed } from '../../utils/embeds.js';
import { uptimeText } from './_shared.js';

export default {
  data: new SlashCommandBuilder().setName('ping').setDescription('Cek latensi bot dan status koneksi'),
  category: 'core',
  cooldownSeconds: 3,
  async execute(interaction, client) {
    // `guildId` bisa kosong di DM; tanpa server dipakai bahasa bawaan.
    const t = await translatorForGuild(interaction.guildId);
    const startedAt = Date.now();

    await interaction.reply({ content: t('ping.measuring'), flags: MessageFlags.Ephemeral });

    const roundtrip = Date.now() - startedAt;
    const embed = infoEmbed(t('ping.embed.title'), t('ping.embed.description')).addFields(
      { name: t('ping.field.gateway'), value: `${Math.round(client.ws.ping)} ms`, inline: true },
      { name: t('ping.field.roundtrip'), value: `${roundtrip} ms`, inline: true },
      { name: t('ping.field.uptime'), value: uptimeText(client.uptime ?? 0, t), inline: true },
      { name: t('ping.field.guilds'), value: `${client.guilds.cache.size}`, inline: true },
    );

    await interaction.editReply({ content: null, embeds: [embed] });
  },
} satisfies BotCommand;