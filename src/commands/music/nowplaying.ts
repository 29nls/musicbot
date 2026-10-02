import { SlashCommandBuilder } from 'discord.js';
import { nowPlayingEmbed } from '../../modules/music/index.js';
import type { BotCommand } from '../../types/command.js';
import { infoEmbed } from '../../utils/embeds.js';
import { gateMusicCommand, handleMusicFailure, replyEphemeralError } from './_shared.js';

export default {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Tampilkan lagu yang sedang diputar'),
  category: 'music',
  guildOnly: true,
  cooldownSeconds: 3,
  async execute(interaction, _client) {
    await interaction.deferReply();

    try {
      const gate = await gateMusicCommand(interaction);
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }

      const snapshot = await gate.ctx.music.snapshot(gate.ctx.guildId);
      const current = snapshot.current;

      if (!current) {
        await interaction.editReply({
          embeds: [infoEmbed('🔇 Tidak ada lagu', 'Bot sedang tidak memutar apa pun di server ini.')],
        });
        return;
      }

      await interaction.editReply({ embeds: [nowPlayingEmbed(current, snapshot)] });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'nowplaying');
    }
  },
} satisfies BotCommand;
