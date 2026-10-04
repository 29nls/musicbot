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

      const { music, guildId, t } = gate.ctx;
      const resumed = await music.setPaused(guildId, false);
      if (!resumed) {
        await replyEphemeralError(interaction, warningEmbed(t('music.control.nothingToResume'), t('embed.title.warning')));
        return;
      }

      const snapshot = await music.snapshot(guildId);

      await interaction.editReply({
        embeds: [
          successEmbed(
            snapshot.current
              ? `▶️ ${t('music.control.resumedTrack', { track: describeTrack(snapshot.current, 80) })}`
              : `▶️ ${t('music.control.resumedTrack', { track: t('music.control.resumedTitle') })}`,
            `▶️ ${t('music.control.resumedTitle')}`,
          ),
        ],
      });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'resume');
    }
  },
} satisfies BotCommand;
