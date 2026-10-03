import { defaultTranslator, type MessageKey } from '../i18n/index.js';
import { THRESHOLD_RANGES, describeThreshold, type AutomodRuleType } from './types.js';

/**
 * Error validasi yang pesannya aman ditampilkan ke user Discord.
 *
 * Yang disimpan bukan kalimatnya, melainkan kunci katalog + parameternya:
 * `toAutomodErrorEmbed` yang menyusun kalimat akhir, jadi pesan yang sama bisa
 * tampil dalam bahasa server mana pun. `message` tetap diisi bahasa Indonesia
 * supaya `Error` biasa (log internal, `toThrow` di tes) tidak kehilangan teks.
 */
export class AutomodValidationError extends Error {
  public override readonly name = 'AutomodValidationError';

  constructor(
    public readonly key: MessageKey,
    public readonly params?: Record<string, string | number>,
  ) {
    super(defaultTranslator(key, params));
  }
}

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const DOMAIN_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const INVITE_CODE_PATTERN = /^[a-z0-9-]{2,32}$/;

export function assertSnowflake(value: string, label: string): string {
  const trimmed = value.trim();
  if (!SNOWFLAKE_PATTERN.test(trimmed)) {
    throw new AutomodValidationError('automod.err.invalidId', { label, value });
  }
  return trimmed;
}

export function validateThreshold(type: AutomodRuleType, value: number): number {
  const range = THRESHOLD_RANGES[type];
  if (!range) {
    throw new AutomodValidationError('automod.err.noThreshold', { rule: type });
  }

  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    throw new AutomodValidationError('automod.err.thresholdRange', {
      rule: type,
      min: range.min,
      max: range.max,
      current: describeThreshold(type, value),
    });
  }

  return value;
}

/** Terima `youtube.com`, `https://youtube.com/watch?v=x`, atau `www.youtube.com/x`. */
export function normalizeDomain(value: string): string {
  let raw = value.trim().toLowerCase();
  if (!raw) throw new AutomodValidationError('automod.err.emptyDomain');

  if (raw.includes('://')) {
    try {
      raw = new URL(raw).hostname;
    } catch {
      throw new AutomodValidationError('automod.err.unreadableDomain', { value });
    }
  } else {
    raw = raw.split('/')[0] ?? raw;
  }

  raw = raw.replace(/^www\./, '');

  if (!DOMAIN_PATTERN.test(raw)) {
    throw new AutomodValidationError('automod.err.badDomain', { value });
  }

  return raw;
}

/** Terima `abc123`, `discord.gg/abc123`, atau `https://discord.com/invite/abc123`. */
export function normalizeInvite(value: string): string {
  let raw = value.trim().toLowerCase();
  if (!raw) throw new AutomodValidationError('automod.err.emptyInvite');

  raw = raw.replace(/^https?:\/\//, '');
  raw = raw.split('?')[0] ?? raw;
  raw = raw.replace(/^(?:www\.)?discord(?:app)?\.(?:gg|com)\/invite\//, '');
  raw = raw.replace(/^(?:www\.)?discord(?:app)?\.gg\//, '');
  raw = raw.replace(/\/+$/, '');

  if (!INVITE_CODE_PATTERN.test(raw)) {
    throw new AutomodValidationError('automod.err.badInvite', { value });
  }

  return raw;
}

/** Kata terlarang: huruf kecil, tanpa baris baru, 2–50 karakter. */
export function normalizeWord(value: string): string {
  const word = value.trim().toLowerCase().replace(/\s+/g, ' ');

  if (word.length < 2 || word.length > 50 || word.includes('\n')) {
    throw new AutomodValidationError('automod.err.badWord');
  }

  return word;
}
