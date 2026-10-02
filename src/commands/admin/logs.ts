import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { getGuildConfigService } from '../../modules/config/index.js';
import {
  CATEGORY_META,
  DEFAULT_LOG_RETENTION_DAYS,
  LOG_CATEGORIES,
  describeLogFilter,
  getLoggingService,
  logResultsEmbed,
  parseLogSearch,
  toLoggingErrorEmbed,
} from '../../modules/logging/index.js';
import type { BotCommand } from '../../types/command.js';
import { infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { canManageGuild } from '../../utils/permissions.js';

const CATEGORY_CHOICES = LOG_CATEGORIES.map((category) => ({
  name: CATEGORY_META[category].label,
  value: category,
}));

export default {
  data: new SlashCommandBuilder()        .setName('logs')
    .setDescription('Cari riwayat log server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName('category')
        .setDescription('Kategori event — beberapa kategori dipisahkan koma')
        .addChoices(...CATEGORY_CHOICES),
    )
    .addUserOption((option) =>
      option.setName('user').setDescription('Member yang kena aksi atau yang melakukannya'),
    )
    .addChannelOption((option) =>
      option.setName('channel').setDescription('Channel tempat aksi terjadi'),
    )
    .addStringOption((option) =>
      option.setName('keyword').setDescription('Kata kunci di isi embed log'),
    )
    .addStringOption((option) =>
      option
        .setName('case')
        .setDescription('Hanya aksi dari satu kasus Harmony, mis. #CASE-0142'),
    )
    .addStringOption((option) =>
      option
        .setName('from')
        .setDescription('Batas awal — relatif (7d, 24h) atau kalender (2026-10-01)'),
    )
    .addStringOption((option) =>
      option.setName('to').setDescription('Batas akhir — relatif (30m) atau kalender (02/10/2026)'),
    )
    .addIntegerOption((option) =>
      option.setName('page').setDescription('Halaman hasil').setMinValue(1),
    ),
  category: 'admin',
  guildOnly: true,
  cooldownSeconds: 5,
  async execute(interaction) {
    if (!interaction.inGuild() || !canManageGuild(interaction)) {
      await interaction.reply({
        embeds: [warningEmbed('Perintah ini butuh izin **Manage Server**.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guildId = interaction.guildId;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const config = await getGuildConfigService().get(guildId);

      if (!config.modules.logging) {
        await interaction.editReply({
          embeds: [
            warningEmbed(
              'Modul logging sedang mati, jadi tidak ada riwayat yang dikumpulkan.\n' +
                'Nyalakan dengan `/config set logging:true` lalu tunggu event berikutnya tercatat.',
              '❌ Logging Mati',
            ),
          ],
        });
        return;
      }

      const filter = parseLogSearch(guildId, {
        category: interaction.options.getString('category'),
        userId: interaction.options.getUser('user')?.id ?? null,
        channelId: interaction.options.getChannel('channel')?.id ?? null,
        keyword: interaction.options.getString('keyword'),
        caseNumber: interaction.options.getString('case'),
        from: interaction.options.getString('from'),
        to: interaction.options.getString('to'),
        page: interaction.options.getInteger('page'),
      });

      const { rows, total } = await getLoggingService().search(filter);
      const description = describeLogFilter(filter);

      if (rows.length === 0) {
        await interaction.editReply({
          embeds: [
            infoEmbed(
              '🔎 Riwayat Log',
              `Tidak ada entri yang cocok.\n\n**Filter:** ${description}`,
            ).addFields({
              name: 'Cek lagi',
              value:
                'Riwayat hanya berisi event yang terjadi setelah modul logging dinyalakan, ' +
                `dan disimpan selama ${DEFAULT_LOG_RETENTION_DAYS} hari. ` +
                'Perlebar rentang tanggal atau kosongkan filter.',
            }),
          ],
        });
        return;
      }

      await interaction.editReply({
        embeds: [
          logResultsEmbed(rows, {
            guildId,
            page: filter.page,
            pageSize: filter.pageSize,
            total,
          }).setDescription(description),
        ],
      });
    } catch (error) {
      await interaction.editReply({ embeds: [toLoggingErrorEmbed(error)] });
    }
  },
} satisfies BotCommand;
