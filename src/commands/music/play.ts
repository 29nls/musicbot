import { SlashCommandBuilder } from 'discord.js';
import type { BotCommand } from '../../types/command.js';
import { gateMusicCommand, handleMusicFailure, renderPlayOutcome, replyEphemeralError } from './_shared.js';

export default {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Putar lagu atau tambahkan ke antrean')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('Judul lagu, kata kunci, atau URL (YouTube/SoundCloud)')
        .setRequired(true),
    ),
  category: 'music',
  guildOnly: true,
  // PRD §6.2: "User spam /play (> 5/menit) → Cooldown 10 detik dengan pesan sisa waktu".
  cooldownSeconds: 10,
  async execute(interaction, _client) {
    await interaction.deferReply();

    try {
      const gate = await gateMusicCommand(interaction, { voice: true });
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }

      const outcome = await gate.ctx.music.play({
        guildId: gate.ctx.guildId,
        query: interaction.options.getString('query', true),
        requesterId: interaction.user.id,
        voiceChannelId: gate.ctx.voiceChannelId,
        shardId: gate.ctx.guild.shardId,
      });

      await interaction.editReply({ embeds: [renderPlayOutcome(outcome)] });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'play');
    }
  },
} satisfies BotCommand;
