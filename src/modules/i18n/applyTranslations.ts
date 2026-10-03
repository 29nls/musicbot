import { Locale } from 'discord.js';
import { EN_COMMAND_TRANSLATIONS } from './commandTranslations.js';

/**
 * Menyisipkan terjemahan bahasa Inggris ke payload slash command saat deploy.
 *
 * Discord sendiri tidak pernah menyentuh payload ini — dia menerima satu
 * `RESTPostAPIApplicationCommandsJSONBody` dan juga tidak tahu soal bahasa.
 * Jadi penerjemahan harus selesai **sebelum** payload dikirim, dan itu sebabnya
 * file ini murni: bisa diuji tanpa Discord, tanpa token, tanpa jaringan.
 *
 * Fungsinya generik (`T`) supaya payload yang asli dari discord.js bisa langsung
 * diteruskan tanpa konversi — tipe `localizations` di sana memakai union kode
 * bahasa Discord, sedangkan kode internal kita memakai `en`.
 *
 * **Kode bahasa Discord bukan `en`.** Enum `Locale` di discord.js tidak punya
 * `en` polos, hanya `EnglishUS` dan `EnglishGB`. Menulis `en` membuat Discord
 * membalas 50035 (`Value "en" is not a valid enum value`) untuk SETIAP perintah
 * yang punya terjemahan, dan karena deploy memakai satu payload untuk seluruh
 * perintah, **tidak satu pun** perintah yang ikut ter-deploy. Itu sebabnya kode
 * ini memakai enum Discord, bukan string: kalau kodenya salah, typecheck
 * langsung menangkap.
 */

/**
 * Tambahkan terjemahan Inggris ke satu payload perintah.
 *
 * Perintah tanpa entri tabel diteruskan **apa adanya** — tanpa bahasa Inggris,
 * bukan dengan bahasa Inggris kosong. Discord memperlakukan `null` sebagai
 * "fallback ke bahasa default", jadi mengisinya dengan string kosong akan
 * membuat perintah tampil tanpa deskripsi sama sekali.
 *
 * Isi `localizations` yang sudah ada tidak ditimpa: kalau suatu saat perintah
 * sudah punya terjemahan bahasa lain, keduanya harus tetap berdampingan.
 */
export function applyCommandLocalization<T extends { name: string }>(json: T): T {
  const translation = EN_COMMAND_TRANSLATIONS[json.name];

  if (!translation) return json;

  const source = json as Record<string, unknown>;
  const existingNames = source.name_localizations as Record<string, string> | undefined;
  const existingDescriptions = source.description_localizations as Record<string, string> | undefined;

  return {
    ...json,
    name_localizations: { ...(existingNames ?? {}), [Locale.EnglishUS]: translation.en.name },
    description_localizations: {
      ...(existingDescriptions ?? {}),
      [Locale.EnglishUS]: translation.en.description,
    },
  } as T;
}

/**
 * Terapkan terjemahan ke seluruh daftar payload perintah.
 *
 * Kerjakan ini **sebelum** dikirim ke Discord: perintah yang sudah terdaftar di
 * gateway tidak ikut berubah, jadi deskripsi baru baru terlihat setelah satu
 * siklus deploy berikutnya.
 */
export function applyCommandLocalizations<T extends { name: string }>(commands: readonly T[]): T[] {
  return commands.map((command) => applyCommandLocalization(command));
}