import { SlashCommandBuilder } from 'discord.js';
import { describeTrack } from '../../modules/music/index.js';
import type { BotCommand } from '../../types/command.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { gateMusicCommand, handleMusicFailure, replyEphemeralError } from './_shared.js';

export default {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Hapus satu lagu dari antrean')
    .addIntegerOption((option) =>
      option
        .setName('position')
        .setDescription('Nomor lagu di antrean (lihat `/queue`)')
        .setMinValue(1)
        .setRequired(true),
    ),
  category: 'music',
  guildOnly: true,
  cooldownSeconds: 2,
  async execute(interaction, _client) {
    await interaction.deferReply();

    try {
      const gate = await gateMusicCommand(interaction, { voice: true, control: true });
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }

      const { music, guildId, t } = gate.ctx;
      const position = interaction.options.getInteger('position', true);
      const snapshot = await music.snapshot(guildId);
      const removed = await music.removeFromQueue(guildId, position);

      if (!removed) {
        await interaction.editReply({
          embeds: [
            errorEmbed(
              snapshot.upcoming.length === 0
                ? t('music.queue.removeEmpty')
                : t('music.queue.wrongNumber', { count: snapshot.upcoming.length }),
            ),
          ],
        });
        return;
      }

      await interaction.editReply({
        embeds: [
          successEmbed(
            `🗑️ ${t('music.queue.removed', {
              track: describeTrack(removed, 90),
              position,
              remaining: snapshot.upcoming.length - 1,
            })}`,
            `🗑️ ${t('music.queue.removedTitle')}`,
          ),
        ],
      });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'remove');
    }
  },
} satisfies BotCommand;