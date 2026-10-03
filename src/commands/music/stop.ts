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

      const { music, guildId, config, t } = gate.ctx;
      const stopped = await music.stop(guildId);
      const lines = [
        stopped
          ? `⏹️ ${t('music.control.stoppedTrack', { track: describeTrack(stopped, 80) })}`
          : `⏹️ ${t('music.control.stoppedTitle')}`,
        t('music.control.queueCleared', { seconds: config.idleTimeoutSec }),
      ];

      await interaction.editReply({
        embeds: [successEmbed(lines.join('\n'), `⏹️ ${t('music.control.stoppedTitle')}`)],
      });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'stop');
    }
  },
} satisfies BotCommand;
