// Tipe saja: `types.ts` tidak boleh mengimpor nilai runtime dari i18n.
// Alasannya ada di `labels.ts`.
import type { MessageKey } from '../i18n/catalog.js';

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
  /** Perintah custom: teks balasan buatan admin (Fase 2, PRD §5.2). */
  customCommands: boolean;
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
  /** Channel voice 24/7; null = mode ini mati di server ini. */
  stayChannelId: string | null;
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
  /** Set `null` untuk mematikan mode 24/7 di server ini. */
  stayChannelId?: string | null;
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
  // Default mati: bot yang membaca tiap pesan di server orang lain harus
  // dinyalakan secara sadar oleh admin, bukan diam-diam ikut berbunyi.
  customCommands: false,
};

export const DEFAULT_IDLE_TIMEOUT_SEC = 300;
export const MIN_IDLE_TIMEOUT_SEC = 30;
export const MAX_IDLE_TIMEOUT_SEC = 86_400;
export const MAX_VOLUME = 200;
/** Berlaku untuk pesan welcome maupun goodbye. */
export const MAX_WELCOME_MESSAGE_LENGTH = 1_500;

/**
 * Kunci katalog untuk nama dan deskripsi tiap modul.
 *
 * Dulu objek ini menyimpan kalimat Bahasa Indonesia langsung, padahal nama dan
 * deskripsi modul tampil di select menu `/setup`. Discord membaca label dari
 * komponen yang dikirim, jadi labelnya ikut bahasa server; menyimpan kalimat
 * berarti `/setup` selalu bahasa Indonesia di server English. Kuncinya disimpan
 * di sini supaya select menu dan ringkasan konfigurasi tidak bisa jatuh ke dua
 * daftar yang berbeda.
 */
export const MODULE_LABELS: Record<
  keyof ModulesEnabled,
  { labelKey: MessageKey; descriptionKey: MessageKey }
> = {
  music: {
    labelKey: 'config.module.music.label',
    descriptionKey: 'config.module.music.description',
  },
  moderation: {
    labelKey: 'config.module.moderation.label',
    descriptionKey: 'config.module.moderation.description',
  },
  automod: {
    labelKey: 'config.module.automod.label',
    descriptionKey: 'config.module.automod.description',
  },
  logging: {
    labelKey: 'config.module.logging.label',
    descriptionKey: 'config.module.logging.description',
  },
  reactions: {
    labelKey: 'config.module.reactions.label',
    descriptionKey: 'config.module.reactions.description',
  },
  tickets: {
    labelKey: 'config.module.tickets.label',
    descriptionKey: 'config.module.tickets.description',
  },
  customCommands: {
    labelKey: 'config.module.customCommands.label',
    descriptionKey: 'config.module.customCommands.description',
  },
};
