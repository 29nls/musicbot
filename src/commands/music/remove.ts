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

      const position = interaction.options.getInteger('position', true);
      const snapshot = await gate.ctx.music.snapshot(gate.ctx.guildId);
      const removed = await gate.ctx.music.removeFromQueue(gate.ctx.guildId, position);

      if (!removed) {
        await interaction.editReply({
          embeds: [
            errorEmbed(
              snapshot.upcoming.length === 0
                ? 'Antrean sedang kosong, jadi tidak ada yang bisa dihapus.'
                : `Antrean hanya berisi ${snapshot.upcoming.length} lagu. Periksa nomornya dengan \`/queue\`.`,
            ),
          ],
        });
        return;
      }

      await interaction.editReply({
        embeds: [
          successEmbed(
            `🗑️ ${describeTrack(removed, 90)} dihapus dari posisi **${position}**.\n` +
              `Sisa antrean: **${snapshot.upcoming.length - 1}** lagu.`,
            '🗑️ Lagu Dihapus',
          ),
        ],
      });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'remove');
    }
  },
} satisfies BotCommand;