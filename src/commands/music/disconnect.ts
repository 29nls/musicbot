import { SlashCommandBuilder } from 'discord.js';
import type { BotCommand } from '../../types/command.js';
import { successEmbed } from '../../utils/embeds.js';
import { gateMusicCommand, handleMusicFailure, replyEphemeralError } from './_shared.js';

export default {
  data: new SlashCommandBuilder()
    .setName('disconnect')
    .setDescription('Keluarkan bot dari voice channel dan kosongkan antrean'),
  category: 'music',
  guildOnly: true,
  cooldownSeconds: 3,
  async execute(interaction, _client) {
    await interaction.deferReply();

    try {
      const gate = await gateMusicCommand(interaction, { voice: true, control: true });
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }

      const { music, guildId } = gate.ctx;
      const hadConnection = music.botVoiceChannelId(guildId) !== null;

      await music.disconnect(guildId);

      // `disconnect` sengaja idempoten supaya perintah ini aman dipanggil saat
      // bot kebetulan sudah di luar — tapi tetap harus menyatakan bahwa tidak ada
      // yang terjadi, bukan mengklaim berhasil mengubah sesuatu.
      const text = hadConnection
        ? '👋 Saya keluar dari voice channel. Antrean sudah dikosongkan.'
        : 'Saya memang tidak sedang berada di voice channel mana pun.';

      await interaction.editReply({ embeds: [successEmbed(text, '👋 Bot Keluar')] });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'disconnect');
    }
  },
} satisfies BotCommand;