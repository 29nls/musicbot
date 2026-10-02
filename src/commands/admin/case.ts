import {
  MessageFlags,
  SlashCommandBuilder,
  type Guild,
  type GuildMember,
} from 'discord.js';
import {
  getLoggingService,
  logEntriesEmbed,
  prioritizeCaseLogs,
  type LogSearchFilter,
} from '../../modules/logging/index.js';
import {
  CASE_HISTORY_LIMIT,
  CASE_LOG_LIMIT,
  caseHistoryEmbed,
  caseLogWindow,
  caseSummaryEmbed,
  formatCaseId,
  parseCaseNumber,
  type CaseTargetState,
  type ModerationAction,
} from '../../modules/moderation/index.js';
import type { BotCommand } from '../../types/command.js';
import { warningEmbed } from '../../utils/embeds.js';
import {
  ADMIN_PERMISSIONS,
  gateAdminCommand,
  handleAdminFailure,
  replyEphemeralError,
} from './_shared.js';

export default {
  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('Ringkasan satu kasus moderasi beserta aksi & log yang terkait')
    .setDefaultMemberPermissions(ADMIN_PERMISSIONS.case.bit)
    .addStringOption((option) =>
      option
        .setName('kasus')
        .setDescription('Nomor kasus — #CASE-0142, 142, atau CASE 142')
        .setRequired(true),
    ),
  category: 'admin',
  guildOnly: true,
  cooldownSeconds: 3,
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const gate = await gateAdminCommand(interaction, ADMIN_PERMISSIONS.case);
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }
      const { ctx } = gate;

      const caseNumber = parseCaseNumber(interaction.options.getString('kasus', true));
      if (caseNumber === null) {
        await replyEphemeralError(
          interaction,
          warningEmbed(
            'Nomor kasus tidak dikenali. Contoh yang diterima: `#CASE-0142`, `142`, atau `CASE 142`.',
            '⚠️ Format Salah',
          ),
        );
        return;
      }

      const record = await ctx.moderation.findCase(ctx.guildId, caseNumber);
      if (!record) {
        await replyEphemeralError(
          interaction,
          warningEmbed(
            `Kasus \`${formatCaseId(caseNumber)}\` tidak ada di server ini.\n` +
              'Nomor kasus berbeda antar server — pastikan memakai nomor dari server ini.',
            '❌ Kasus Tidak Ditemukan',
          ),
        );
        return;
      }

      // Riwayat kasus, log sekitar kasus, dan keadaan target sekarang dibaca
      // bersamaan. Log tidak boleh menggagalkan halaman: kalau database log
      // sedang bermasalah, panelnya kosong tapi ringkasan kasus tetap tampil.
      const [history, logs, state] = await Promise.all([
        ctx.moderation.listTargetCases(ctx.guildId, record.targetId, {
          excludeCaseNumber: record.caseNumber,
          // Satu baris ekstra supaya embed bisa bilang kalau ada yang tersisa.
          take: CASE_HISTORY_LIMIT + 1,
        }),
        getLoggingService()
          .search(logFilterFor(ctx.guildId, record.targetId, caseLogWindow(record)))
          .catch(() => ({ rows: [], total: 0 })),
        readTargetState(ctx.guild, record.type, record.targetId),
      ]);

      await interaction.editReply({
        embeds: [
          caseSummaryEmbed(record, { currentState: state }),
          caseHistoryEmbed(record, history.slice(0, CASE_HISTORY_LIMIT), history.length),
          logEntriesEmbed(prioritizeCaseLogs(logs.rows, caseNumber), {
            title: '📎 Log terkait',
            guildId: ctx.guildId,
            total: logs.total,
            footer:
              'Log sekitar ±1 jam · ' +
              `\`/logs case:${formatCaseId(caseNumber)}\` untuk daftar kasus ini saja`,
          }),
        ],
      });
    } catch (error) {
      await handleAdminFailure(interaction, error, 'case');
    }
  },
} satisfies BotCommand;

/** Log yang menilibkan target kasus dalam jendela waktu ±1 jam. */
function logFilterFor(
  guildId: string,
  targetId: string,
  window: { from: Date; to: Date },
): LogSearchFilter {
  return {
    guildId,
    categories: [],
    caseNumber: null,
    userId: null,
    targetId,
    channelId: null,
    keyword: null,
    from: window.from,
    to: window.to,
    page: 1,
    pageSize: CASE_LOG_LIMIT,
  };
}

/**
 * Keadaan target saat ini — hanya untuk ban & timeout, dua aksi yang masih
 * bisa berubah statusnya setelah dicatat.
 *
 * Kegagalan API tidak boleh menggagalkan halaman kasus, jadi hasilnya null
 * dan embed menandainya sebagai "tidak bisa diperiksa".
 */
async function readTargetState(
  guild: Guild,
  action: ModerationAction,
  targetId: string,
): Promise<CaseTargetState | null> {
  if (action === 'ban') {
    const banned = await guild.bans.fetch(targetId).then(
      () => true,
      () => false,
    );
    return { banned, timeoutUntil: null };
  }

  if (action === 'timeout') {
    const member = await guild.members
      .fetch({ user: targetId })
      .catch(() => null as GuildMember | null);
    if (!member) return null;

    return { banned: null, timeoutUntil: member.communicationDisabledUntil };
  }

  return null;
}
