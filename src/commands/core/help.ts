import { SlashCommandBuilder } from 'discord.js';
import { COMMAND_CATEGORIES, type CommandCategory } from '../../config/constants.js';
import { translatorForGuild } from '../../modules/i18n/index.js';
import type { BotCommand } from '../../types/command.js';
import { infoEmbed } from '../../utils/embeds.js';
import { commandCategoryEmoji, commandCategoryLabel } from './_shared.js';

export default {
  data: new SlashCommandBuilder().setName('help').setDescription('Tampilkan daftar perintah yang tersedia'),
  category: 'core',
  async execute(interaction, client) {
    // `/help` boleh dipakai di DM, jadi tanpa server pun harus punya bahasa:
    // `translatorForGuild` memakai bawaan ketika guildId kosong.
    const t = await translatorForGuild(interaction.guildId);

    const embed = infoEmbed(
      t('help.embed.title'),
      t('help.embed.intro', { count: client.commands.size }),
    );

    const entries = Object.keys(COMMAND_CATEGORIES) as CommandCategory[];

    for (const key of entries) {
      const names = client.commands
        .filter((command) => command.category === key)
        .map((command) => `\`/${command.data.toJSON().name}\``)
        .sort();

      if (names.length > 0) {
        embed.addFields({
          name: `${commandCategoryEmoji(key)} ${commandCategoryLabel(key, t)}`,
          value: names.join(' · '),
        });
      }
    }

    await interaction.reply({ embeds: [embed] });
  },
} satisfies BotCommand;