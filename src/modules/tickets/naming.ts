import { MAX_CHANNEL_NAME_LENGTH, formatTicketId } from './types.js';

/**
 * Bersihkan nama channel Discord: huruf/angka, spasi, `-`, dan `_` saja.
 *
 * Discord hanya menerima pola `[a-z0-9-_]`, jadi nama mention member (yang bisa
 * berisi titik, emoji, atau spasi ganda) harus disaring sebelum dipakai.
 */
export function slugify(value: string, max = 24): string {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, max);

  return slug;
}

/**
 * Nama channel tiket yang masih terbuka: `ticket-0007-sasha`.
 *
 * Bagian dari nama member selalu dipotong dulu supaya nomor tiket (dan
 * keunikannya) tidak pernah hilang.
 */
export function ticketChannelName(ticketNumber: number, nickname: string): string {
  const slug = slugify(nickname, 24);
  const suffix = slug ? `-${slug}` : '';
  const prefix = `ticket-${formatTicketId(ticketNumber).replace('#', '')}`;

  return `${prefix}${suffix}`.slice(0, MAX_CHANNEL_NAME_LENGTH);
}

/** Nama channel setelah ditutup — jelas terlihat sudah tidak aktif. */
export function closedTicketChannelName(ticketNumber: number): string {
  return `closed-${formatTicketId(ticketNumber).replace('#', '')}`;
}