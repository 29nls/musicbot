import { getGuildConfigService } from '../config/index.js';
import { LocaleService } from './service.js';
import { defaultTranslator, translator, type MessageKey } from './catalog.js';
import { type Locale } from './types.js';

let service: LocaleService | undefined;

/**
 * Service bahasa, dibangun malas sekali per proses.
 *
 * Dibuat malas (bukan saat startup) karena language service tidak butuh
 * infrastruktur apa pun: ia hanya membaca config, dan config sudah punya
 * service-nya sendiri. Dengan begitu modul i18n bisa dipakai di tes tanpa
 * menyalakan apa pun.
 */
export function getLocaleService(): LocaleService {
  service ??= new LocaleService({ getConfig: (guildId) => getGuildConfigService().get(guildId) });
  return service;
}

/** Dipakai tes dan saat proses ditutup. */
export function resetI18nSingletons(): void {
  service = undefined;
}

/**
 * Pintasan: bahasa server + fungsi penerjemah dalam satu panggilan.
 *
 * Ini yang dipakai perintah:
 * `const t = await translatorFor(guildId);`
 * `errorEmbed(t('music.gate.needVoice'), t('embed.title.error'))`
 */
export async function translatorFor(guildId: string): Promise<Translator> {
  const locale = await getLocaleService().localeFor(guildId);
  return translatorForLocale(locale);
}

/**
 * Sama seperti `translatorFor`, tapi aman untuk interaksi tanpa server.
 *
 * `/help` dan `/ping` boleh dipakai di DM, jadi `guildId` bisa `null`.
 * Tanpa server tidak ada bahasa yang bisa diketahui, jadi bahasa bawaan
 * dipakai.
 */
export async function translatorForGuild(
  guildId: string | null | undefined,
): Promise<Translator> {
  if (!guildId) return defaultTranslator;

  return translatorFor(guildId);
}

/** Penerjemah untuk locale tertentu — tanpa menyentuh database. */
export function translatorForLocale(locale: Locale): Translator {
  return translator(locale);
}

/** Fungsi penerjemah yang sudah terikat ke satu locale. */
export type Translator = (key: MessageKey, params?: Record<string, string | number>) => string;