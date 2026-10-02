import { SlashCommandBuilder } from 'discord.js';
import { describeTrack } from '../../modules/music/index.js';
import type { BotCommand } from '../../types/command.js';
import { successEmbed } from '../../utils/embeds.js';
import { gateMusicCommand, handleMusicFailure, replyEphemeralError } from './_shared.js';

export default {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Hentikan pemutaran dan bersihkan antrean'),
  category: 'music',
  guildOnly: true,
  cooldownSeconds: 3,
  async execute(interaction, _client) {
    await interaction.deferReply();

    try {
      const gate = await gateMusicCommand(interaction, { voice: true, control: true, playing: true });
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }

      const stopped = await gate.ctx.music.stop(gate.ctx.guildId);
      const lines = [
        stopped ? `⏹️ Dihentikan: ${describeTrack(stopped, 80)}` : '⏹️ Pemutaran dihentikan.',
        `Antrean dibersihkan. Bot keluar dari voice channel otomatis dalam **${gate.ctx.config.idleTimeoutSec} detik** kalau tidak ada lagu baru.`,
      ];

      await interaction.editReply({ embeds: [successEmbed(lines.join('\n'), '⏹️ Dihentikan')] });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'stop');
    }
  },
} satisfies BotCommand;
