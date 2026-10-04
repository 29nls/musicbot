import { SlashCommandBuilder } from 'discord.js';
import { describeTrack } from '../../modules/music/index.js';
import type { BotCommand } from '../../types/command.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { gateMusicCommand, handleMusicFailure, replyEphemeralError } from './_shared.js';

export default {
  data: new SlashCommandBuilder()
    .setName('move')
    .setDescription('Pindahkan posisi satu lagu dalam antrean')
    .addIntegerOption((option) =>
      option
        .setName('from')
        .setDescription('Posisi lagu sekarang')
        .setMinValue(1)
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('to')
        .setDescription('Posisi baru')
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
      const from = interaction.options.getInteger('from', true);
      const to = interaction.options.getInteger('to', true);
      const snapshot = await music.snapshot(guildId);

      // Pengecekan di perintah, bukan diam-diam di service: nomor yang di luar
      // jangkauan adalah kesalahan input yang perlu dijelaskan, bukan kegagalan
      // internal yang harus disembunyikan.
      const size = snapshot.upcoming.length;
      if (size === 0) {
        await interaction.editReply({ embeds: [errorEmbed(t('music.queue.moveEmpty'), t('embed.title.error'))] });
        return;
      }

      if (from > size || to > size) {
        await interaction.editReply({
          embeds: [errorEmbed(t('music.queue.wrongNumber', { count: size }), t('embed.title.error'))],
        });
        return;
      }

      const moved = await music.moveInQueue(guildId, from, to);
      const text =
        moved === null
          ? t('music.queue.moveFailed')
          : from === to
            ? `↔️ ${t('music.queue.moveSame', { track: describeTrack(moved, 90), position: from })}`
            : `↔️ ${t('music.queue.moveDone', { track: describeTrack(moved, 90), from, to })}`;

      await interaction.editReply({
        embeds: [successEmbed(text, `↔️ ${t('music.queue.retitledTitle')}`)],
      });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'move');
    }
  },
} satisfies BotCommand;