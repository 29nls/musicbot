import { SlashCommandBuilder } from 'discord.js';
import { describeTrack } from '../../modules/music/index.js';
import type { BotCommand } from '../../types/command.js';
import { successEmbed } from '../../utils/embeds.js';
import { gateMusicCommand, handleMusicFailure, replyEphemeralError } from './_shared.js';

export default {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Lewati lagu yang sedang diputar'),
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

      const { skipped, next } = await gate.ctx.music.skip(gate.ctx.guildId);
      const lines: string[] = [];

      if (skipped) lines.push(`⏭️ Melewati ${describeTrack(skipped, 80)}`);
      if (next) lines.push(`▶️ Sekarang diputar: ${describeTrack(next, 80)}`);
      else lines.push('Antrean habis. Bot keluar otomatis kalau tidak ada lagu baru.');

      await interaction.editReply({
        embeds: [successEmbed(lines.join('\n'), '⏭️ Lagu Dilewati')],
      });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'skip');
    }
  },
} satisfies BotCommand;
