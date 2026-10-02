import { MAX_TIMEOUT_MS } from './types.js';

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  detik: 1_000,
  d: 86_400_000,
  hari: 86_400_000,
  h: 3_600_000,
  jam: 3_600_000,
  m: 60_000,
  menit: 60_000,
};

/**
 * Baca durasi timeout dari input user: `30s`, `10m`, `2h`, `7d`, atau angka
 * polos yang dianggap menit. null kalau format salah atau di luar batas Discord
 * (1 detik – 28 hari).
 */
export function parseTimeoutDuration(input: string): number | null {
  const match = /^(\d{1,6})\s*([a-z]*)$/i.exec(input.trim());
  const amountText = match?.[1];
  if (!amountText) return null;

  const amount = Number(amountText);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;

  const unit = (match?.[2] ?? '').toLowerCase();
  // Tanpa satuan dianggap menit — cara paling umum orang menulis timeout.
  const multiplier = unit === '' ? 60_000 : UNIT_MS[unit];

  if (multiplier === undefined) return null;

  const ms = amount * multiplier;
  if (ms < 1_000 || ms > MAX_TIMEOUT_MS) return null;

  return ms;
}

/** 600_000 → "10 menit" (untuk embed; bukan format jam:menit). */
export function describeTimeout(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0 detik';
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000} hari`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000} jam`;
  if (ms % 60_000 === 0) return `${ms / 60_000} menit`;
  return `${Math.round(ms / 1_000)} detik`;
}
