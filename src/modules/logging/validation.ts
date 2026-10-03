import { defaultTranslator, type MessageKey } from '../i18n/index.js';
import { parseCaseNumber } from '../moderation/caseNumber.js';
import {
  isLogCategory,
  LOG_PAGE_SIZE,
  MAX_LOG_PAGE,
  type LogCategory,
  type LogSearchFilter,
} from './types.js';

/**
 * Error validasi yang pesannya aman ditampilkan ke user Discord.
 *
 * Yang disimpan bukan kalimatnya, melainkan kunci katalog + parameternya:
 * `toLoggingErrorEmbed` yang menyusun kalimat akhir, jadi pesan yang sama bisa
 * tampil dalam bahasa server mana pun. `message` tetap diisi bahasa Indonesia
 * supaya `Error` biasa (log internal, `toThrow` di tes) tidak kehilangan teks.
 */
export class LoggingValidationError extends Error {
  public override readonly name = 'LoggingValidationError';

  constructor(
    public readonly key: MessageKey,
    public readonly params?: Record<string, string | number>,
  ) {
    super(defaultTranslator(key, params));
  }
}

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

export function assertSnowflake(value: string, label: string): string {
  const trimmed = value.trim();
  if (!SNOWFLAKE_PATTERN.test(trimmed)) {
    throw new LoggingValidationError('log.err.invalidId', { label, value });
  }
  return trimmed;
}

export function assertCategory(value: string): LogCategory {
  if (!isLogCategory(value)) {
    throw new LoggingValidationError('log.err.unknownCategory', { value });
  }
  return value;
}

const RELATIVE_PATTERN = /^(\d{1,4})\s*(m|h|d|w)$/i;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

const UNIT_MS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/**
 * Tanggal relatif (`30m`, `6h`, `7d`, `2w`) atau kalender (`2026-10-02`,
 * `02/10/2026`). Tanggal kalender dibaca sebagai waktu lokal server.
 *
 * `endOfDay` dipakai untuk batas atas supaya `to: 2026-10-02` ikut mencakup
 * seluruh hari tersebut, bukan cuma pukul 00:00.
 */
export function parseDateFilter(
  value: string,
  label: string,
  options: { now?: Date; endOfDay?: boolean } = {},
): Date {
  const raw = value.trim().toLowerCase();
  const now = options.now ?? new Date();

  const relative = RELATIVE_PATTERN.exec(raw);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2] ?? 'd';
    const unitMs = UNIT_MS[unit];
    if (!unitMs) throw new LoggingValidationError('log.err.unknownUnit', { label });

    return new Date(now.getTime() - amount * unitMs);
  }

  const iso = ISO_DATE_PATTERN.exec(raw);
  if (iso) {
    return buildLocalDate(Number(iso[1]), Number(iso[2]), Number(iso[3]), label, options.endOfDay);
  }

  const local = LOCAL_DATE_PATTERN.exec(raw);
  if (local) {
    return buildLocalDate(Number(local[3]), Number(local[2]), Number(local[1]), label, options.endOfDay);
  }

  throw new LoggingValidationError('log.err.invalidDate', { label });
}

function buildLocalDate(
  year: number,
  month: number,
  day: number,
  label: string,
  endOfDay = false,
): Date {
  const date = new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);

  // Tolak tanggal yang "melewati" — mis. 31/02 yang digeser oleh Date ke bulan berikutnya.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new LoggingValidationError('log.err.dateMissing', { label });
  }

  return date;
}

export interface LogSearchInput {
  category?: string | null;
  userId?: string | null;
  channelId?: string | null;
  keyword?: string | null;
  caseNumber?: string | null;
  from?: string | null;
  to?: string | null;
  page?: number | null;
}

/** Ubah input mentah `/logs` menjadi filter yang sudah bersih & berdefault. */
export function parseLogSearch(
  guildId: string,
  input: LogSearchInput,
  now = new Date(),
): LogSearchFilter {
  const categories = parseCategories(input.category);
  const from = input.from?.trim() ? parseDateFilter(input.from, 'from', { now }) : null;
  const to = input.to?.trim() ? parseDateFilter(input.to, 'to', { now, endOfDay: true }) : null;

  if (from && to && from.getTime() > to.getTime()) {
    throw new LoggingValidationError('log.err.rangeReversed');
  }

  return {
    guildId,
    categories,
    userId: input.userId?.trim() ? assertSnowflake(input.userId, 'user') : null,
    channelId: input.channelId?.trim() ? assertSnowflake(input.channelId, 'channel') : null,
    keyword: parseKeyword(input.keyword),
    caseNumber: parseCaseFilter(input.caseNumber),
    from,
    to,
    page: parsePage(input.page),
    pageSize: LOG_PAGE_SIZE,
  };
}

/** Terima `#CASE-0142`, `0142`, atau `142`. */
function parseCaseFilter(value: string | null | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const caseNumber = parseCaseNumber(trimmed);
  if (caseNumber === null) {
    throw new LoggingValidationError('log.err.badCase');
  }

  return caseNumber;
}

/** Terima `member` atau `member,message` — divalidasi & dideduplikasi. */
function parseCategories(value: string | null | undefined): LogCategory[] {
  if (!value?.trim()) return [];

  const categories: LogCategory[] = [];
  for (const part of value.split(',')) {
    const category = assertCategory(part.trim());
    if (!categories.includes(category)) categories.push(category);
  }

  return categories;
}

function parseKeyword(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.length > 100) {
    throw new LoggingValidationError('log.err.keywordTooLong');
  }

  return trimmed;
}

function parsePage(value: number | null | undefined): number {
  if (value === null || value === undefined) return 1;
  if (!Number.isInteger(value) || value < 1) {
    throw new LoggingValidationError('log.err.pageNotInteger');
  }
  if (value > MAX_LOG_PAGE) {
    throw new LoggingValidationError('log.err.pageMax', { max: MAX_LOG_PAGE });
  }

  return value;
}
