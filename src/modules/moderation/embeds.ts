import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../../config/constants.js';
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
  ACTION_LABELS,
  type ModerationAction,
  type ModerationCase,
  type NotifiableAction,
  type WarningRecord,
} from './types.js';

const toUnix = (date: Date): number => Math.floor(date.getTime() / 1_000);
const trimReason = (reason: string | null): string =>
  reason ? reason.slice(0, 1_000) : '*tidak disebutkan*';

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
export function moderationLogEmbed(input: ModerationLogInput): EmbedBuilder {
  const meta = ACTION_LABELS[input.action];
  const embed = new EmbedBuilder()
    .setColor(ACTION_COLORS[input.action])
    .setTitle(`${meta.emoji} ${meta.label} — ${formatCaseId(input.caseNumber)}`)
    .addFields(
      { name: 'Kasus', value: `\`${formatCaseId(input.caseNumber)}\``, inline: true },
      { name: 'Target', value: formatTarget(input.targetId, input.targetKind), inline: true },
      { name: 'Moderator', value: `<@${input.moderatorId}>`, inline: true },
      { name: 'Alasan', value: trimReason(input.reason) },
    )
    .setTimestamp(input.createdAt ?? new Date());

  if (input.expiresAt) {
    embed.addFields({ name: 'Berakhir', value: `<t:${toUnix(input.expiresAt)}:R>` });
  }

  if (input.dmSent !== undefined) {
    embed.setFooter({
      text: input.dmSent ? 'DM ke target terkirim' : 'DM ke target tidak terkirim (DM tertutup)',
    });
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

const DM_TITLES: Record<NotifiableAction, string> = {
  ban: '🔨 Kamu di-ban dari {server}',
  kick: '👢 Kamu di-kick dari {server}',
  timeout: '⏳ Kamu di-timeout di {server}',
  warn: '⚠️ Kamu mendapat peringatan di {server}',
  unban: '🔓 Ban-mu di server {server} telah dibuka',
};

/** DM yang dikirim ke target — selalu berisi ID kasus. */
export function moderationDmEmbed(input: ModerationDmInput): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(input.action === 'ban' ? EMBED_COLORS.error : EMBED_COLORS.warning)
    .setTitle(DM_TITLES[input.action].replace('{server}', input.guildName))
    .setDescription('Kalau kamu merasa ini keliru, hubungi moderator server.')
    .addFields({ name: 'Kasus', value: `\`${formatCaseId(input.caseNumber)}\``, inline: true });

  if (input.reason) embed.addFields({ name: 'Alasan', value: trimReason(input.reason) });
  if (input.expiresAt) embed.addFields({ name: 'Berakhir', value: `<t:${toUnix(input.expiresAt)}:R>` });

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
export function moderationResultEmbed(input: ModerationResultInput): EmbedBuilder {
  const meta = ACTION_LABELS[input.action];
  const embed = new EmbedBuilder()
    .setColor(ACTION_COLORS[input.action])
    .setTitle(`${meta.emoji} ${meta.label} Berhasil`)
    .addFields(
      { name: 'Kasus', value: `\`${formatCaseId(input.caseNumber)}\``, inline: true },
      { name: 'Target', value: formatTarget(input.targetId, input.targetKind), inline: true },
    )
    .setTimestamp();

  if (input.reason) embed.addFields({ name: 'Alasan', value: trimReason(input.reason) });
  if (input.expiresAt) embed.addFields({ name: 'Berakhir', value: `<t:${toUnix(input.expiresAt)}:R>` });
  if (input.extraLines && input.extraLines.length > 0) embed.setDescription(input.extraLines.join('\n'));

  return embed;
}

/** DM pemberitahuan saat warning dicabut. */
export function warningRevokedDmEmbed(input: {
  caseNumber: number;
  guildName: string;
  moderatorId: string;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.success)
    .setTitle(`✅ Peringatan dicabut di ${input.guildName}`)
    .setDescription(
      `Peringatan \`${formatCaseId(input.caseNumber)}\` dicabut oleh <@${input.moderatorId}>.`,
    )
    .setTimestamp();
}

/** Log saat warning dicabut (kasus asli ditandai tidak aktif, tidak dihapus). */
export function warningRevokedLogEmbed(input: {
  caseNumber: number;
  targetId: string;
  moderatorId: string;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.success)
    .setTitle(`♻️ Peringatan Dicabut — ${formatCaseId(input.caseNumber)}`)
    .addFields(
      { name: 'Target', value: `<@${input.targetId}>`, inline: true },
      { name: 'Moderator', value: `<@${input.moderatorId}>`, inline: true },
    )
    .setTimestamp();
}

/** Embed daftar peringatan satu member. */
export function warningsEmbed(
  target: { id: string; tag: string },
  warnings: WarningRecord[],
  total: number,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.warning)
    .setTitle(`⚠️ Peringatan — ${target.tag}`)
    .setFooter({ text: `Total ${total} peringatan tercatat` })
    .setTimestamp();

  if (warnings.length === 0) {
    return embed.setDescription('Tidak ada peringatan yang tercatat untuk user ini.');
  }

  const lines = warnings.map(
    (warning) =>
      `**\`${formatCaseId(warning.caseNumber)}\`** • <t:${toUnix(warning.createdAt)}:R> • oleh <@${warning.moderatorId}>\n` +
      `> ${warning.reason ? warning.reason.slice(0, 150) : '*tanpa alasan*'}`,
  );

  return embed.setDescription(lines.join('\n\n').slice(0, 4_000));
}

/** Embed daftar catatan internal satu member. */
export function notesEmbed(
  target: { id: string; tag: string },
  notes: ModerationCase[],
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle(`📝 Catatan Internal — ${target.tag}`)
    .setTimestamp();

  if (notes.length === 0) {
    return embed.setDescription('Belum ada catatan untuk user ini.');
  }

  const lines = notes.map(
    (note) =>
      `**\`${formatCaseId(note.caseNumber)}\`** • <t:${toUnix(note.createdAt)}:R> • oleh <@${note.moderatorId}>\n` +
      `> ${note.reason ? note.reason.slice(0, 200) : '*tanpa isi*'}`,
  );

  return embed
    .setDescription(lines.join('\n\n').slice(0, 4_000))
    .setFooter({ text: `${notes.length} catatan terbaru ditampilkan` });
}

/** Embed yang dicatat ke channel log setiap kali `/purge` dijalankan. */

export function purgeLogEmbed(input: {
  moderatorId: string;
  channelId: string;
  deleted: number;
  filters: string[];
}): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.warning)
    .setTitle('🧹 Purge Pesan')
    .addFields(
      { name: 'Jumlah', value: `${input.deleted} pesan`, inline: true },
      { name: 'Channel', value: `<#${input.channelId}>`, inline: true },
      { name: 'Moderator', value: `<@${input.moderatorId}>`, inline: true },
    )
    .setTimestamp();

  if (input.filters.length > 0) {
    embed.addFields({ name: 'Filter', value: input.filters.join('\n') });
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
): EmbedBuilder {
  const meta = ACTION_LABELS[record.type];
  const embed = new EmbedBuilder()
    .setColor(ACTION_COLORS[record.type])
    .setTitle(`${meta.emoji} ${meta.label} — ${formatCaseId(record.caseNumber)}`)
    .setTimestamp(record.createdAt)
    .addFields(
      { name: 'Target', value: formatTarget(record.targetId, caseTargetKind(record)), inline: true },
      { name: 'Moderator', value: `<@${record.moderatorId}>`, inline: true },
      { name: 'Status', value: describeCaseStatus(record), inline: true },
      { name: 'Waktu', value: `<t:${toUnix(record.createdAt)}:f> · <t:${toUnix(record.createdAt)}:R>`, inline: true },
      { name: 'Alasan', value: caseReasonText(record) },
    );

  if (record.expiresAt) {
    const expired = record.expiresAt.getTime() <= record.createdAt.getTime();
    embed.addFields({
      name: 'Berakhir',
      value: expired
        ? `<t:${toUnix(record.expiresAt)}:f> — *sudah lewat*`
        : `<t:${toUnix(record.expiresAt)}:f> · <t:${toUnix(record.expiresAt)}:R>`,
      inline: true,
    });
  }

  const stateLines = currentStateLines(record, options.currentState ?? null);
  if (stateLines.length > 0) {
    embed.addFields({ name: 'Kondisi sekarang', value: stateLines.join('\n') });
  }

  // Hanya untuk aksi yang memang mengirim DM; aksi channel & `/note` tidak
  // punya baris sama sekali, bukan baris yang menyatakan "tidak dikirim".
  const dmLine = dmDeliveryLine(record);
  if (dmLine) {
    embed.addFields({ name: 'Notifikasi', value: dmLine, inline: true });
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
): EmbedBuilder {
  const name = options.displayName || `<@${profile.moderatorId}>`;
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle(`🛡️ Profil Moderator — ${name}`)
    .setDescription(moderatorOverviewLines(profile).join('\n'))
    .addFields({
      name: 'Sebaran aksi',
      value: moderatorActionLines(profile).slice(0, 1_024),
      inline: false,
    })
    .setFooter({ text: 'Hanya kasus yang tercatat Harmony · data lama dihapus setelah 12 bulan' })
    .setTimestamp();

  return embed;
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
export function priorCaseEmbed(summary: PriorCaseSummary): EmbedBuilder {
  const overview = priorCaseNoteLines(summary);
  const recent = priorCaseRecentLines(summary);
  const body = [...overview, ...(recent.length > 0 ? ['', ...recent] : [])].join('\n');
  const hint = summary.recentCases[0]
    ? ` · \`/case kasus:${formatCaseId(summary.recentCases[0].caseNumber)}\` untuk detail`
    : '';

  return new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle(`🗂️ Riwayat terkait <@${summary.targetId}>`)
    .setDescription(body.slice(0, 4_000))
    .setFooter({
      text: `${summary.total} kasus sebelumnya tercatat di Harmony${hint}`,
    })
    .setTimestamp();
}

/** Daftar kasus terbaru milik moderator — kasus lengkapnya ada di `/case`. */
export function moderatorRecentCasesEmbed(profile: ModeratorProfile): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle('🗂️ Kasus Terbaru')
    .setTimestamp();

  if (profile.recentCases.length === 0) {
    return embed.setDescription(
      'Belum ada kasus yang tercatat untuk moderator ini di server ini.',
    );
  }

  const lines = profile.recentCases.map((record) =>
    moderatorCaseLine(record, moderatorTargetKind(record.type)),
  );
  const hidden = profile.totals.total - profile.recentCases.length;
  const detailHint = ' · `/case kasus:NNN` untuk detailnya';

  return embed
    .setDescription(lines.join('\n'))
    .setFooter({
      text:
        hidden > 0
          ? `${profile.recentCases.length} terbaru dari ${profile.totals.total} kasus${detailHint}`
          : `${profile.recentCases.length} kasus terbaru${detailHint}`,
    });
}

/** Riwayat kasus lain atas target yang sama, untuk memberi konteks. */
export function caseHistoryEmbed(
  target: ModerationCase,
  history: readonly ModerationCase[],
  total: number,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle(
      `🗂️ Riwayat ${formatTarget(target.targetId, caseTargetKind(target))}`,
    )
    .setTimestamp();

  if (history.length === 0) {
    return embed.setDescription(
      'Tidak ada kasus lain atas target ini — ini satu-satunya kasusnya.',
    );
  }

  const lines = history.map(caseHistoryLine);
  const note = total > history.length ? `\n\n*+${total - history.length} kasus lain tidak ditampilkan.*` : '';

  return embed
    .setDescription(`${lines.join('\n')}${note}`.slice(0, 4_000))
    .setFooter({ text: `${total} kasus lain tercatat untuk target ini` });
}
