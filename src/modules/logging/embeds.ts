import { EmbedBuilder, type GuildAuditLogsEntry } from 'discord.js';
import { EMBED_COLORS } from '../../config/constants.js';
import { defaultTranslator, type Translator } from '../i18n/index.js';
import { formatCaseId } from '../moderation/caseNumber.js';
import {
  STATS_TOP_ACTIONS,
  STATS_TOP_MEMBERS,
  eventKeyEmoji,
  eventKeyLabel,
  formatShare,
  statsBar,
  type LogStats,
  type LogStatsPeriod,
} from './stats.js';
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

/**
 * Field untuk event yang mungkin berasal dari kasus Harmony.
 *
 * Aksi bot: field dibuat ringkas dan fokus ke tautan kasus, karena alasan,
 * moderator, dan detail aksi sudah ada di log kasus yang dikirim perintah —
 * mengulangnya di sini hanya membuat dua embed bertele-tele di channel yang sama.
 * Aksi luar Harmony: field event tetap lengkap, ditambah penanda sumber.
 */
export function caseAwareFields(
  link: LogCaseSource | null,
  externalFields: LogField[],
  executorId: string | null | undefined,
  botUserId: string | null | undefined,
): LogField[] {
  if (link) return caseSourceFields(link, null, null);

  return [...externalFields, ...caseSourceFields(null, executorId, botUserId)];
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

export interface LogRecordSummary {
  /** Judul siap pakai: emoji kategori + judul entri. */
  title: string;
  lines: string[];
}

/**
 * Baris ringkas satu entri riwayat: waktu, event, target, kasus, executor,
 * channel, dan tautan lompat ke pesan log aslinya.
 *
 * Dipakai bersama oleh `/logs` dan halaman ringkasan kasus supaya dua tempat
 * menampilkan entri yang sama dengan cara yang sama.
 */
export function logRecordSummary(record: LogRecord, guildId: string): LogRecordSummary {
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

  return { title: truncate(`${meta.emoji} ${record.title}`, MAX_FIELD_NAME_LENGTH), lines };
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
    const summary = logRecordSummary(record, guildId);
    embed.addFields({ name: summary.title, value: summary.lines.join('\n') });
  }

  if (total > page * pageSize) {
    embed.addFields({
      name: 'Halaman berikutnya',
      value: `Masih ada entri lain — jalankan ulang dengan \`page:${page + 1}\`.`,
    });
  }

  return embed;
}

export interface LogStatsEmbedOptions {
  filter: LogSearchFilter;
  period: LogStatsPeriod;
  /** Berapa banyak baris per daftar; default mengikuti konstanta modul. */
  topActions?: number;
  topMembers?: number;
}

/**
 * Embed statistik `/logs … stats:true`: sebaran per kategori, event yang paling
 * sering muncul, dan member yang paling sering terlibat.
 *
 * Baris ringkas (bukan satu field per entri) supaya periode yang ramai pun
 * tetap muat di satu embed.
 */
export function logStatsEmbed(stats: LogStats, options: LogStatsEmbedOptions): EmbedBuilder {
  const { filter, period } = options;
  const topActions = options.topActions ?? STATS_TOP_ACTIONS;
  const topMembers = options.topMembers ?? STATS_TOP_MEMBERS;

  const from = `<t:${Math.floor(period.from.getTime() / 1_000)}:f>`;
  const to = `<t:${Math.floor(period.to.getTime() / 1_000)}:f>`;

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle('📊 Statistik Log')
    .setTimestamp()
    .setFooter({ text: `${stats.total} event · ${from} – ${to}` });

  const periodNote = period.defaulted
    ? '\n\n_Periode default: seluruh masa simpan riwayat. Batonai `from:` untuk mempersempit._'
    : '';
  embed.setDescription(`${describeLogFilter(filter)}\n\n**Periode:** ${from} – ${to}${periodNote}`);

  embed.addFields({
    name: 'Event per kategori',
    value: categoryLines(stats),
  });

  embed.addFields(
    {
      name: `Aksi teratas (${Math.min(topActions, stats.topActions.length)})`,
      value: actionLines(stats, topActions),
    },
    {
      name: `Member paling sering terkait (${Math.min(topMembers, stats.topMembers.length)})`,
      value: memberLines(stats, topMembers),
    },
  );

  return embed;
}

/** Enam kategori, lengkap dengan batang proporsi terhadap kategori teramai. */
function categoryLines(stats: LogStats): string {
  const max = Math.max(...stats.categories.map((item) => item.count));

  return stats.categories
    .map((item) => {
      const meta = CATEGORY_META[item.category];
      return `${meta.emoji} ${meta.label} \`${statsBar(item.count, max)}\` **${item.count}** (${formatShare(item.count, stats.total)})`;
    })
    .join('\n');
}

function actionLines(stats: LogStats, limit: number): string {
  if (stats.topActions.length === 0) return 'Tidak ada event pada periode ini.';

  return stats.topActions
    .slice(0, limit)
    .map((item, index) => {
      const emoji = eventKeyEmoji(item.eventKey);
      const label = eventKeyLabel(item.eventKey);
      return `\`${index + 1}.\` ${emoji} **${label}** — ${item.count} event \`${item.eventKey}\``;
    })
    .join('\n');
}

function memberLines(stats: LogStats, limit: number): string {
  if (stats.topMembers.length === 0) {
    return 'Tidak ada member yang tercatat pada periode ini.';
  }

  return stats.topMembers
    .slice(0, limit)
    .map((item, index) => {
      const roles = [
        item.asTarget > 0 ? `🎯 ${item.asTarget} jadi target` : null,
        item.asExecutor > 0 ? `⚡ ${item.asExecutor} melakukan` : null,
      ].filter((line): line is string => line !== null);

      return `\`${index + 1}.\` <@${item.userId}> — **${item.count}** event · ${roles.join(' · ')}`;
    })
    .join('\n');
}

export interface LogEntriesEmbedOptions {
  title: string;
  guildId: string;
  /** Jumlah total yang cocok, dipakai untuk catatan kalau terpotong. */
  total: number;
  /** Kaki embed, mis. cara melihat daftar lengkapnya. */
  footer?: string;
}

/**
 * Daftar entri log tanpa chrome paginasi — dipakai di halaman ringkasan kasus,
 * di mana daftar log adalah salah satu bagian, bukan keseluruhan halaman.
 */
export function logEntriesEmbed(
  records: readonly LogRecord[],
  options: LogEntriesEmbedOptions,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle(options.title)
    .setTimestamp();

  if (options.footer) embed.setFooter({ text: options.footer });

  if (records.length === 0) {
    return embed.setDescription(t('mod.logs.empty'));
  }

  const blocks = records.map((record) => {
    const summary = logRecordSummary(record, options.guildId);
    return `**${summary.title}**\n${summary.lines.join('\n')}`;
  });

  const hidden = options.total - records.length;
  const note = hidden > 0 ? t('mod.logs.moreHidden', { count: hidden }) : '';

  return embed.setDescription(truncate(`${blocks.join('\n\n')}${note}`, 4_000));
}
