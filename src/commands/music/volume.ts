import { SlashCommandBuilder } from 'discord.js';
import type { BotCommand } from '../../types/command.js';
import { successEmbed } from '../../utils/embeds.js';
import { gateMusicCommand, handleMusicFailure, replyEphemeralError } from './_shared.js';

/**
 * Batas volume.
 *
 * Angka di atas 100 tetap diterima karena Lavalink mendukung penguatan sampai
 * 200% dan `/config set volume` memakai skala yang sama — jadi angka 100 harus
 * berarti hal yang sama di kedua tempat itu.
 */
export const MAX_VOLUME = 200;

export default {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Atur volume playback')
    .addIntegerOption((option) =>
      option
        .setName('level')
        .setDescription('Level volume 0–200 (0 = bisukan)')
        .setMinValue(0)
        .setMaxValue(MAX_VOLUME)
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
      const requested = interaction.options.getInteger('level', true);
      const volume = await music.setVolume(guildId, requested);

      // Angka yang ditampilkan adalah hasil penguncian dari service, bukan input
      // mentah: kalau service mengunci ulang nanti, embed ini sudah jadi bohong.
      const text =
        volume === 0
          ? `🔇 ${t('music.volume.muted')}`
          : `🔊 ${t('music.volume.changed', { volume })}` +
            (volume > 100 ? t('music.volume.clipping') : '');

      await interaction.editReply({ embeds: [successEmbed(text, `🔊 ${t('music.volume.title')}`)] });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'volume');
    }
  },
} satisfies BotCommand;