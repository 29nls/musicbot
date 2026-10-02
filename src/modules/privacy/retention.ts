/**
 * Masa simpan data — satu-satunya tempat yang mengatakannya, supaya yang
 * ditulis ke user dijamin sama dengan yang dijalankan job retensi.
 *
 * Nilai diambil dari modul yang akhirnya mengeksekusinya, bukan ditulis ulang di
 * sini: dua versi angka yang berbeda adalah cara paling umum membuat janji
 * retensi berbohong tanpa disadari.
 */

import { LOG_RETENTION_DAYS } from '../logging/retention.js';
import { RETENTION_MONTHS } from '../moderation/retention.js';

export interface RetentionStatement {
  /** Nama kelompok data, persis seperti tampilannya ke user. */
  label: string;
  /** Umur simpan dalam hari. */
  days: number;
  /** Kapan hitungannya mulai berjalan — tidak selalu sejak baris dibuat. */
  since: string;
}

/**
 * Masa simpan tiap kelompok data.
 *
 * `since` ditulis eksplisit karena tidak semuanya sama: log dihitung sejak
 * ditulis, tiket dihitung sejak **ditutup** — tiket yang masih terbuka tidak
 * punya batas, karena yang disapu hanya baris yang sudah tertutup.
 */
export const RETENTION_STATEMENTS: readonly RetentionStatement[] = [
  {
    label: 'Kasus moderasi, catatan internal, & peringatan',
    days: RETENTION_MONTHS * 30,
    since: 'sejak aksinya dicatat',
  },
  {
    label: 'Tiket & transkrip percakapannya',
    days: RETENTION_MONTHS * 30,
    since: 'sejak tiket ditutup',
  },
  {
    label: 'Riwayat log event',
    days: LOG_RETENTION_DAYS,
    since: 'sejak entri log ditulis',
  },
];

/** Umur simpan kasus moderasi dalam tahun bulat, untuk teks ajakan `/data-delete`. */
export const MODERATION_RETENTION_YEARS = Math.round(RETENTION_MONTHS / 12);
