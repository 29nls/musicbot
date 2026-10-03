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

      const { music, guildId, t } = gate.ctx;
      const snapshot = await music.snapshot(guildId);
      const current = snapshot.current;

      if (!current) {
        await interaction.editReply({
          embeds: [
            infoEmbed(
              `🔇 ${t('music.nowPlaying.nothingTitle')}`,
              t('music.nowPlaying.nothingBody'),
            ),
          ],
        });
        return;
      }

      await interaction.editReply({ embeds: [nowPlayingEmbed(current, snapshot, t)] });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'nowplaying');
    }
  },
} satisfies BotCommand;
