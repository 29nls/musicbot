/**
 * Giveaway: satu pesan dengan tombol, satu entri per member, lalu pemenang
 * dipilih saat waktu habis. Entri peserta hanya hidup selama giveaway aktif.
 */

/** Awalan customId tombol giveaway — dipakai router komponen. */
export const GIVEAWAY_PREFIX = 'giveaway:';

/** Awalan khusus tombol ikut; dipisah supaya tombol lain bisa ditambah nanti. */
export const GIVEAWAY_JOIN_PREFIX = `${GIVEAWAY_PREFIX}join:`;

/** Batas kolom `prize` dan panjang tampilan yang masih nyaman di embed. */
export const MAX_GIVEAWAY_PRIZE_LENGTH = 200;

/** Batas jumlah pemenang sekali undi. */
export const MIN_GIVEAWAY_WINNERS = 1;
export const MAX_GIVEAWAY_WINNERS = 20;

/** Masa hidup giveaway: paling singkat satu menit, paling lama 30 hari. */
export const MIN_GIVEAWAY_DURATION_MS = 60_000;
export const MAX_GIVEAWAY_DURATION_MS = 30 * 86_400_000;

export interface Giveaway {
  id: number;
  guildId: string;
  channelId: string;
  /** ID pesan giveaway; null kalau pesan belum sempat terkirim. */
  messageId: string | null;
  prize: string;
  winnersCount: number;
  endsAt: Date;
  /** null = masih aktif. */
  endedAt: Date | null;
  createdAt: Date;
}

export interface CreateGiveawayInput {
  guildId: string;
  channelId: string;
  prize: string;
  winnersCount: number;
  endsAt: Date;
}

/** `giveaway:join:42` → 42. null kalau bukan customId milik fitur ini. */
export function parseGiveawayJoinCustomId(customId: string): number | null {
  if (!customId.startsWith(GIVEAWAY_JOIN_PREFIX)) return null;

  const raw = customId.slice(GIVEAWAY_JOIN_PREFIX.length);
  if (!/^\d{1,9}$/.test(raw)) return null;

  const value = Number(raw);
  return value >= 1 ? value : null;
}

/** CustomId tombol ikut. Pendek supaya aman di bawah batas 100 karakter. */
export function giveawayJoinCustomId(giveawayId: number): string {
  return `${GIVEAWAY_JOIN_PREFIX}${giveawayId}`;
}

/**
 * Apakah giveaway masih menerima entri.
 *
 * `endsAt` ikut diperiksa walau job belum sempat menutupnya: tombol lama bisa
 * masih diklik setelah waktu habis, dan entri yang masuk setelah undian tidak
 * pernah punya kesempatan menang.
 */
export function isGiveawayActive(giveaway: Giveaway, now = new Date()): boolean {
  return giveaway.endedAt === null && giveaway.endsAt.getTime() > now.getTime();
}
