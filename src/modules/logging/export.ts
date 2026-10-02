import { CATEGORY_META, type LogRecord, type LogSearchFilter } from './types.js';

export type LogExportFormat = 'json' | 'csv';

export const LOG_EXPORT_FORMATS: readonly LogExportFormat[] = ['json', 'csv'];

/** Batas baris per ekspor — cukup untuk arsip, cukup kecil untuk lampiran Discord. */
export const EXPORT_MAX_ROWS = 500;

/** Batas ukuran lampiran; di atas ini summarise/filter harus dipersempit. */
export const EXPORT_MAX_BYTES = 8 * 1024 * 1024;

export interface LogExportOptions {
  format: LogExportFormat;
  records: readonly LogRecord[];
  guildId: string;
  guildName?: string;
  /** Total baris yang cocok — bisa lebih besar dari `records` kalau terpotong. */
  total: number;
  filter: LogSearchFilter;
  generatedAt?: Date;
}

export interface LogExport {
  filename: string;
  content: string;
  /** true = hasil dipotong di `EXPORT_MAX_ROWS`. */
  truncated: boolean;
  exported: number;
  bytes: number;
}

/** Kolom CSV — nama dibuat stabil & ASCII agar aman dipakai alat audit. */
const CSV_COLUMNS = [
  'timestamp',
  'category',
  'event_key',
  'title',
  'case_id',
  'executor_id',
  'target_id',
  'channel_id',
  'log_channel_id',
  'log_message_id',
  'summary',
] as const;

/**
 * Susun file ekspor (JSON atau CSV) dari hasil pencarian.
 *
 * Murni: dipakai perintah `/logs … format:` dan bisa diuji tanpa Discord.
 */
export function buildLogExport(options: LogExportOptions): LogExport {
  const generatedAt = options.generatedAt ?? new Date();
  const content =
    options.format === 'csv'
      ? recordsToCsv(options.records)
      : recordsToJson(options, generatedAt);

  return {
    filename: logExportFilename(options.guildId, options.format, generatedAt),
    content,
    truncated: options.total > options.records.length,
    exported: options.records.length,
    bytes: Buffer.byteLength(content, 'utf8'),
  };
}

/**
 * `harmony-logs-<guild>-<YYYYMMDD-HHmm>.json` — urut & mudah dicari di disk.
 * Stempel waktu memakai UTC supaya nama file sama persis di server mana pun.
 */
export function logExportFilename(
  guildId: string,
  format: LogExportFormat,
  now = new Date(),
): string {
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    '-',
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
  ].join('');

  return `harmony-logs-${guildId}-${stamp}.${format}`;
}

/** JSON audit: filter ikut disimpan supaya file bisa ditelusuri asalnya. */
export function recordsToJson(
  options: LogExportOptions,
  generatedAt = new Date(),
): string {
  const { filter } = options;

  const payload = {
    generatedAt: generatedAt.toISOString(),
    guild: { id: options.guildId, name: options.guildName ?? null },
    filter: {
      categories: filter.categories,
      userId: filter.userId,
      channelId: filter.channelId,
      keyword: filter.keyword,
      caseNumber: filter.caseNumber,
      from: filter.from ? filter.from.toISOString() : null,
      to: filter.to ? filter.to.toISOString() : null,
    },
    total: options.total,
    exported: options.records.length,
    truncated: options.total > options.records.length,
    entries: options.records.map((record) => ({
      timestamp: record.createdAt.toISOString(),
      category: record.category,
      eventKey: record.eventKey,
      title: record.title,
      caseId: record.caseId,
      executorId: record.executorId,
      targetId: record.targetId,
      channelId: record.channelId,
      logChannelId: record.logChannelId,
      logMessageId: record.logMessageId,
      summary: record.summary,
    })),
  };

  return `${JSON.stringify(payload, null, 2)}\n`;
}

/** CSV ala RFC 4180: header tetap ditulis walau tidak ada baris. */
export function recordsToCsv(records: readonly LogRecord[]): string {
  const lines = [CSV_COLUMNS.join(',')];

  for (const record of records) {
    const cells = [
      record.createdAt.toISOString(),
      record.category,
      record.eventKey,
      record.title,
      record.caseId,
      record.executorId,
      record.targetId,
      record.channelId,
      record.logChannelId,
      record.logMessageId,
      record.summary,
    ];

    lines.push(cells.map(csvCell).join(','));
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Sel satu sel CSV.
 *
 * Nilai yang diawali `=`, `+`, `-`, atau `@` diawalkan tanda kutip tunggal:
 * tanpa itu, membuka file di Excel/Sheets bisa mengeksekusi isi sebagai
 * formula — ringkasan log bisa saja berisi teks dari pesan user.
 */
function csvCell(value: string | null): string {
  if (value === null) return '';

  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  const needsQuotes = /["\n\r,]/.test(guarded) || guarded !== guarded.trim();

  return needsQuotes ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

/** Label kategori yang enak dibaca — dipakai ringkasan pada lampiran. */
export function describeExportCategories(filter: LogSearchFilter): string {
  if (filter.categories.length === 0) return 'semua kategori';
  return filter.categories.map((category) => CATEGORY_META[category].label).join(', ');
}
