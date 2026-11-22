import { defaultTranslator, type MessageKey } from '../i18n/index.js';
import {
  MAX_GIVEAWAY_DURATION_MS,
  MAX_GIVEAWAY_PRIZE_LENGTH,
  MAX_GIVEAWAY_WINNERS,
  MIN_GIVEAWAY_DURATION_MS,
  MIN_GIVEAWAY_WINNERS,
} from './types.js';

/**
 * Error validasi yang pesannya aman ditampilkan ke user Discord.
 *
 * Yang disimpan adalah kunci katalog + parameternya, bukan kalimat jadi:
 * pemanggil yang menyusun embed menerjemahkannya ke bahasa server.
 */
export class GiveawayValidationError extends Error {
  public override readonly name = 'GiveawayValidationError';

  constructor(
    public readonly key: MessageKey,
    public readonly params?: Record<string, string | number>,
  ) {
    super(defaultTranslator(key, params));
  }
}

/** Ratakan spasi supaya hadiah tidak tampil sebagai paragraf berongga. */
export function normalizePrize(input: string): string {
  const prize = input.trim().replace(/\s+/g, ' ');
  if (!prize) throw new GiveawayValidationError('giveaway.err.prizeEmpty');

  if (prize.length > MAX_GIVEAWAY_PRIZE_LENGTH) {
    throw new GiveawayValidationError('giveaway.err.prizeTooLong', {
      max: MAX_GIVEAWAY_PRIZE_LENGTH,
    });
  }

  return prize;
}

export function normalizeWinnersCount(input: number): number {
  if (
    !Number.isInteger(input) ||
    input < MIN_GIVEAWAY_WINNERS ||
    input > MAX_GIVEAWAY_WINNERS
  ) {
    throw new GiveawayValidationError('giveaway.err.winnersRange', {
      min: MIN_GIVEAWAY_WINNERS,
      max: MAX_GIVEAWAY_WINNERS,
    });
  }

  return input;
}

const DURATION_UNIT_MS: Record<string, number> = {
  m: 60_000,
  menit: 60_000,
  h: 3_600_000,
  jam: 3_600_000,
  d: 86_400_000,
  hari: 86_400_000,
};

/**
 * Baca durasi giveaway, mis. `10m`, `2h`, atau `7d`.
 *
 * Tanpa satuan dianggap menit: giveaway biasanya dihitung dalam menit, bukan
 * jam seperti masa hidup panel reaction role.
 */
export function parseGiveawayDuration(
  input: string | null | undefined,
  now = new Date(),
): Date {
  const raw = input?.trim() ?? '';
  const trimmed = raw.toLowerCase();
  const match = /^(\d{1,5})\s*([a-z]*)$/.exec(trimmed);
  const amountText = match?.[1];
  if (!amountText) {
    throw new GiveawayValidationError('giveaway.err.durationUnreadable', { value: raw });
  }

  const amount = Number(amountText);
  const unit = match?.[2] ?? '';
  const multiplier = unit === '' ? 60_000 : DURATION_UNIT_MS[unit];
  if (multiplier === undefined) {
    throw new GiveawayValidationError('giveaway.err.durationUnit', { unit });
  }

  const ms = amount * multiplier;
  if (ms < MIN_GIVEAWAY_DURATION_MS) {
    throw new GiveawayValidationError('giveaway.err.durationMin');
  }
  if (ms > MAX_GIVEAWAY_DURATION_MS) {
    throw new GiveawayValidationError('giveaway.err.durationMax');
  }

  return new Date(now.getTime() + ms);
}


/**
 * Pilih pemenang unik tanpa mengubah daftar aslinya.
 *
 * Fisher-Yates sebagian: setelah `count` langkah, `count` elemen pertama sudah
 * teracak seragam. `random` disuntikkan supaya hasilnya bisa diuji.
 */
export function pickWinners(
  userIds: readonly string[],
  count: number,
  random: () => number = Math.random,
): string[] {
  const pool = [...new Set(userIds)];
  const take = Math.max(0, Math.min(Math.trunc(count), pool.length));

  for (let i = 0; i < take; i += 1) {
    const j = i + Math.floor(random() * (pool.length - i));
    const current = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = current;
  }

  return pool.slice(0, take);
}
