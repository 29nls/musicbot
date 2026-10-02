/**
 * Reaction roles (Fase 2, PRD §7.4): member mengambil role sendiri lewat
 * string select menu pada satu pesan panel.
 */

/** Awalan customId untuk opsi role — dipakai router komponen. */
export const REACTION_ROLE_PREFIX = 'rr:';

/**
 * Batas opsi string select menu Discord (juga batas baris per panel).
 * Satu panel tidak bisa offers lebih dari ini dalam satu pesan.
 */
export const MAX_PANEL_OPTIONS = 25;

/** Batas Discord: label opsi 100 karakter, description 100 karakter. */
export const MAX_OPTION_LABEL_LENGTH = 100;
export const MAX_OPTION_DESCRIPTION_LENGTH = 100;

/** Panjang maksimum nama channel Discord. */
export const MAX_CHANNEL_NAME_LENGTH = 100;

export interface ReactionRoleOption {
  id: number;
  panelId: number;
  roleId: string;
  /** Nama tampilan di select menu; null = pakai nama role aslinya. */
  label: string | null;
  /** Emoji role Discord sebagai ikon opsi, kalau ada. */
  emoji: string | null;
  description: string | null;
  position: number;
}

export interface ReactionRolePanel {
  id: number;
  guildId: string;
  channelId: string;
  /** ID pesan panel; null kalau pesan belum sempat terkirim. */
  messageId: string | null;
  createdAt: Date;
  updatedAt: Date;
  options: ReactionRoleOption[];
}

/** Satu role yang akan ditambahkan ke panel. */
export interface RoleInput {
  roleId: string;
  label?: string | null;
  emoji?: string | null;
  description?: string | null;
}

export interface CreatePanelInput {
  guildId: string;
  channelId: string;
  roles: RoleInput[];
}

/** Hasil pencarian opsi: opsi + panelnya, untuk handler select menu. */
export interface PanelOptionLookup {
  panel: ReactionRolePanel;
  option: ReactionRoleOption;
}

/** `rr:42` → 42. null kalau bukan customId milik fitur ini. */
export function parseRoleOptionCustomId(customId: string): number | null {
  if (!customId.startsWith(REACTION_ROLE_PREFIX)) return null;

  const raw = customId.slice(REACTION_ROLE_PREFIX.length);
  if (!/^\d{1,9}$/.test(raw)) return null;

  const value = Number(raw);
  return value >= 1 ? value : null;
}

/** CustomId opsi role. Pendek supaya aman di bawah batas 100 karakter. */
export function roleOptionCustomId(optionId: number): string {
  return `${REACTION_ROLE_PREFIX}${optionId}`;
}
