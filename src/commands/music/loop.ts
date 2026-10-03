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

      const { music, guildId, t } = gate.ctx;
      const previous = await music.setLoopMode(guildId, mode);
      const from = loopModeLabel(previous, t);
      const to = loopModeLabel(mode, t);
      const text =
        mode === 'off'
          ? `🔁 ${t('music.loop.disabledText', { from })}`
          : `🔁 ${t('music.loop.changedText', { from, to })}`;

      await interaction.editReply({ embeds: [successEmbed(text, `🔁 ${t('music.loop.title')}`)] });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'loop');
    }
  },
} satisfies BotCommand;