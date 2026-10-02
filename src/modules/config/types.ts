/** Modul yang bisa dinyalakan/dimatikan per server. */
export interface ModulesEnabled {
  music: boolean;
  moderation: boolean;
  automod: boolean;
  logging: boolean;
  /** Panel self-assign role (Fase 2, PRD §7.4). */
  reactions: boolean;
  /** Sistem tiket dasar (Fase 2, PRD §5.2). */
  tickets: boolean;
}

/** Konfigurasi bot untuk satu server — bentuk domain, bukan bentuk baris DB. */
export interface GuildConfig {
  guildId: string;
  logChannelId: string | null;
  welcomeChannelId: string | null;
  goodbyeChannelId: string | null;
  djRoleId: string | null;
  /** Role otomatis untuk member manusia yang baru join. */
  autoroleId: string | null;
  /** Role otomatis untuk bot yang baru join (bisa beda dari manusia). */
  autoroleBotId: string | null;
  welcomeMessage: string | null;
  goodbyeMessage: string | null;
  defaultVolume: number;
  idleTimeoutSec: number;
  /** Channel tempat tombol "Buat Tiket" dikirim. */
  ticketPanelChannelId: string | null;
  /** Kategori tempat channel tiket baru dibuat. */
  ticketCategoryId: string | null;
  /** Role staff: bisa melihat semua tiket & menutupnya. */
  ticketStaffRoleId: string | null;
  /** ID pesan panel tiket, supaya bisa diedit tanpa kirim ulang. */
  ticketPanelMessageId: string | null;
  modules: ModulesEnabled;
  locale: string;
}

/** Perubahan sebagian. Field yang tidak dikirim tidak diubah. */
export interface GuildConfigPatch {
  logChannelId?: string | null;
  welcomeChannelId?: string | null;
  goodbyeChannelId?: string | null;
  djRoleId?: string | null;
  autoroleId?: string | null;
  autoroleBotId?: string | null;
  welcomeMessage?: string | null;
  goodbyeMessage?: string | null;
  defaultVolume?: number;
  idleTimeoutSec?: number;
  ticketPanelChannelId?: string | null;
  ticketCategoryId?: string | null;
  ticketStaffRoleId?: string | null;
  /** Diperbarui tim ticket saja saat panel dikirim ulang. */
  ticketPanelMessageId?: string | null;
  modules?: Partial<ModulesEnabled>;
  locale?: string;
}

/** Nilai default kalau server belum pernah menjalankan /setup. */
export const DEFAULT_MODULES: ModulesEnabled = {
  music: true,
  moderation: true,
  automod: false,
  logging: false,
  reactions: false,
  tickets: false,
};

export const DEFAULT_IDLE_TIMEOUT_SEC = 300;
export const MIN_IDLE_TIMEOUT_SEC = 30;
export const MAX_IDLE_TIMEOUT_SEC = 86_400;
export const MAX_VOLUME = 200;
/** Berlaku untuk pesan welcome maupun goodbye. */
export const MAX_WELCOME_MESSAGE_LENGTH = 1_500;

export const MODULE_LABELS: Record<keyof ModulesEnabled, { label: string; description: string }> = {
  music: { label: 'Musik', description: 'Pemutaran lagu, antrean, dan kontrol DJ' },
  moderation: { label: 'Moderasi', description: 'Ban, kick, timeout, warn, dan purge' },
  automod: { label: 'Automod', description: 'Anti-spam, anti-link, dan filter kata' },
  logging: { label: 'Logging', description: 'Catat event member, pesan, dan channel ke channel log' },
  reactions: { label: 'Reaction Roles', description: 'Ambil role sendiri lewat select menu' },
  tickets: { label: 'Tiket', description: 'Channel privat untuk permintaan support' },
};
