/**
 * Bahasa yang dipakai bot (PRD §5.3 "Dukungan multi-bahasa ID/EN").
 *
 * **Kenapa file ini ada.** Kolom `locale` sudah ada di `guild_config` sejak
 * migrasi pertama, lengkap dengan default `"id"` di skema, di tipe domain, di
 * mapping, dan di validasi — tapi **tidak satu baris kode pun memakainya**, dan
 * `/config set` bahkan tidak punya opsi untuk mengubahnya. Pola itu persis sama
 * dengan `REDIS_URL` yang sejak awal jadi env wajib tapi tidak pernah dipakai:
 * infrastrukturnya siap, fiturnya tidak pernah dibuat, dan tidak ada yang gagal
 * karena kekosongan itu tidak terlihat dari mana pun.
 *
 * Dua bahasa saja, dan itu disengaja. Dua bahasa bisa dijaga dua orang; sepuluh
 * bahasa butuh sinkronisasi yang tidak pernah selesai, dan hasilnya katalog
 * setengah terisi — lebih buruk daripada tidak ada sama sekali.
 */

/** Bahasa yang didukung. */
export const LOCALES = ['id', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * Bahasa bawaan.
 *
 * Indonesia, sesuai NFR §11 ("tanpa asumsi bahasa selain ID pada v1"): bahasa
 * pertama bot adalah bahasa penggunanya, dan bahasa lain harus diminta.
 */
export const DEFAULT_LOCALE: Locale = 'id';

/** Label locale untuk ditampilkan ke admin. */
export const LOCALE_LABELS: Record<Locale, string> = {
  id: 'Bahasa Indonesia',
  en: 'English',
};

/** Alias yang diterima, supaya orang tidak harus menebak nama persisnya. */
const LOCALE_ALIASES: Record<string, Locale> = {
  id: 'id',
  ind: 'id',
  indo: 'id',
  indonesia: 'id',
  'bahasa indonesia': 'id',
  en: 'en',
  eng: 'en',
  english: 'en',
  inggris: 'en',
};

/**
 * Baca locale dari teks bebas; `null` kalau tidak dikenal.
 *
 * Alias itu penting karena `/config set locale:...` diketik manusia, bukan
 * dipilih dari daftar. `null` berarti "jangan diam-diam pakai bahasa lain" —
 * pemanggil yang salah harus diberi tahu, bukan mendapat jawaban dalam bahasa
 * yang tidak ia minta.
 */
export function parseLocale(input: string | null | undefined): Locale | null {
  if (typeof input !== 'string') return null;

  return LOCALE_ALIASES[input.trim().toLowerCase()] ?? null;
}

/** Locale yang selalu valid: nilai tidak dikenal jatuh ke bawaan. */
export function toLocale(input: string | null | undefined): Locale {
  return parseLocale(input) ?? DEFAULT_LOCALE;
}