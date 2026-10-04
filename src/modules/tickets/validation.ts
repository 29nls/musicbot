import { defaultTranslator, type MessageKey, type Translator } from '../i18n/index.js';
import type { GuildConfig } from '../config/index.js';
import { MODAL_SUBJECT_MAX_LENGTH, MODAL_SUBJECT_MIN_LENGTH } from './types.js';

/**
 * Error validasi yang pesannya aman ditampilkan ke member lewat modal.
 *
 * Yang disimpan adalah kunci katalog + parameternya, bukan kalimat jadi:
 * pemanggil yang menyusun embed menerjemahkannya ke bahasa server. `message`
 * tetap diisi bahasa Indonesia untuk log internal dan `toThrow` di tes.
 */
export class TicketValidationError extends Error {
  public override readonly name = 'TicketValidationError';

  constructor(
    public readonly key: MessageKey,
    public readonly params?: Record<string, string | number>,
  ) {
    super(defaultTranslator(key, params));
  }
}

/** Pesan kalau konfigurasi tiket belum lengkap; null = siap dipakai. */
export function missingTicketConfig(
  config: GuildConfig,
  t: Translator = defaultTranslator,
): string | null {
  if (!config.ticketCategoryId) return t('ticket.err.noCategory');
  if (!config.ticketStaffRoleId) return t('ticket.err.noStaffRole');

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
    throw new TicketValidationError('ticket.err.subjectTooShort', {
      min: MODAL_SUBJECT_MIN_LENGTH,
    });
  }

  return subject.slice(0, MODAL_SUBJECT_MAX_LENGTH);
}
