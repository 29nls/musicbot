import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { getGuildConfigService } from '../../modules/config/index.js';
import {
  CATEGORY_META,
  DEFAULT_LOG_RETENTION_DAYS,
  EXPORT_MAX_BYTES,
  EXPORT_MAX_ROWS,
  LOG_CATEGORIES,
  buildLogExport,
  describeExportCategories,
  describeLogFilter,
  getLoggingService,
  logResultsEmbed,
  logStatsEmbed,
  parseLogSearch,
  saveLogExport,
  statsPeriod,
  toLoggingErrorEmbed,
  type LogExportFormat,
  type LogRecord,
  type LogSearchFilter,
} from '../../modules/logging/index.js';
import type { BotCommand } from '../../types/command.js';
import { infoEmbed, successEmbed, warningEmbed } from '../../utils/embeds.js';
import { canManageGuild } from '../../utils/permissions.js';

const CATEGORY_CHOICES = LOG_CATEGORIES.map((category) => ({
  name: CATEGORY_META[category].label,
  value: category,
}));

export default {
  data: new SlashCommandBuilder()
    .setName('logs')
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
    )
    .addBooleanOption((option) =>
      option
        .setName('stats')
        .setDescription('Tampilkan statistik ringkas untuk periode ini, bukan daftar entri'),
    )
    .addStringOption((option) =>
      option
        .setName('format')
        .setDescription('Ekspor hasil pencarian sebagai file (JSON atau CSV)')
        .addChoices(
          { name: 'JSON (audit lengkap + filter)', value: 'json' },
          { name: 'CSV (buka di Excel/Sheets)', value: 'csv' },
        ),
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
    // Disimpan di sini: penyempitan `interaction.guild` hilang setelah await.
    const guildName = interaction.guild?.name ?? undefined;
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

      // Mode ekspor: ambil hasil terbanyak sekaligus, bukan satu halaman.
      const format = interaction.options.getString('format') as LogExportFormat | null;
      const wantStats = interaction.options.getBoolean('stats') ?? false;

      if (wantStats && format !== null) {
        await interaction.editReply({
          embeds: [
            warningEmbed(
              'Opsi `stats` dan `format` tidak bisa dipakai bersamaan.\n' +
                'Jalankan `/logs stats:true` untuk ringkasan di Discord, ' +
                'atau `/logs format:…` untuk mengunduh data mentahnya.',
              '⚠️ Mode Bertabrakan',
            ),
          ],
        });
        return;
      }

      if (wantStats) {
        await sendStats(interaction, filter);
        return;
      }

      const effective =
        format === null
          ? filter
          : { ...filter, page: 1, pageSize: EXPORT_MAX_ROWS };

      const { rows, total } = await getLoggingService().search(effective);

      if (format !== null) {
        await sendExport(interaction, guildId, guildName, format, effective, rows, total);
        return;
      }
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

/**
 * Statistik ringkas untuk satu periode: jumlah event per kategori, aksi yang
 * paling sering muncul, dan member yang paling sering terlibat.
 *
 * Tanpa `from`, periode dibatasi ke masa simpan riwayat supaya angkanya
 * jujur dan query-nya tetap ringan.
 */
async function sendStats(
  interaction: ChatInputCommandInteraction,
  filter: LogSearchFilter,
): Promise<void> {
  const period = statsPeriod(filter);
  const stats = await getLoggingService().stats({ ...filter, from: period.from, to: period.to });

  if (stats.total === 0) {
    await interaction.editReply({
      embeds: [
        infoEmbed(
          '📊 Statistik Log',
          `Tidak ada entri yang cocok.\n\n**Filter:** ${describeLogFilter(filter)}`,
        ).addFields({
          name: 'Cek lagi',
          value:
            'Statistik dihitung dari riwayat yang tersimpan ' +
            `sepanjang ${DEFAULT_LOG_RETENTION_DAYS} hari terakhir. ` +
            'Perlebar rentang tanggal (`from:`/`to:`) atau kosongkan filter.',
        }),
      ],
    });
    return;
  }

  await interaction.editReply({ embeds: [logStatsEmbed(stats, { filter, period })] });
}

/**
 * Kirim hasil pencarian sebagai lampiran (unduhan) sekaligus mengarsipkannya di
 * host. Format JSON menyimpan filter asal supaya arsip bisa ditelusuri kembali.
 */
async function sendExport(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  guildName: string | undefined,
  format: LogExportFormat,
  filter: LogSearchFilter,
  rows: LogRecord[],
  total: number,
): Promise<void> {
  const file = buildLogExport({ format, records: rows, guildId, guildName, total, filter });

  if (file.bytes > EXPORT_MAX_BYTES) {
    await interaction.editReply({
      embeds: [
        warningEmbed(
          `File ekspor terlalu besar (${Math.round(file.bytes / 1024 / 1024)} MB).\n` +
            'Persempit dengan filter kategori, user, atau rentang tanggal lalu coba lagi.',
          '⚠️ Ekspor Terlalu Besar',
        ),
      ],
    });
    return;
  }

  const saved = await saveLogExport(file);
  const lines = [
    `Menhimpun **${file.exported}** dari **${total}** entri (${describeExportCategories(filter)}).`,
    file.truncated
      ? `⚠️ Dipotong di ${EXPORT_MAX_ROWS} entri terbaru — perlebar atau persempit filter agar lengkap.`
      : null,
    saved ? `📁 Tersimpan di server: \`${saved}\`` : null,
    `📎 Lampiran: \`${file.filename}\` (${formatKb(file.bytes)})`,
  ].filter((line): line is string => line !== null);

  await interaction.editReply({
    embeds: [successEmbed(lines.join('\n'), '📤 Ekspor Log Selesai')],
    files: [{ attachment: Buffer.from(file.content, 'utf8'), name: file.filename }],
  });
}

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}
