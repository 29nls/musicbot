import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../../config/constants.js';
import { defaultTranslator, type Translator } from '../i18n/index.js';
import { formatCaseId } from './caseNumber.js';
import {
  caseHistoryLine,
  caseReasonText,
  caseTargetKind,
  currentStateLines,
  describeCaseStatus,
  dmDeliveryLine,
  type CaseTargetState,
} from './caseView.js';
import {
  moderatorActionLines,
  moderatorCaseLine,
  moderatorOverviewLines,
  moderatorTargetKind,
  type ModeratorProfile,
} from './modProfile.js';
import {
  priorCaseNoteLines,
  priorCaseRecentLines,
  type PriorCaseSummary,
} from './priorCases.js';
import {
  actionEmoji,
  actionLabel,
  type ModerationAction,
  type ModerationCase,
  type NotifiableAction,
  type WarningRecord,
} from './types.js';

const toUnix = (date: Date): number => Math.floor(date.getTime() / 1_000);

/** Target aksi bisa berupa user (default) atau channel. */
export type TargetKind = 'user' | 'channel';

const formatTarget = (id: string, kind: TargetKind = 'user'): string =>
  kind === 'channel' ? `<#${id}>` : `<@${id}>`;

const ACTION_COLORS: Record<ModerationAction, number> = {
  ban: EMBED_COLORS.error,
  kick: EMBED_COLORS.warning,
  timeout: EMBED_COLORS.warning,
  warn: EMBED_COLORS.warning,
  unban: EMBED_COLORS.success,
  slowmode: EMBED_COLORS.primary,
  lock: EMBED_COLORS.warning,
  unlock: EMBED_COLORS.success,
  note: EMBED_COLORS.primary,
};

/**
 * Alasan yang dipotong ke batas field Discord.
 *
 * Nilai bakanya "tidak disebutkan" sedikit berbeda dari `caseReasonText`,
 * yang memakai bentuk miring — pemanggilnya sudah punya konteks soal field
 * mana yang sedang diisi, jadi bentuknya tidak selalu sama.
 */
const trimReason = (reason: string | null, t: Translator = defaultTranslator): string =>
  reason ? reason.slice(0, 1_000) : t('mod.reason.missing');

export interface ModerationLogInput {
  action: ModerationAction;
  caseNumber: number;
  targetId: string;
  targetKind?: TargetKind;
  moderatorId: string;
  reason: string | null;
  createdAt?: Date;
  expiresAt?: Date | null;
  /** undefined = tidak relevan (mis. aksi channel & catatan). */
  dmSent?: boolean;
}

/** Embed yang dikirim ke channel log server untuk setiap aksi moderasi. */
export function moderationLogEmbed(
  input: ModerationLogInput,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(ACTION_COLORS[input.action])
    .setTitle(
      `${actionEmoji(input.action)} ${actionLabel(input.action, t)} — ${formatCaseId(input.caseNumber)}`,
    )
    .addFields(
      { name: t('mod.field.case'), value: `\`${formatCaseId(input.caseNumber)}\``, inline: true },
      { name: t('mod.field.target'), value: formatTarget(input.targetId, input.targetKind), inline: true },
      { name: t('mod.field.moderator'), value: `<@${input.moderatorId}>`, inline: true },
      { name: t('mod.field.reason'), value: trimReason(input.reason, t) },
    )
    .setTimestamp(input.createdAt ?? new Date());

  if (input.expiresAt) {
    embed.addFields({ name: t('mod.field.expires'), value: `<t:${toUnix(input.expiresAt)}:R>` });
  }

  if (input.dmSent !== undefined) {
    embed.setFooter({ text: input.dmSent ? t('mod.dm.sent') : t('mod.dm.closed') });
  }

  return embed;
}

export interface ModerationDmInput {
  action: NotifiableAction;
  caseNumber: number;
  guildName: string;
  reason: string | null;
  expiresAt?: Date | null;
}

/**
 * Kunci katalog untuk judul DM.
 *
 * Emoji ikut di dalam nilainya, bukan di luar, karena tiap Judul punya ikon
 * sendiri dan memisahkannya jadi dua peta hanya menambah tempat salah ketik.
 */
const DM_TITLE_KEYS: Record<
  NotifiableAction,
  'mod.dm.banTitle' | 'mod.dm.kickTitle' | 'mod.dm.timeoutTitle' | 'mod.dm.warnTitle' | 'mod.dm.unbanTitle'
> = {
  ban: 'mod.dm.banTitle',
  kick: 'mod.dm.kickTitle',
  timeout: 'mod.dm.timeoutTitle',
  warn: 'mod.dm.warnTitle',
  unban: 'mod.dm.unbanTitle',
};

/** DM yang dikirim ke target — selalu berisi ID kasus. */
export function moderationDmEmbed(
  input: ModerationDmInput,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(input.action === 'ban' ? EMBED_COLORS.error : EMBED_COLORS.warning)
    .setTitle(t(DM_TITLE_KEYS[input.action], { server: input.guildName }))
    .setDescription(t('mod.dm.contactModerator'))
    .addFields({ name: t('mod.field.case'), value: `\`${formatCaseId(input.caseNumber)}\``, inline: true });

  if (input.reason) embed.addFields({ name: t('mod.field.reason'), value: trimReason(input.reason, t) });
  if (input.expiresAt) {
    embed.addFields({ name: t('mod.field.expires'), value: `<t:${toUnix(input.expiresAt)}:R>` });
  }

  return embed;
}

export interface ModerationResultInput {
  action: ModerationAction;
  caseNumber: number;
  targetId: string;
  targetKind?: TargetKind;
  reason: string | null;
  expiresAt?: Date | null;
  extraLines?: string[];
}

/** Balasan setelah aksi berhasil — menampilkan ID kasus. */
export function moderationResultEmbed(
  input: ModerationResultInput,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(ACTION_COLORS[input.action])
    .setTitle(
      `${actionEmoji(input.action)} ${actionLabel(input.action, t)} ${t('mod.action.successSuffix')}`,
    )
    .addFields(
      { name: t('mod.field.case'), value: `\`${formatCaseId(input.caseNumber)}\``, inline: true },
      { name: t('mod.field.target'), value: formatTarget(input.targetId, input.targetKind), inline: true },
    )
    .setTimestamp();

  if (input.reason) {
    embed.addFields({ name: t('mod.field.reason'), value: trimReason(input.reason, t) });
  }
  if (input.expiresAt) {
    embed.addFields({ name: t('mod.field.expires'), value: `<t:${toUnix(input.expiresAt)}:R>` });
  }
  if (input.extraLines && input.extraLines.length > 0) {
    embed.setDescription(input.extraLines.join('\n'));
  }

  return embed;
}

/** DM pemberitahuan saat warning dicabut. */
export function warningRevokedDmEmbed(
  input: { caseNumber: number; guildName: string; moderatorId: string },
  t: Translator = defaultTranslator,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.success)
    .setTitle(t('mod.dm.revokedTitle', { server: input.guildName }))
    .setDescription(
      t('mod.dm.revokedBody', {
        case: formatCaseId(input.caseNumber),
        moderator: input.moderatorId,
      }),
    )
    .setTimestamp();
}

/** Log saat warning dicabut (kasus asli ditandai tidak aktif, tidak dihapus). */
export function warningRevokedLogEmbed(
  input: { caseNumber: number; targetId: string; moderatorId: string },
  t: Translator = defaultTranslator,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.success)
    .setTitle(`♻️ ${t('mod.log.revokedTitle')} — ${formatCaseId(input.caseNumber)}`)
    .addFields(
      { name: t('mod.field.target'), value: `<@${input.targetId}>`, inline: true },
      { name: t('mod.field.moderator'), value: `<@${input.moderatorId}>`, inline: true },
    )
    .setTimestamp();
}

/** Embed daftar peringatan satu member. */
export function warningsEmbed(
  target: { id: string; tag: string },
  warnings: WarningRecord[],
  total: number,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.warning)
    .setTitle(t('mod.warnings.title', { target: target.tag }))
    .setFooter({ text: t('mod.warnings.footer', { count: total }) })
    .setTimestamp();

  if (warnings.length === 0) {
    return embed.setDescription(t('mod.warnings.empty'));
  }

  const lines = warnings.map(
    (warning) =>
      `**\`${formatCaseId(warning.caseNumber)}\`** • <t:${toUnix(warning.createdAt)}:R> • ${t('mod.audit.mention', { moderator: warning.moderatorId })}\n` +
      `> ${warning.reason ? warning.reason.slice(0, 150) : t('mod.reason.noneShort')}`,
  );

  return embed.setDescription(lines.join('\n\n').slice(0, 4_000));
}

/** Embed daftar catatan internal satu member. */
export function notesEmbed(
  target: { id: string; tag: string },
  notes: ModerationCase[],
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle(t('mod.notes.title', { target: target.tag }))
    .setTimestamp();

  if (notes.length === 0) {
    return embed.setDescription(t('mod.notes.empty'));
  }

  const lines = notes.map(
    (note) =>
      `**\`${formatCaseId(note.caseNumber)}\`** • <t:${toUnix(note.createdAt)}:R> • ${t('mod.audit.mention', { moderator: note.moderatorId })}\n` +
      `> ${note.reason ? note.reason.slice(0, 200) : t('mod.reason.noneNote')}`,
  );

  return embed
    .setDescription(lines.join('\n\n').slice(0, 4_000))
    .setFooter({ text: t('mod.notes.footer', { count: notes.length }) });
}

/** Embed yang dicatat ke channel log setiap kali `/purge` dijalankan. */
export function purgeLogEmbed(
  input: {
    moderatorId: string;
    channelId: string;
    deleted: number;
    filters: string[];
  },
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.warning)
    .setTitle(t('mod.log.purgeTitle'))
    .addFields(
      { name: t('mod.field.amount'), value: t('mod.log.messagesCount', { count: input.deleted }), inline: true },
      { name: t('mod.field.channel'), value: `<#${input.channelId}>`, inline: true },
      { name: t('mod.field.moderator'), value: `<@${input.moderatorId}>`, inline: true },
    )
    .setTimestamp();

  if (input.filters.length > 0) {
    embed.addFields({ name: t('mod.field.filter'), value: input.filters.join('\n') });
  }

  return embed;
}

/**
 * Embed utama halaman kasus: aksi, target, moderator, alasan, dan statusnya.
 *
 * Field "Kondisi sekarang" hanya muncul untuk ban & timeout — dua aksi yang
 * masih bisa berubah statusnya setelah dicatat.
 */
export function caseSummaryEmbed(
  record: ModerationCase,
  options: { currentState?: CaseTargetState | null } = {},
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(ACTION_COLORS[record.type])
    .setTitle(
      `${actionEmoji(record.type)} ${actionLabel(record.type, t)} — ${formatCaseId(record.caseNumber)}`,
    )
    .setTimestamp(record.createdAt)
    .addFields(
      { name: t('mod.field.target'), value: formatTarget(record.targetId, caseTargetKind(record)), inline: true },
      { name: t('mod.field.moderator'), value: `<@${record.moderatorId}>`, inline: true },
      { name: t('mod.field.status'), value: describeCaseStatus(record, t), inline: true },
      { name: t('mod.field.time'), value: `<t:${toUnix(record.createdAt)}:f> · <t:${toUnix(record.createdAt)}:R>`, inline: true },
      { name: t('mod.field.reason'), value: caseReasonText(record, t) },
    );

  if (record.expiresAt) {
    const expired = record.expiresAt.getTime() <= record.createdAt.getTime();
    embed.addFields({
      name: t('mod.field.expires'),
      value: expired
        ? t('mod.case.expired', { when: toUnix(record.expiresAt) })
        : `<t:${toUnix(record.expiresAt)}:f> · <t:${toUnix(record.expiresAt)}:R>`,
      inline: true,
    });
  }

  const stateLines = currentStateLines(record, options.currentState ?? null, t);
  if (stateLines.length > 0) {
    embed.addFields({ name: t('mod.field.currentState'), value: stateLines.join('\n') });
  }

  // Hanya untuk aksi yang memang mengirim DM; aksi channel & `/note` tidak
  // punya baris sama sekali, bukan baris yang menyatakan "tidak dikirim".
  const dmLine = dmDeliveryLine(record, t);
  if (dmLine) {
    embed.addFields({ name: t('mod.field.notification'), value: dmLine, inline: true });
  }

  return embed;
}

/**
 * Halaman profil moderator: angka besar, sebaran jenis aksi, dan kasus terbaru.
 *
 * Alasan kasus sengaja tidak ikut ditampilkan di sini: daftar ini bisa jadi
 * puluhan baris, dan alasan tanpa konteks (alasan lengkapnya ada di `/case`)
 * membuat embed ramai tanpa menambah informasi yang bisa dipakai.
 */
export function moderatorProfileEmbed(
  profile: ModeratorProfile,
  options: { displayName: string } = { displayName: '' },
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const name = options.displayName || `<@${profile.moderatorId}>`;

  return new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle(t('mod.profile.title', { name }))
    .setDescription(moderatorOverviewLines(profile, t).join('\n'))
    .addFields({
      name: t('mod.field.actionSpread'),
      value: moderatorActionLines(profile, t).slice(0, 1_024),
      inline: false,
    })
    .setFooter({ text: t('mod.profile.footer') })
    .setTimestamp();
}

/**
 * Embed kedua di balasan aksi: riwayat kasus sebelumnya atas target yang sama.
 *
 * Hanya dibuat kalau target punya riwayat — embed kosong untuk member yang
 * benar-benar bersih hanya menambah beban baca tanpa keputusan yang bisa
 * diambil darinya.
 *
 * Balasan ini hanya ke moderator (ephemeral), jadi menampilkan kasus lama di
 * sini tidak membuka data yang tidak boleh dilihat target: alasan lengkapnya
 * tetap hanya di `/case`.
 */
export function priorCaseEmbed(
  summary: PriorCaseSummary,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const overview = priorCaseNoteLines(summary, t);
  const recent = priorCaseRecentLines(summary, t);
  const body = [...overview, ...(recent.length > 0 ? ['', ...recent] : [])].join('\n');
  const hint = summary.recentCases[0]
    ? t('mod.prior.hint', { case: formatCaseId(summary.recentCases[0].caseNumber) })
    : '';

  return new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle(t('mod.prior.title', { target: summary.targetId }))
    .setDescription(body.slice(0, 4_000))
    .setFooter({ text: t('mod.prior.footer', { count: summary.total, hint }) })
    .setTimestamp();
}

/** Daftar kasus terbaru milik moderator — kasus lengkapnya ada di `/case`. */
export function moderatorRecentCasesEmbed(
  profile: ModeratorProfile,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle(t('mod.profile.recentTitle'))
    .setTimestamp();

  if (profile.recentCases.length === 0) {
    return embed.setDescription(t('mod.profile.recentEmpty'));
  }

  const lines = profile.recentCases.map((record) =>
    moderatorCaseLine(record, moderatorTargetKind(record.type), t),
  );
  const hidden = profile.totals.total - profile.recentCases.length;
  const detailHint = t('mod.profile.detailHint');

  return embed
    .setDescription(lines.join('\n'))
    .setFooter({
      text:
        hidden > 0
          ? t('mod.profile.ofTotal', {
              shown: profile.recentCases.length,
              total: profile.totals.total,
              hint: detailHint,
            })
          : t('mod.profile.recentCount', {
              count: profile.recentCases.length,
              hint: detailHint,
            }),
    });
}

/** Riwayat kasus lain atas target yang sama, untuk memberi konteks. */
export function caseHistoryEmbed(
  target: ModerationCase,
  history: readonly ModerationCase[],
  total: number,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle(t('mod.case.historyTitle', { target: formatTarget(target.targetId, caseTargetKind(target)) }))
    .setTimestamp();

  if (history.length === 0) {
    return embed.setDescription(t('mod.case.historyEmpty'));
  }

  const lines = history.map((record) => caseHistoryLine(record, t));
  const note =
    total > history.length ? t('mod.case.historyHidden', { count: total - history.length }) : '';

  return embed
    .setDescription(`${lines.join('\n')}${note}`.slice(0, 4_000))
    .setFooter({ text: t('mod.case.historyFooter', { count: total }) });
}