import { SlashCommandBuilder } from 'discord.js';
import { resolveSeekPosition, seekErrorMessage } from '../../modules/music/index.js';
import { formatDuration } from '../../utils/duration.js';
import type { BotCommand } from '../../types/command.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { gateMusicCommand, handleMusicFailure, replyEphemeralError } from './_shared.js';

export default {
  data: new SlashCommandBuilder()
    .setName('seek')
    .setDescription('Lompat ke posisi tertentu pada lagu yang sedang diputar')
    .addStringOption((option) =>
      option
        .setName('position')
        .setDescription('Posisi — `90`, `1:30`, atau `1m30s`')
        .setMaxLength(20)
        .setRequired(true),
    ),
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

      const { music, guildId } = gate.ctx;
      const snapshot = await music.snapshot(guildId);
      const current = snapshot.current;

      // Siaran langsung memang tidak punya posisi; pesan spesifiknya lebih
      // berguna daripada "tidak ada lagu yang sedang diputar".
      if (!current) {
        await interaction.editReply({
          embeds: [errorEmbed('Tidak ada lagu yang sedang diputar.')],
        });
        return;
      }

      const parsed = resolveSeekPosition(
        interaction.options.getString('position', true),
        current.durationMs,
        current.isStream,
      );

      if (!parsed.ok) {
        await interaction.editReply({
          embeds: [errorEmbed(seekErrorMessage(parsed.reason))],
        });
        return;
      }

      const moved = await music.seek(guildId, parsed.positionMs);
      await interaction.editReply({
        embeds: [
          moved
            ? successEmbed(
                `⏩ Lompat ke **${formatDuration(parsed.positionMs)}** dari ${formatDuration(current.durationMs)}.`,
                '⏩ Lompat Posisi',
              )
            : errorEmbed('Lagu tidak bisa dilompat sekarang. Coba lagi setelah lagu berikutnya dimulai.'),
        ],
      });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'seek');
    }
  },
} satisfies BotCommand;