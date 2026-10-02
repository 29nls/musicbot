import { isLogCategory, type LogCategory } from './types.js';

/** Error validasi yang pesannya aman ditampilkan ke user Discord. */
export class LoggingValidationError extends Error {
  public override readonly name = 'LoggingValidationError';

  constructor(message: string) {
    super(message);
  }
}

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

export function assertSnowflake(value: string, label: string): string {
  const trimmed = value.trim();
  if (!SNOWFLAKE_PATTERN.test(trimmed)) {
    throw new LoggingValidationError(`ID ${label} tidak valid: \`${value}\`.`);
  }
  return trimmed;
}

export function assertCategory(value: string): LogCategory {
  if (!isLogCategory(value)) {
    throw new LoggingValidationError(`Kategori \`${value}\` tidak dikenal.`);
  }
  return value;
}
