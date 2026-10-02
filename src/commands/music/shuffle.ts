import { SlashCommandBuilder } from 'discord.js';
import type { BotCommand } from '../../types/command.js';
import { infoEmbed, successEmbed } from '../../utils/embeds.js';
import { gateMusicCommand, handleMusicFailure, replyEphemeralError } from './_shared.js';

export default {
  data: new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Acak urutan lagu yang akan diputar berikutnya'),
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

      const shuffled = gate.ctx.music.shuffle(gate.ctx.guildId);
      const embed =
        shuffled <= 1
          ? // Kurang dari dua lagu, "mengacak" tidak mengubah apa pun. Menyebutnya
            // berhasil akan membohongi hasil yang tidak terjadi.
            infoEmbed('🎲 Antrean terlalu pendek untuk diacak', 'Butuh minimal dua lagu di antrean.')
          : successEmbed(`🎲 **${shuffled}** lagu diacak urutannya.`, '🎲 Antrean Diacak');

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'shuffle');
    }
  },
} satisfies BotCommand;