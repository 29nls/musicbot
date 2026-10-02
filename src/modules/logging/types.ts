/** Enam kategori log sesuai PRD §7.3. */
export const LOG_CATEGORIES = ['member', 'message', 'channel', 'role', 'voice', 'server'] as const;

export type LogCategory = (typeof LOG_CATEGORIES)[number];

export function isLogCategory(value: string): value is LogCategory {
  return (LOG_CATEGORIES as readonly string[]).includes(value);
}

/** Label, emoji, dan warna embed per kategori. */
export const CATEGORY_META: Record<LogCategory, { label: string; emoji: string; color: number }> = {
  member: { label: 'Member', emoji: '👤', color: 0x5865f2 },
  message: { label: 'Pesan', emoji: '💬', color: 0xfee75c },
  channel: { label: 'Channel', emoji: '📁', color: 0x57f287 },
  role: { label: 'Role', emoji: '🎭', color: 0xeb459e },
  voice: { label: 'Voice', emoji: '🔊', color: 0x1abc9c },
  server: { label: 'Server', emoji: '🏠', color: 0xed4245 },
};

/** Satu baris routing: kategori X dikirim ke channel Y. */
export interface LogSubscription {
  guildId: string;
  category: LogCategory;
  channelId: string;
}
