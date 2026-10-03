/**
 * Masa simpan data — satu-satunya tempat yang mengatakannya, supaya yang
 * ditulis ke user dijamin sama dengan yang dijalankan job retensi.
 *
 * Nilai diambil dari modul yang akhirnya mengeksekusinya, bukan ditulis ulang di
 * sini: dua versi angka yang berbeda adalah cara paling umum membuat janji
 * retensi berbohong tanpa disadari.
 */

import type { MessageKey } from '../i18n/index.js';
import { LOG_RETENTION_DAYS } from '../logging/retention.js';
import { RETENTION_MONTHS } from '../moderation/retention.js';

export interface RetentionStatement {
  /** Kunci katalog untuk nama kelompok data — kalimatnya milik i18n. */
  labelKey: MessageKey;
  /** Umur simpan dalam hari. */
  days: number;
  /** Kunci katalog untuk kapan hitungannya mulai berjalan. */
  sinceKey: MessageKey;
}

/**
 * Masa simpan tiap kelompok data.
 *
 * `sinceKey` ditulis eksplisit karena tidak semuanya sama: log dihitung sejak
 * ditulis, tiket dihitung sejak **ditutup** — tiket yang masih terbuka tidak
 * punya batas, karena yang disapu hanya baris yang sudah tertutup.
 *
 * Yang disimpan di sini **kunci katalog**, bukan kalimatnya: angka retensi
 * milik modul ini, Bahasa-nya milik i18n, jadi keduanya tidak bisa diam-diam
 * berbeda dan terpisah di dua tempat.
 */
export const RETENTION_STATEMENTS: readonly RetentionStatement[] = [
  {
    labelKey: 'privacy.retention.cases',
    days: RETENTION_MONTHS * 30,
    sinceKey: 'privacy.retention.casesSince',
  },
  {
    labelKey: 'privacy.retention.tickets',
    days: RETENTION_MONTHS * 30,
    sinceKey: 'privacy.retention.ticketsSince',
  },
  {
    labelKey: 'privacy.retention.logs',
    days: LOG_RETENTION_DAYS,
    sinceKey: 'privacy.retention.logsSince',
  },
];

/** Umur simpan kasus moderasi dalam tahun bulat, untuk teks ajakan `/data-delete`. */
export const MODERATION_RETENTION_YEARS = Math.round(RETENTION_MONTHS / 12);