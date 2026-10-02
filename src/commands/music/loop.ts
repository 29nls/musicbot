import { SlashCommandBuilder } from 'discord.js';
import { loopModeHint, loopModeLabel, parseLoopMode } from '../../modules/music/index.js';
import type { BotCommand } from '../../types/command.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { gateMusicCommand, handleMusicFailure, replyEphemeralError } from './_shared.js';

export default {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Atur mode pengulangan: satu lagu atau seluruh antrean')
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('off / track / queue')
        .setRequired(true)
        .setMaxLength(20),
    ),
  category: 'music',
  guildOnly: true,
  cooldownSeconds: 2,
  async execute(interaction, _client) {
    await interaction.deferReply();

    try {
      const mode = parseLoopMode(interaction.options.getString('mode', true));
      if (!mode) {
        await interaction.editReply({
          embeds: [errorEmbed(`Mode tidak dikenal. Pilihan yang tersedia: ${loopModeHint()}.`)],
        });
        return;
      }

      const gate = await gateMusicCommand(interaction, { voice: true, control: true });
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }

      const previous = gate.ctx.music.setLoopMode(gate.ctx.guildId, mode);
      const from = loopModeLabel(previous);
      const to = loopModeLabel(mode);
      const text =
        mode === 'off'
          ? `🔁 Loop dimatikan (sebelumnya ${from}).`
          : `🔁 Loop diubah dari ${from} ke **${to}**.`;

      await interaction.editReply({ embeds: [successEmbed(text, '🔁 Mode Loop')] });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'loop');
    }
  },
} satisfies BotCommand;