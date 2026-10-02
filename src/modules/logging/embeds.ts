import { EmbedBuilder, type GuildAuditLogsEntry } from 'discord.js';
import { CATEGORY_META, type LogCategory } from './types.js';

export interface LogField {
  name: string;
  value: string;
  inline?: boolean;
}

const MAX_FIELD_VALUE = 1_024;
const MAX_FIELDS = 25;

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
  return { name: label, value: `<#${channelId}> (\`${channelId}\`)` };
}
