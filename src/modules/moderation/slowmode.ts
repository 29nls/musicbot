/** Batas slowmode Discord: 21.600 detik (6 jam). */
export const MAX_SLOWMODE_SEC = 21_600;

const UNIT_SEC: Record<string, number> = {
  s: 1,
  detik: 1,
  m: 60,
  menit: 60,
  h: 3_600,
  jam: 3_600,
};

/**
 * Baca durasi slowmode dari input user: `0`/`off` (matikan), `30s`, `5m`,
 * `2h`, atau angka polos yang dianggap detik. null kalau format salah atau
 * melebihi batas Discord (6 jam).
 */
export function parseSlowmodeSeconds(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === '0' || trimmed === 'off' || trimmed === 'nonaktif') return 0;

  const match = /^(\d{1,5})\s*([a-z]*)$/.exec(trimmed);
  const amountText = match?.[1];
  if (!amountText) return null;

  const amount = Number(amountText);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;

  const unit = match?.[2] ?? '';
  const multiplier = unit === '' ? 1 : UNIT_SEC[unit];
  if (multiplier === undefined) return null;

  const seconds = amount * multiplier;
  if (seconds < 1 || seconds > MAX_SLOWMODE_SEC) return null;

  return seconds;
}

/** 300 → "5 menit", 0 → "nonaktif". */
export function describeSlowmode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'nonaktif';
  if (seconds % 3_600 === 0) return `${seconds / 3_600} jam`;
  if (seconds % 60 === 0) return `${seconds / 60} menit`;
  return `${Math.round(seconds)} detik`;
}
