import { SlashCommandBuilder } from 'discord.js';
import { queueEmbed } from '../../modules/music/index.js';
import type { BotCommand } from '../../types/command.js';
import { infoEmbed } from '../../utils/embeds.js';
import { gateMusicCommand, handleMusicFailure, replyEphemeralError } from './_shared.js';

export default {
  data: new SlashCommandBuilder().setName('queue').setDescription('Tampilkan antrean lagu di server ini'),
  category: 'music',
  guildOnly: true,
  async execute(interaction, _client) {
    await interaction.deferReply();

    try {
      const gate = await gateMusicCommand(interaction);
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }

      const snapshot = await gate.ctx.music.snapshot(gate.ctx.guildId);

      if (!snapshot.current && snapshot.upcoming.length === 0) {
        await interaction.editReply({
          embeds: [infoEmbed('🎶 Antrean kosong', 'Tambahkan lagu dengan `/play <judul atau URL>`.')],
        });
        return;
      }

      await interaction.editReply({ embeds: [queueEmbed(snapshot)] });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'queue');
    }
  },
} satisfies BotCommand;
