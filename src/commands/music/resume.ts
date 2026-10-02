import { SlashCommandBuilder } from 'discord.js';
import { describeTrack } from '../../modules/music/index.js';
import type { BotCommand } from '../../types/command.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { gateMusicCommand, handleMusicFailure, replyEphemeralError } from './_shared.js';

export default {
  data: new SlashCommandBuilder().setName('resume').setDescription('Lanjutkan pemutaran yang dijeda'),
  category: 'music',
  guildOnly: true,
  cooldownSeconds: 2,
  async execute(interaction, _client) {
    await interaction.deferReply();

    try {
      const gate = await gateMusicCommand(interaction, { voice: true, control: true, playing: true });
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }

      const resumed = await gate.ctx.music.setPaused(gate.ctx.guildId, false);
      if (!resumed) {
        await replyEphemeralError(interaction, warningEmbed('Tidak ada pemutaran aktif untuk dilanjutkan.'));
        return;
      }

      const snapshot = await gate.ctx.music.snapshot(gate.ctx.guildId);

      await interaction.editReply({
        embeds: [
          successEmbed(
            snapshot.current
              ? `▶️ ${describeTrack(snapshot.current, 80)} dilanjutkan.`
              : '▶️ Pemutaran dilanjutkan.',
            '▶️ Dilanjutkan',
          ),
        ],
      });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'resume');
    }
  },
} satisfies BotCommand;
