import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { getGuildConfigService } from '../../modules/config/index.js';
import { defaultTranslator, translatorFor, type Translator } from '../../modules/i18n/index.js';
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
    if (!interaction.inGuild()) {
      await interaction.reply({
        embeds: [warningEmbed(defaultTranslator('mod.gate.guildOnly'), defaultTranslator('embed.title.warning'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guildId = interaction.guildId;
    const t = await translatorFor(guildId);

    // Lapis kedua: Discord sudah menyembunyikan perintah di server tanpa izin
    // ini, tapi moderator pun bisa membukanya secara manual.
    if (!canManageGuild(interaction)) {
      await interaction.reply({
        embeds: [warningEmbed(t('mod.gate.needsPermission', { permission: 'Manage Server' }), t('embed.title.warning'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Disimpan di sini: penyempitan `interaction.guild` hilang setelah await.
    const guildName = interaction.guild?.name ?? undefined;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const config = await getGuildConfigService().get(guildId);

      if (!config.modules.logging) {
        await interaction.editReply({
          embeds: [
            warningEmbed(t('log.cmd.moduleOff'), t('log.cmd.moduleOffTitle')),
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
          embeds: [warningEmbed(t('log.cmd.conflict'), t('log.cmd.conflictTitle'))],
        });
        return;
      }

      if (wantStats) {
        await sendStats(interaction, filter, t);
        return;
      }

      const effective =
        format === null
          ? filter
          : { ...filter, page: 1, pageSize: EXPORT_MAX_ROWS };

      const { rows, total } = await getLoggingService().search(effective);

      if (format !== null) {
        await sendExport(interaction, guildId, guildName, format, effective, rows, total, t);
        return;
      }
      const description = describeLogFilter(filter, t);

      if (rows.length === 0) {
        await interaction.editReply({
          embeds: [
            infoEmbed(
              t('log.results.title'),
              t('log.results.noMatch', { filter: description }),
            ).addFields({
              name: t('log.cmd.checkAgain'),
              value: t('log.cmd.checkAgainHistory', { days: DEFAULT_LOG_RETENTION_DAYS }),
            }),
          ],
        });
        return;
      }

      await interaction.editReply({
        embeds: [
          logResultsEmbed(
            rows,
            {
              guildId,
              page: filter.page,
              pageSize: filter.pageSize,
              total,
            },
            t,
          ).setDescription(description),
        ],
      });
    } catch (error) {
      await interaction.editReply({ embeds: [toLoggingErrorEmbed(error, t)] });
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
  t: Translator,
): Promise<void> {
  const period = statsPeriod(filter);
  const stats = await getLoggingService().stats({ ...filter, from: period.from, to: period.to });

  if (stats.total === 0) {
    await interaction.editReply({
      embeds: [
        infoEmbed(
          t('log.stats.title'),
          t('log.results.noMatch', { filter: describeLogFilter(filter, t) }),
        ).addFields({
          name: t('log.cmd.checkAgain'),
          value: t('log.cmd.checkAgainStats', { days: DEFAULT_LOG_RETENTION_DAYS }),
        }),
      ],
    });
    return;
  }

  await interaction.editReply({ embeds: [logStatsEmbed(stats, { filter, period }, t)] });
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
  t: Translator,
): Promise<void> {
  const file = buildLogExport({ format, records: rows, guildId, guildName, total, filter });

  if (file.bytes > EXPORT_MAX_BYTES) {
    await interaction.editReply({
      embeds: [
        warningEmbed(
          t('log.export.tooBig', { size: Math.round(file.bytes / 1024 / 1024) }),
          t('log.export.tooBigTitle'),
        ),
      ],
    });
    return;
  }

  const saved = await saveLogExport(file);
  const lines = [
    t('log.export.collected', {
      exported: file.exported,
      total,
      categories: describeExportCategories(filter, t),
    }),
    file.truncated ? t('log.export.truncated', { max: EXPORT_MAX_ROWS }) : null,
    saved ? t('log.export.saved', { path: saved }) : null,
    t('log.export.attachment', { file: file.filename, size: formatKb(file.bytes) }),
  ].filter((line): line is string => line !== null);

  await interaction.editReply({
    embeds: [successEmbed(lines.join('\n'), t('log.export.title'))],
    files: [{ attachment: Buffer.from(file.content, 'utf8'), name: file.filename }],
  });
}

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}
