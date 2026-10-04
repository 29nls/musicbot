import { defaultTranslator, type Translator } from '../i18n/catalog.js';
import { MODULE_LABELS, type ModulesEnabled } from './types.js';

/**
 * Nama & deskripsi modul sesuai bahasa server.
 *
 * Berada di berkas sendiri, bukan di `types.ts`, karena `types.ts` tidak boleh
 * mengimpor modul i18n: `i18n` memuat service bahasa yang membaca config, jadi
 * impor balik dari `types.ts` membuat siklus yang membuat `MAX_VOLUME` (dan
 * konstanta lain di `types.ts`) terbaca `undefined` saat skema zod dibangun.
 */

/** Nama modul sesuai bahasa server. */
export function moduleLabel(key: keyof ModulesEnabled, t: Translator = defaultTranslator): string {
  return t(MODULE_LABELS[key].labelKey);
}

/** Deskripsi modul sesuai bahasa server. */
export function moduleDescription(
  key: keyof ModulesEnabled,
  t: Translator = defaultTranslator,
): string {
  return t(MODULE_LABELS[key].descriptionKey);
}