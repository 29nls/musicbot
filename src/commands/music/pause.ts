import { SlashCommandBuilder } from 'discord.js';
import { describeTrack } from '../../modules/music/index.js';
import type { BotCommand } from '../../types/command.js';
import { successEmbed } from '../../utils/embeds.js';
import { gateMusicCommand, handleMusicFailure, replyEphemeralError } from './_shared.js';

export default {
  data: new SlashCommandBuilder().setName('pause').setDescription('Jeda lagu yang sedang diputar'),
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

      const paused = await gate.ctx.music.setPaused(gate.ctx.guildId, true);
      const snapshot = await gate.ctx.music.snapshot(gate.ctx.guildId);

      if (!paused) {
        await replyEphemeralError(interaction, successEmbed('Tidak ada pemutaran aktif.', '⏸️ Tidak Bisa Dijeda'));
        return;
      }

      await interaction.editReply({
        embeds: [
          successEmbed(
            snapshot.current
              ? `⏸️ ${describeTrack(snapshot.current, 80)} dijeda. Lanjutkan dengan \`/resume\`.`
              : '⏸️ Pemutaran dijeda.',
            '⏸️ Dijeda',
          ),
        ],
      });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'pause');
    }
  },
} satisfies BotCommand;
