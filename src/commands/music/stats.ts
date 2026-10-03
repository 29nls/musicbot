import { SlashCommandBuilder } from 'discord.js';
import { getStatsService, isStatKind, statsEmbed, STAT_MAX_DAYS } from '../../modules/stats/index.js';
import type { StatKind } from '../../modules/stats/index.js';
import type { BotCommand } from '../../types/command.js';
import { getLogger } from '../../services/logger.js';
import { errorEmbed } from '../../utils/embeds.js';

/**
 * `/stats` — statistik playback & pemakaian perintah (Fase 3, PRD §5.3).
 *
 * **Perintah ini sengaja tanpa gerbang izin.** Isinya agregat per server dan
 * tidak menyimpan siapa pun (§12): berapa kali sebuah lagu diputar di server
 * ini, dan perintah apa yang paling sering dipakai. Menutupnya di balik Manage
 * Server hanya akan membuat owner server tidak bisa melihat activity
 * server-nya sendiri, tanpa melindungi data apa pun.
 *
 * Yang TIDAK pernah tampil di sini: siapa yang memutar apa, kapan, dari channel
 * mana, dan apa yang mereka cari. Itu memang tidak pernah dicatat sama sekali.
 */
export default {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Statistik lagu & perintah di server ini')
    .addStringOption((option) =>
      option
        .setName('jenis')
        .setDescription('Lagu yang diputar atau perintah yang dipakai')
        .addChoices(
          { name: 'Lagu (statistik musik)', value: 'track' },
          { name: 'Perintah', value: 'command' },
        ),
    )
    .addIntegerOption((option) =>
      option
        .setName('periode')
        .setDescription('Berapa hari terakhir yang dihitung (maksimum 90)')
        .setMinValue(1)
        .setMaxValue(STAT_MAX_DAYS),
    ),
  category: 'music',
  guildOnly: true,
  cooldownSeconds: 5,
  async execute(interaction, _client) {
    await interaction.deferReply();

    try {
      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.editReply({ embeds: [errorEmbed('Statistik hanya tersedia di dalam server.')] });
        return;
      }

      const requested = interaction.options.getString('jenis') ?? 'track';
      const kind: StatKind = isStatKind(requested) ? requested : 'track';
      const days = interaction.options.getInteger('periode') ?? undefined;

      const summary = await getStatsService().summary({ guildId, kind, days });
      await interaction.editReply({ embeds: [statsEmbed(summary)] });
    } catch (error) {
      // Kegagalan di sini harus terlihat: menampilkan nol saat database bermasalah
      // berarti angkanya jadi bohong, bukan sekadar kosong.
      getLogger().error(
        { err: error, guild: interaction.guildId },
        'Gagal memuat statistik',
      );

      await interaction.editReply({
        embeds: [errorEmbed('Statistik tidak bisa dimuat sekarang. Detailnya sudah dicatat di log bot.')],
      });
    }
  },
} satisfies BotCommand;