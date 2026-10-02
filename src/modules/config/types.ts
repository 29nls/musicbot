/** Modul yang bisa dinyalakan/dimatikan per server. */
export interface ModulesEnabled {
  music: boolean;
  moderation: boolean;
  automod: boolean;
  logging: boolean;
}

/** Konfigurasi bot untuk satu server — bentuk domain, bukan bentuk baris DB. */
export interface GuildConfig {
  guildId: string;
  logChannelId: string | null;
  welcomeChannelId: string | null;
  goodbyeChannelId: string | null;
  djRoleId: string | null;
  welcomeMessage: string | null;
  defaultVolume: number;
  idleTimeoutSec: number;
  modules: ModulesEnabled;
  locale: string;
}

/** Perubahan sebagian. Field yang tidak dikirim tidak diubah. */
export interface GuildConfigPatch {
  logChannelId?: string | null;
  welcomeChannelId?: string | null;
  goodbyeChannelId?: string | null;
  djRoleId?: string | null;
  welcomeMessage?: string | null;
  defaultVolume?: number;
  idleTimeoutSec?: number;
  modules?: Partial<ModulesEnabled>;
  locale?: string;
}

/** Nilai default kalau server belum pernah menjalankan /setup. */
export const DEFAULT_MODULES: ModulesEnabled = {
  music: true,
  moderation: true,
  automod: false,
  logging: false,
};

export const DEFAULT_IDLE_TIMEOUT_SEC = 300;
export const MIN_IDLE_TIMEOUT_SEC = 30;
export const MAX_IDLE_TIMEOUT_SEC = 86_400;
export const MAX_VOLUME = 200;
export const MAX_WELCOME_MESSAGE_LENGTH = 1_500;

export const MODULE_LABELS: Record<keyof ModulesEnabled, { label: string; description: string }> = {
  music: { label: 'Musik', description: 'Pemutaran lagu, antrean, dan kontrol DJ' },
  moderation: { label: 'Moderasi', description: 'Ban, kick, timeout, warn, dan purge' },
  automod: { label: 'Automod', description: 'Anti-spam, anti-link, dan filter kata' },
  logging: { label: 'Logging', description: 'Catat event member, pesan, dan channel ke channel log' },
};
