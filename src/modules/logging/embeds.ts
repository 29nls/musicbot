import { EmbedBuilder, type GuildAuditLogsEntry } from 'discord.js';
import { EMBED_COLORS } from '../../config/constants.js';
import { formatCaseId } from '../moderation/caseNumber.js';
import { CATEGORY_META, type LogCategory, type LogRecord, type LogSearchFilter } from './types.js';

export interface LogField {
  name: string;
  value: string;
  inline?: boolean;
}

const MAX_FIELD_VALUE = 1_024;
const MAX_FIELDS = 25;
const MAX_FIELD_NAME_LENGTH = 256;

export function truncate(value: string, max = 300): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** `<t:...:R>` untuk Date; "—" kalau kosong. */
export function relativeTime(date: Date | null | undefined): string {
  return date ? `<t:${Math.floor(date.getTime() / 1_000)}:R>` : '—';
}

/** Embed dasar semua kategori log: warna & label kategori + timestamp. */
export function logEmbed(input: {
  category: LogCategory;
  title: string;
  description?: string;
  fields?: LogField[];
  footer?: string;
}): EmbedBuilder {
  const meta = CATEGORY_META[input.category];
  const embed = new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(input.title)
    .setFooter({ text: input.footer ?? `${meta.emoji} ${meta.label}` })
    .setTimestamp();

  if (input.description) embed.setDescription(truncate(input.description, 4_000));

  const fields = (input.fields ?? [])
    .filter((field) => field.value.trim().length > 0)
    .slice(0, MAX_FIELDS)
    .map((field) => ({ ...field, value: truncate(field.value, MAX_FIELD_VALUE) }));

  if (fields.length > 0) embed.addFields(fields);

  return embed;
}

/** Field "Perubahan" dari baris diff; null kalau tidak ada perubahan. */
export function changesField(lines: readonly string[]): LogField | null {
  if (lines.length === 0) return null;
  return { name: 'Perubahan', value: lines.join('\n') };
}

/** Field executor & alasan dari entri audit log (kalau ada). */
export function executorFields(entry: GuildAuditLogsEntry | null): LogField[] {
  if (!entry) return [];

  const fields: LogField[] = [];
  if (entry.executor) {
    fields.push({
      name: 'Executor',
      value: `<@${entry.executor.id}> (\`${entry.executor.tag}\`)`,
      inline: true,
    });
  }
  if (entry.reason) fields.push({ name: 'Alasan', value: entry.reason, inline: true });

  return fields;
}

/** Buang field null/kosong sebelum dikirim ke embed. */
export function compactFields(fields: readonly (LogField | null | undefined)[]): LogField[] {
  return fields.filter((field): field is LogField => field !== null && field !== undefined);
}

export function userField(
  label: string,
  user: { id: string; tag?: string } | null | undefined,
): LogField | null {
  if (!user) return null;
  return { name: label, value: `<@${user.id}>${user.tag ? ` (\`${user.tag}\`)` : ''}` };
}

export function channelField(
  label: string,
  channelId: string | null | undefined,
): LogField | null {
  if (!channelId) return null;
  return { name: label, value: `<#${channelId}> (\`${channelId}\`)`, inline: true };
}

/** Ringkasan filter aktif — ditampilkan di atas hasil `/logs`. */
export function describeLogFilter(filter: LogSearchFilter): string {
  const parts: string[] = [];

  if (filter.categories.length > 0) {
    parts.push(`Kategori: ${filter.categories.map((c) => CATEGORY_META[c].label).join(', ')}`);
  }
  if (filter.userId) parts.push(`User: <@${filter.userId}>`);
  if (filter.channelId) parts.push(`Channel: <#${filter.channelId}>`);
  if (filter.keyword) parts.push(`Kata kunci: \`${truncate(filter.keyword, 40)}\``);
  if (filter.caseNumber) parts.push(`Kasus: \`${formatCaseId(filter.caseNumber)}\``);
  if (filter.from) parts.push(`Dari: <t:${Math.floor(filter.from.getTime() / 1_000)}:f>`);
  if (filter.to) parts.push(`Sampai: <t:${Math.floor(filter.to.getTime() / 1_000)}:f>`);

  return parts.length > 0 ? parts.join(' · ') : 'Semua kategori · tanpa batas waktu';
}

/** Bentuk minim tautan kasus yang dibutuhkan embed (tanpa memuat modul moderation). */
export interface LogCaseSource {
  caseNumber: number;
  moderatorId: string;
}

/**
 * Field sumber & kasus: membedakan aksi yang dijalankan Harmony lewat
 * perintahnya (ada nomor kasus) dari moderator lain, bot lain, atau sistem.
 */
export function caseSourceFields(
  link: LogCaseSource | null,
  executorId: string | null | undefined,
  botUserId: string | null | undefined,
): LogField[] {
  if (link) {
    return [
      { name: 'Sumber', value: '🤖 Harmony (perintah bot)', inline: true },
      { name: 'Kasus', value: `\`${formatCaseId(link.caseNumber)}\``, inline: true },
      { name: 'Moderator', value: `<@${link.moderatorId}>`, inline: true },
    ];
  }

  if (!executorId) return [];

  const doneByThisBot = botUserId != null && executorId === botUserId;

  return [
    {
      name: 'Sumber',
      value: doneByThisBot
        ? '🤖 Bot — di luar kasus Harmony'
        : `👤 Moderator lain (<@${executorId}>)`,
      inline: true,
    },
  ];
}

/** Sebut target sesuai jenisnya: member, channel, atau role. */
function targetMention(record: LogRecord): string | null {
  if (!record.targetId) return null;
  if (record.category === 'channel') return `<#${record.targetId}>`;
  if (record.category === 'role') return `<@&${record.targetId}>`;

  return `<@${record.targetId}>`;
}

export interface LogResultsOptions {
  guildId: string;
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Embed hasil `/logs`: satu field per entri, terbaru lebih dulu.
 *
 * Entri yang punya `logChannelId` + `logMessageId` mendapat tautan lompat ke
 * pesan aslinya di channel log, jadi hasil pencarian bisa langsung dicek.
 */
export function logResultsEmbed(
  records: readonly LogRecord[],
  options: LogResultsOptions,
): EmbedBuilder {
  const { guildId, page, pageSize, total } = options;
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle('🔎 Riwayat Log')
    .setTimestamp()
    .setFooter({ text: `Halaman ${page} · entri ${first}–${last} dari ${total}` });

  for (const record of records) {
    const meta = CATEGORY_META[record.category];
    const timestamp = Math.floor(record.createdAt.getTime() / 1_000);
    const lines = [`⏱️ <t:${timestamp}:f> · \`${record.eventKey}\``];

    const target = targetMention(record);
    if (target) lines.push(target);
    if (record.caseId && Number.isInteger(Number(record.caseId))) {
      lines.push(`🤖 Harmony · Kasus \`${formatCaseId(Number(record.caseId))}\``);
    }
    if (record.executorId) lines.push(`Oleh: <@${record.executorId}>`);
    if (record.channelId && record.category !== 'channel') {
      lines.push(`Channel: <#${record.channelId}>`);
    }

    // Hanya kategori pesan yang menampilkan isi — di kategori lain nilai field
    // sudah berupa daftar perubahan yang jauh lebih panjang.
    if (record.category === 'message' && record.summary) {
      lines.push(`> ${truncate(record.summary, 140)}`);
    }

    if (record.logChannelId && record.logMessageId) {
      const url = `https://discord.com/channels/${guildId}/${record.logChannelId}/${record.logMessageId}`;
      lines.push(`[Lompat ke pesan log](${url})`);
    }

    embed.addFields({
      name: truncate(`${meta.emoji} ${record.title}`, MAX_FIELD_NAME_LENGTH),
      value: lines.join('\n'),
    });
  }

  if (total > page * pageSize) {
    embed.addFields({
      name: 'Halaman berikutnya',
      value: `Masih ada entri lain — jalankan ulang dengan \`page:${page + 1}\`.`,
    });
  }

  return embed;
}
