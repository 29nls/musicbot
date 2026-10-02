import type { GuildConfig } from '../config/index.js';
import { MODAL_SUBJECT_MAX_LENGTH, MODAL_SUBJECT_MIN_LENGTH } from './types.js';

/** Error validasi yang pesannya aman ditampilkan ke member lewat modal. */
export class TicketValidationError extends Error {
  public override readonly name = 'TicketValidationError';

  constructor(message: string) {
    super(message);
  }
}

/** Pesan kalau konfigurasi tiket belum lengkap; null = siap dipakai. */
export function missingTicketConfig(config: GuildConfig): string | null {
  if (!config.ticketCategoryId) return 'Kategori tiket belum diatur. Jalankan `/ticket setup` dulu.';
  if (!config.ticketStaffRoleId) return 'Role staff tiket belum diatur. Jalankan `/ticket setup` dulu.';

  return null;
}

/**
 * Bersihkan topik tiket dari modal.
 *
 * Spasi berulang diratakan supaya "tidak   bisa  masuk" tetap tampil rapi di
 * channel, lalu dipotong ke batas Discord. Menolak topik kosong atau terlalu
 * pendek di sini, bukan setelah tiket tercatat — supaya tidak ada tiket dengan
 * subjek "???" yang memblokir member membuka tiket baru.
 *
 * Murni supaya aturannya bisa diuji tanpa Discord.
 */
export function parseTicketSubject(raw: string | null | undefined): string {
  const subject = raw?.replace(/\s+/g, ' ').trim() ?? '';

  if (subject.length < MODAL_SUBJECT_MIN_LENGTH) {
    throw new TicketValidationError(
      `Tuliskan topik tiket minimal ${MODAL_SUBJECT_MIN_LENGTH} karakter, ` +
        'supaya staff tahu harus membantu apa.',
    );
  }

  return subject.slice(0, MODAL_SUBJECT_MAX_LENGTH);
}