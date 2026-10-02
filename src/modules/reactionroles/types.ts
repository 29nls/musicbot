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

/** Masa hidup panel paling pendek yang masuk akal (10 menit). */
export const MIN_PANEL_LIFETIME_MS = 10 * 60_000;

/** Masa hidup panel paling panjang yang bisa diminta (365 hari). */
export const MAX_PANEL_LIFETIME_MS = 365 * 86_400_000;

/**
 * Input yang berarti "tidak ada masa hidup" — panel permanen.
 *
 * Default `/reactionrole post` jadi permanen supaya perilaku yang sudah ada
 * tidak berubah; kata-kata ini hanya tersedia kalau admin memang memintanya.
 */
export const PERMANENT_DURATION_TOKENS: readonly string[] = [
  'permanen',
  'permanan',
  'selamanya',
  'tanpa',
  'none',
  '0',
];

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
  /** Kapan select menu harus mati; null = panel permanen. */
  expiresAt: Date | null;
  /** Kapan panel dinonaktifkan; null = masih aktif. */
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  options: ReactionRoleOption[];
}

/**
 * Apakah panel masih bisa memberi role.
 *
 * `expiresAt` ikut diperiksa walau `closedAt` masih null: bot bisa mati atau
 * connection terputus tepat saat masa hidup habis, sehingga penyapuan belum
 * sempat menonaktifkan pesannya. Tanpa cek ini, member yang masih menyimpan
 * pesan lama bisa tetap mengambil role dari panel yang sudah "berakhir".
 */
export function isPanelActive(panel: ReactionRolePanel, now = new Date()): boolean {
  if (panel.closedAt) return false;

  return panel.expiresAt === null || panel.expiresAt > now;
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
  /** Kapan panel harus mati; null = permanen. */
  expiresAt: Date | null;
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
