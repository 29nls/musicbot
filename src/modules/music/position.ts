/**
 * Parser posisi waktu untuk `/seek`.
 *
 * Murni supaya aturan "apa yang diterima" bisa diuji tanpa Lavalink, dan supaya
 * pesan penolakan yang sama tidak ditulis ulang di beberapa tempat.
 */

/** Batas atas posisi — 6 jam, cukup untuk track terpanjang. */
export const MAX_SEEK_MS = 6 * 60 * 60 * 1_000;

/** Alasan penolakan yang mungkin terjadi. */
export type PositionFailure = 'invalid' | 'too-large' | 'past-end' | 'live';

export type PositionResult =
  | { ok: true; positionMs: number }
  | { ok: false; reason: PositionFailure };

/** `90` → 90 detik; `1:30` → 90 detik; `1h02m03s` → 3.723.000 ms. */
export function parsePosition(input: string): PositionResult {
  const raw = input.trim().toLowerCase();
  if (!raw) return { ok: false, reason: 'invalid' };

  const ms = raw.includes(':') ? parseClock(raw) : parseClockParts(raw);
  if (ms === null) return { ok: false, reason: 'invalid' };
  if (ms <= 0) return { ok: false, reason: 'invalid' };
  if (ms > MAX_SEEK_MS) return { ok: false, reason: 'too-large' };

  return { ok: true, positionMs: ms };
}

/** `m:ss`, `h:mm:ss`. Menit & detik boleh lebih dari 59 ("1:90" = 150 detik). */
function parseClock(raw: string): number | null {
  const parts = raw.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  if (parts.some((part) => part === '' || !/^\d+$/.test(part))) return null;

  const numbers = parts.map((part) => Number(part));
  if (numbers.some((value) => !Number.isFinite(value))) return null;

  const [hours, minutes, seconds] =
    numbers.length === 3 ? numbers : [0, numbers[0] as number, numbers[1] as number];

  return ((hours as number) * 3_600 + (minutes as number) * 60 + (seconds as number)) * 1_000;
}

/** `90`, `90s`, `1m30s`, `1h2m`. */
function parseClockParts(raw: string): number | null {
  const matches = [...raw.matchAll(/(\d+)(h|m|s)?/g)];
  if (matches.length === 0) return null;

  // Input harus habis di pasangan angka+satuan; sisa seperti "1m30x" ditolak.
  const consumed = matches.reduce((total, match) => total + match[0].length, 0);
  if (consumed !== raw.length) return null;

  const units: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1_000 };
  let ms = 0;

  for (const match of matches) {
    const value = Number(match[1]);
    const unit = match[2] ?? 's';
    const multiplier = units[unit];
    if (!multiplier || !Number.isFinite(value)) return null;
    ms += value * multiplier;
  }

  return ms;
}

/**
 * Posisi yang benar-benar boleh dilompat.
 *
 * Cek durasi dipisah dari parsing supaya aturannya sama dipakai ulang: `/seek`
 * butuh keduanya, sementara yang lain hanya perlu parsing.
 */
export function resolveSeekPosition(
  input: string,
  durationMs: number,
  isStream: boolean,
): PositionResult {
  if (isStream || durationMs <= 0) return { ok: false, reason: 'live' };

  const parsed = parsePosition(input);
  if (!parsed.ok) return parsed;
  if (parsed.positionMs >= durationMs) return { ok: false, reason: 'past-end' };

  return parsed;
}

/** Alasan penolakan dalam bahasa user, dengan contoh format yang diterima. */
export function seekErrorMessage(reason: PositionFailure): string {
  switch (reason) {
    case 'live':
      return 'Lagu ini siaran langsung, jadi tidak ada posisi untuk dilompat.';
    case 'past-end':
      return 'Posisi itu melewati akhir lagu.';
    case 'too-large':
      return 'Posisi terlalu jauh — maksimal 6 jam.';
    default:
      return 'Posisi tidak terbaca. Contoh yang diterima: `90`, `1:30`, atau `1m30s`.';
  }
}