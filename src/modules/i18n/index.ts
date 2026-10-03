/**
 * Barrel modul i18n.
 *
 * Katalog, service, dan penerjemah tetap di file masing-masing; file ini hanya
 * mengoleksi apa yang boleh dipakai modul lain.
 */
export {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_LABELS,
  parseLocale,
  toLocale,
} from './types.js';
export type { Locale } from './types.js';

export {
  MESSAGE_KEYS,
  defaultTranslator,
  interpolate,
  isCatalogComplete,
  missingKeys,
  translate,
  translator,
} from './catalog.js';
export type { MessageKey } from './catalog.js';

export { DEFAULT_LOCALE_CACHE_TTL_MS, LocaleService } from './service.js';
export type { LocaleServiceOptions } from './service.js';

export {
  getLocaleService,
  resetI18nSingletons,
  translatorFor,
  translatorForLocale,
} from './singleton.js';
export type { Translator } from './singleton.js';

export { EN_COMMAND_TRANSLATIONS, MAX_COMMAND_DESCRIPTION_LENGTH, commandsMissingTranslation } from './commandTranslations.js';
export type { CommandTranslation, CommandTranslations } from './commandTranslations.js';

export { applyCommandLocalization, applyCommandLocalizations } from './applyTranslations.js';