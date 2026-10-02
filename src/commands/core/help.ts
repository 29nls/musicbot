import { SlashCommandBuilder } from 'discord.js';
import type { BotCommand } from '../../types/command.js';
import { COMMAND_CATEGORIES, type CommandCategory } from '../../config/constants.js';
import { infoEmbed } from '../../utils/embeds.js';

type CategoryMeta = { readonly label: string; readonly emoji: string };

export default {
  data: new SlashCommandBuilder().setName('help').setDescription('Tampilkan daftar perintah yang tersedia'),
  category: 'core',
  async execute(interaction, client) {
    const embed = infoEmbed(
      '📖 Daftar Perintah',
      `Bot ini menyediakan **${client.commands.size}** perintah. Semua perintah memakai format slash command.`,
    );

    const entries = Object.entries(COMMAND_CATEGORIES) as [CommandCategory, CategoryMeta][];

    for (const [key, meta] of entries) {
      const names = client.commands
        .filter((command) => command.category === key)
        .map((command) => `\`/${command.data.toJSON().name}\``)
        .sort();

      if (names.length > 0) {
        embed.addFields({ name: `${meta.emoji} ${meta.label}`, value: names.join(' · ') });
      }
    }

    await interaction.reply({ embeds: [embed] });
  },
} satisfies BotCommand;
