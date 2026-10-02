import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../../config/constants.js';
import { formatCaseId } from './caseNumber.js';
import { ACTION_LABELS, type ModerationAction, type WarningRecord } from './types.js';

const toUnix = (date: Date): number => Math.floor(date.getTime() / 1_000);
const trimReason = (reason: string | null): string =>
  reason ? reason.slice(0, 1_000) : '*tidak disebutkan*';

export interface ModerationLogInput {
  action: ModerationAction;
  caseNumber: number;
  targetId: string;
  moderatorId: string;
  reason: string | null;
  createdAt?: Date;
  expiresAt?: Date | null;
  /** undefined = tidak dicoba dikirim (mis. untuk log purge). */
  dmSent?: boolean;
}

/** Embed yang dikirim ke channel log server untuk setiap aksi moderasi. */
export function moderationLogEmbed(input: ModerationLogInput): EmbedBuilder {
  const meta = ACTION_LABELS[input.action];
  const embed = new EmbedBuilder()
    .setColor(input.action === 'ban' ? EMBED_COLORS.error : EMBED_COLORS.warning)
    .setTitle(`${meta.emoji} ${meta.label} — ${formatCaseId(input.caseNumber)}`)
    .addFields(
      { name: 'Kasus', value: `\`${formatCaseId(input.caseNumber)}\``, inline: true },
      { name: 'Target', value: `<@${input.targetId}>`, inline: true },
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
  action: ModerationAction;
  caseNumber: number;
  guildName: string;
  reason: string | null;
  expiresAt?: Date | null;
}

const DM_TITLES: Record<ModerationAction, string> = {
  ban: '🔨 Kamu di-ban dari {server}',
  kick: '👢 Kamu di-kick dari {server}',
  timeout: '⏳ Kamu di-timeout di {server}',
  warn: '⚠️ Kamu mendapat peringatan di {server}',
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
  reason: string | null;
  expiresAt?: Date | null;
  extraLines?: string[];
}

/** Balasan publik/privat setelah aksi berhasil — menampilkan ID kasus. */
export function moderationResultEmbed(input: ModerationResultInput): EmbedBuilder {
  const meta = ACTION_LABELS[input.action];
  const embed = new EmbedBuilder()
    .setColor(input.action === 'ban' ? EMBED_COLORS.error : EMBED_COLORS.success)
    .setTitle(`${meta.emoji} ${meta.label} Berhasil`)
    .addFields(
      { name: 'Kasus', value: `\`${formatCaseId(input.caseNumber)}\``, inline: true },
      { name: 'Target', value: `<@${input.targetId}>`, inline: true },
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
