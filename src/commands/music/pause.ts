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

      const { music, guildId, t } = gate.ctx;
      const paused = await music.setPaused(guildId, true);
      const snapshot = await music.snapshot(guildId);

      if (!paused) {
        await replyEphemeralError(
          interaction,
          successEmbed(
            t('music.control.nothingToPause'),
            `⏸️ ${t('music.control.cannotPauseTitle')}`,
          ),
        );
        return;
      }

      await interaction.editReply({
        embeds: [
          successEmbed(
            snapshot.current
              ? `⏸️ ${t('music.control.pausedTrack', { track: describeTrack(snapshot.current, 80) })}`
              : `⏸️ ${t('music.control.pausedTrack', { track: t('music.control.pausedTitle') })}`,
            `⏸️ ${t('music.control.pausedTitle')}`,
          ),
        ],
      });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'pause');
    }
  },
} satisfies BotCommand;
