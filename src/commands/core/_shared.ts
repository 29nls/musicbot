import { COMMAND_CATEGORIES, type CommandCategory } from '../../config/constants.js';
import { defaultTranslator, type MessageKey, type Translator } from '../../modules/i18n/index.js';

/**
 * Kunci label kategori untuk `/help`.
 *
 * `COMMAND_CATEGORIES` tetap menyimpan label Bahasa Indonesia sebagai sumber
 * bersama, tapi yang tampil ke member dibaca dari katalog: `/help` juga jalan
 * di DM tanpa server maupun di server English, jadi label yang tampil tidak
 * boleh ikut bahasa tempat konstanta itu ditulis. Tes penjaga membandingkan
 * label Indonesia di katalog dengan isi konstanta.
 */
const CATEGORY_LABEL_KEYS: Record<CommandCategory, MessageKey> = {
  core: 'help.category.core',
  music: 'help.category.music',
  admin: 'help.category.admin',
};

/** Label kategori perintah sesuai bahasa server. */
export function commandCategoryLabel(
  category: CommandCategory,
  t: Translator = defaultTranslator,
): string {
  return t(CATEGORY_LABEL_KEYS[category]);
}

/** Emoji kategori — sama di semua bahasa, jadi tidak perlu katalog. */
export function commandCategoryEmoji(category: CommandCategory): string {
  return COMMAND_CATEGORIES[category].emoji;
}

/**
 * Uptime bot sesuai bahasa server, mis. `3_723_000` → "1 jam 2 menit".
 *
 * Sempat jadi `formatUptime()` di `utils/duration.ts` yang menyusun kalimat
 * Bahasa Indonesia sendiri. Fungsinya pindah ke sini karena `utils` tidak
 * boleh mengimpor modul i18n, sementara `/ping` juga dipanggil di server
 * English.
 */
export function uptimeText(ms: number, t: Translator = defaultTranslator): string {
  if (!Number.isFinite(ms) || ms <= 0) return t('ping.uptime.now');

  const totalSeconds = Math.floor(ms / 1_000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);

  // Bahasa Inggris butuh bentuk tunggal dan jamak ("1 hour" vs "2 hours"), jadi
  // tiap satuan punya dua kunci. Bahasa Indonesia memakai teks yang sama.
  const parts: string[] = [];
  if (days > 0) parts.push(unit(t, 'ping.uptime.day', 'ping.uptime.days', days));
  if (hours > 0) parts.push(unit(t, 'ping.uptime.hour', 'ping.uptime.hours', hours));
  if (minutes > 0) parts.push(unit(t, 'ping.uptime.minute', 'ping.uptime.minutes', minutes));

  return parts.length > 0
    ? parts.join(' ')
    : unit(t, 'ping.uptime.second', 'ping.uptime.seconds', totalSeconds);
}

function unit(t: Translator, one: MessageKey, many: MessageKey, count: number): string {
  return t(count === 1 ? one : many, { count });
}