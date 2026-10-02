import { SlashCommandBuilder } from 'discord.js';
import {
  filterModeHint,
  filterModeLabel,
  parseFilterMode,
} from '../../modules/music/index.js';
import type { BotCommand } from '../../types/command.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { gateMusicCommand, handleMusicFailure, replyEphemeralError } from './_shared.js';

const MODE_EMOJI: Record<string, string> = {
  off: '🔊',
  bassboost: '🎚️',
  nightcore: '🐿️',
  vaporwave: '🌴',
  '8d': '🎧',
};

export default {
  data: new SlashCommandBuilder()
    .setName('filter')
    .setDescription('Ubah warna suara musik: bassboost, nightcore, vaporwave, atau 8D')
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('off / bassboost / nightcore / vaporwave / 8d')
        .setRequired(true)
        .setMaxLength(20),
    ),
  category: 'music',
  guildOnly: true,
  cooldownSeconds: 2,
  async execute(interaction, _client) {
    await interaction.deferReply();

    try {
      const mode = parseFilterMode(interaction.options.getString('mode', true));
      if (!mode) {
        await interaction.editReply({
          embeds: [errorEmbed(`Mode tidak dikenal. Pilihan yang tersedia: ${filterModeHint()}.`)],
        });
        return;
      }

      const gate = await gateMusicCommand(interaction, { voice: true, control: true });
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }

      const { previous, applied } = await gate.ctx.music.setFilterMode(gate.ctx.guildId, mode);
      const emoji = MODE_EMOJI[mode] ?? '🎛️';
      const text =
        mode === 'off'
          ? `${emoji} Filter dimatikan (sebelumnya ${filterModeLabel(previous)}).`
          : `${emoji} Filter diubah dari ${filterModeLabel(previous)} ke **${filterModeLabel(mode)}**.`;

      // Player Lavalink belum ada berarti belum ada yang diputar: mode tersimpan
      // dan diterapkan saat pemutaran pertama dimulai — bukan gagal.
      await interaction.editReply({
        embeds: [
          successEmbed(
            applied ? text : `${text}\nAkan berlaku saat pemutaran dimulai.`,
            '🎛️ Filter Audio',
          ),
        ],
      });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'filter');
    }
  },
} satisfies BotCommand;
