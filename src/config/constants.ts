/** Warna embed & label kategori supaya tampilan bot konsisten di semua perintah. */
export const EMBED_COLORS = {
  primary: 0x5865f2,
  success: 0x57f287,
  warning: 0xfee75c,
  error: 0xed4245,
  music: 0x1db954,
} as const;

export const BOT_NAME = 'Harmony';

/** Kategori perintah — juga dipakai oleh /help untuk mengelompokkan. */
export const COMMAND_CATEGORIES = {
  core: { label: 'Umum', emoji: '⚙️' },
  music: { label: 'Musik', emoji: '🎵' },
  admin: { label: 'Admin', emoji: '🛡️' },
} as const;

export type CommandCategory = keyof typeof COMMAND_CATEGORIES;
