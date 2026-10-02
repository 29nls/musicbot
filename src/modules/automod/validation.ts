import {
  THRESHOLD_RANGES,
  describeThreshold,
  type AutomodRuleType,
} from './types.js';

/** Error validasi yang pesannya aman ditampilkan ke user Discord. */
export class AutomodValidationError extends Error {
  public override readonly name = 'AutomodValidationError';

  constructor(message: string) {
    super(message);
  }
}

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const DOMAIN_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const INVITE_CODE_PATTERN = /^[a-z0-9-]{2,32}$/;

export function assertSnowflake(value: string, label: string): string {
  const trimmed = value.trim();
  if (!SNOWFLAKE_PATTERN.test(trimmed)) {
    throw new AutomodValidationError(`ID ${label} tidak valid: \`${value}\`.`);
  }
  return trimmed;
}

export function validateThreshold(type: AutomodRuleType, value: number): number {
  const range = THRESHOLD_RANGES[type];
  if (!range) {
    throw new AutomodValidationError(
      `Rule **${type}** tidak punya ambang yang bisa diubah — cukup nyalakan/matikan.`,
    );
  }

  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    throw new AutomodValidationError(
      `Ambang untuk **${type}** harus bilangan bulat ${range.min}–${range.max}. Sekarang: ${describeThreshold(
        type,
        value,
      )}.`,
    );
  }

  return value;
}

/** Terima `youtube.com`, `https://youtube.com/watch?v=x`, atau `www.youtube.com/x`. */
export function normalizeDomain(value: string): string {
  let raw = value.trim().toLowerCase();
  if (!raw) throw new AutomodValidationError('Domain tidak boleh kosong.');

  if (raw.includes('://')) {
    try {
      raw = new URL(raw).hostname;
    } catch {
      throw new AutomodValidationError(`Domain \`${value}\` tidak bisa dibaca.`);
    }
  } else {
    raw = raw.split('/')[0] ?? raw;
  }

  raw = raw.replace(/^www\./, '');

  if (!DOMAIN_PATTERN.test(raw)) {
    throw new AutomodValidationError(
      `Domain \`${value}\` tidak valid. Contoh: \`youtube.com\` atau \`https://youtube.com/watch?v=1\`.`,
    );
  }

  return raw;
}

/** Terima `abc123`, `discord.gg/abc123`, atau `https://discord.com/invite/abc123`. */
export function normalizeInvite(value: string): string {
  let raw = value.trim().toLowerCase();
  if (!raw) throw new AutomodValidationError('Kode invite tidak boleh kosong.');

  raw = raw.replace(/^https?:\/\//, '');
  raw = raw.split('?')[0] ?? raw;
  raw = raw.replace(/^(?:www\.)?discord(?:app)?\.(?:gg|com)\/invite\//, '');
  raw = raw.replace(/^(?:www\.)?discord(?:app)?\.gg\//, '');
  raw = raw.replace(/\/+$/, '');

  if (!INVITE_CODE_PATTERN.test(raw)) {
    throw new AutomodValidationError(
      `Kode invite \`${value}\` tidak valid. Contoh: \`abc123\` atau \`discord.gg/abc123\`.`,
    );
  }

  return raw;
}

/** Kata terlarang: huruf kecil, tanpa baris baru, 2–50 karakter. */
export function normalizeWord(value: string): string {
  const word = value.trim().toLowerCase().replace(/\s+/g, ' ');

  if (word.length < 2 || word.length > 50 || word.includes('\n')) {
    throw new AutomodValidationError('Kata terlarang harus 2–50 karakter dan tanpa baris baru.');
  }

  return word;
}
