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
      // Gerbang lebih dulu daripada parse mode: penerjemah `t` berasal dari
      // gerbang itu, dan member yang memang tidak boleh mengubah filter atau
      // loop lebih butuh tahu izin atau modulnya mati daripada tahu mode-nya
      // salah ketik.
      const gate = await gateMusicCommand(interaction, { voice: true, control: true });
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }

      const { music, guildId, t } = gate.ctx;

      const mode = parseFilterMode(interaction.options.getString('mode', true));
      if (!mode) {
        await interaction.editReply({
          embeds: [
            errorEmbed(t('music.filter.unknownMode', { options: filterModeHint() }), t('embed.title.error')),
          ],
        });
        return;
      }
      const { previous, applied } = await music.setFilterMode(guildId, mode);
      const emoji = MODE_EMOJI[mode] ?? '🎛️';
      const from = filterModeLabel(previous, t);
      const to = filterModeLabel(mode, t);
      const text =
        mode === 'off'
          ? t('music.filter.disabledText', { emoji, from })
          : t('music.filter.changedText', { emoji, from, to });

      // Player Lavalink belum ada berarti belum ada yang diputar: mode tersimpan
      // dan diterapkan saat pemutaran pertama dimulai — bukan gagal.
      await interaction.editReply({
        embeds: [
          successEmbed(
            applied ? text : `${text}\n${t('music.filter.pending')}`,
            `🎛️ ${t('music.filter.title')}`,
          ),
        ],
      });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'filter');
    }
  },
} satisfies BotCommand;
