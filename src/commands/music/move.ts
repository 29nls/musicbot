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

      const from = interaction.options.getInteger('from', true);
      const to = interaction.options.getInteger('to', true);
      const snapshot = await gate.ctx.music.snapshot(gate.ctx.guildId);

      // Pengecekan di perintah, bukan diam-diam di service: nomor yang di luar
      // jangkauan adalah kesalahan input yang perlu dijelaskan, bukan kegagalan
      // internal yang harus disembunyikan.
      const size = snapshot.upcoming.length;
      if (size === 0) {
        await interaction.editReply({ embeds: [errorEmbed('Antrean sedang kosong.')] });
        return;
      }

      if (from > size || to > size) {
        await interaction.editReply({
          embeds: [
            errorEmbed(`Antrean hanya berisi ${size} lagu. Periksa nomornya dengan \`/queue\`.`),
          ],
        });
        return;
      }

      const moved = await gate.ctx.music.moveInQueue(gate.ctx.guildId, from, to);
      const text =
        moved === null
          ? 'Posisi tidak bisa dipindahkan. Periksa nomor yang dimasukkan.'
          : from === to
            ? `↔️ ${describeTrack(moved, 90)} sudah berada di posisi **${from}**.`
            : `↔️ ${describeTrack(moved, 90)} dipindahkan dari **${from}** ke **${to}**.`;

      await interaction.editReply({
        embeds: [successEmbed(text, '↔️ Antrean Ditata ulang')],
      });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'move');
    }
  },
} satisfies BotCommand;