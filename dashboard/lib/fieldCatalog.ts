import {
  MAX_IDLE_TIMEOUT_SEC,
  MAX_VOLUME,
  MAX_WELCOME_MESSAGE_LENGTH,
  MIN_IDLE_TIMEOUT_SEC,
  type ModulesEnabled,
} from '@bot/modules/config/types.js';

/**
 * Katalog field dashboard — ini yang membuat SC-2 bisa diperiksa mesin.
 *
 * Aturan yang dipegang: **dashboard sama dengan `/config set`, tidak lebih**.
 * Daftar di bawah bukan ringkasan bebas; tiap entri menyebut nama opsi Discord-nya
 * (`commandOption`), dan `tests/fieldParity.test.ts` membandingkan kedua daftar
 * itu langsung dari `SlashCommandBuilder` milik perintah `/config`. Kalau
 * kelak ada field baru di `/config` dan tidak ditambahkan di sini, tes gagal.
 *
 * Yang **tidak** ada di sini, dan itu disengaja (lihat PRD-DASHBOARD §4.6):
 *
 * - `reactions` dan `tickets`: `/config set` tidak punya tombolnya. Keduanya
 *   hanya bisa dinyalakan lewat `/setup` dan dimatikan lewat perintah
 *   masing-masing (`/reactionrole`, `/ticket`), supaya tidak ada jalan yang bisa
 *   meninggalkan panel setengah jadi. Dashboard mengikuti `/config`, bukan
 *   `/setup`, karena `/config` yang menyediakan set lengkap untuk konfigurasi.
 * - Empat field panel tiket (`ticketPanelChannelId`, `ticketCategoryId`,
 *   `ticketStaffRoleId`, `ticketPanelMessageId`): diatur perintah `/ticket`,
 *   bukan konfigurasi umum. `ticketPanelMessageId` malah bukan keputusan
 *   manusia sama sekali — itu hasil kirim panel.
 * - `guildId`, `createdAt`, `updatedAt`: bukan konfigurasi yang diubah orang.
 */

export type DashboardFieldKey =
  | 'logChannelId'
  | 'welcomeChannelId'
  | 'goodbyeChannelId'
  | 'djRoleId'
  | 'autoroleId'
  | 'autoroleBotId'
  | 'welcomeMessage'
  | 'goodbyeMessage'
  | 'defaultVolume'
  | 'idleTimeoutSec'
  | 'stayChannelId'
  | 'locale';

export type ValueFieldKind = 'channel' | 'role' | 'text' | 'volume' | 'integer' | 'locale';

export interface ValueFieldDefinition {
  /** Nama field di `GuildConfigPatch` — satu-satunya nama yang dikirim ke database. */
  patchKey: DashboardFieldKey;
  /** Nama opsi di `/config set`; kosong berarti tidak ada di sana (tidak boleh terjadi). */
  commandOption: string;
  kind: ValueFieldKind;
  labelKey: string;
  helpKey?: string;
  /**
   * Field yang mengubah siapa yang boleh mengendalikan musik, atau apa yang
   * terjadi saat member baru bergabung, atau ke mana riwayat audit pergi.
   * Field seperti ini meminta konfirmasi dengan menyebut nilai lamanya
   * (US-D3), bukan hanya bertanya "yakin?".
   */
  highImpactConfirmKey?: string;
  min?: number;
  max?: number;
  maxLength?: number;
}

export interface ModuleFieldDefinition {
  moduleKey: keyof ModulesEnabled;
  /** Nama opsi boolean di `/config set`; null = tidak bisa diubah lewat `/config`. */
  commandOption: string | null;
  /** Kunci katalog bot untuk nama modul — dipakai apa adanya supaya tidak ada dua daftar nama. */
  labelKey: string;
}

export const DASHBOARD_VALUE_FIELDS: readonly ValueFieldDefinition[] = [
  {
    patchKey: 'logChannelId',
    commandOption: 'log-channel',
    kind: 'channel',
    labelKey: 'field.logChannelId',
    helpKey: 'field.logChannelId.help',
    // Mengarahkan seluruh riwayat audit ke channel lain adalah perubahan yang
    // tidak terlihat sampai ada yang mencari catatan lama.
    highImpactConfirmKey: 'confirm.logChannelId',
  },
  {
    patchKey: 'welcomeChannelId',
    commandOption: 'welcome-channel',
    kind: 'channel',
    labelKey: 'field.welcomeChannelId',
  },
  {
    patchKey: 'goodbyeChannelId',
    commandOption: 'goodbye-channel',
    kind: 'channel',
    labelKey: 'field.goodbyeChannelId',
  },
  {
    patchKey: 'djRoleId',
    commandOption: 'dj-role',
    kind: 'role',
    labelKey: 'field.djRoleId',
    helpKey: 'field.djRoleId.help',
    highImpactConfirmKey: 'confirm.djRoleId',
  },
  {
    patchKey: 'autoroleId',
    commandOption: 'autorole',
    kind: 'role',
    labelKey: 'field.autoroleId',
    highImpactConfirmKey: 'confirm.autoroleId',
  },
  {
    patchKey: 'autoroleBotId',
    commandOption: 'autorole-bot',
    kind: 'role',
    labelKey: 'field.autoroleBotId',
    highImpactConfirmKey: 'confirm.autoroleBotId',
  },
  {
    patchKey: 'welcomeMessage',
    commandOption: 'welcome-message',
    kind: 'text',
    labelKey: 'field.welcomeMessage',
    helpKey: 'field.welcomeMessage.help',
    maxLength: MAX_WELCOME_MESSAGE_LENGTH,
  },
  {
    patchKey: 'goodbyeMessage',
    commandOption: 'goodbye-message',
    kind: 'text',
    labelKey: 'field.goodbyeMessage',
    helpKey: 'field.goodbyeMessage.help',
    maxLength: MAX_WELCOME_MESSAGE_LENGTH,
  },
  {
    patchKey: 'defaultVolume',
    commandOption: 'volume',
    kind: 'volume',
    labelKey: 'field.defaultVolume',
    min: 0,
    max: MAX_VOLUME,
  },
  {
    patchKey: 'idleTimeoutSec',
    commandOption: 'idle-timeout',
    kind: 'integer',
    labelKey: 'field.idleTimeoutSec',
    helpKey: 'field.idleTimeoutSec.help',
    min: MIN_IDLE_TIMEOUT_SEC,
    max: MAX_IDLE_TIMEOUT_SEC,
  },
  {
    patchKey: 'stayChannelId',
    commandOption: 'stay-channel',
    kind: 'channel',
    labelKey: 'field.stayChannelId',
    helpKey: 'field.stayChannelId.help',
    // Menyalakan mode 24/7 berarti bot menduduki satu voice channel terus.
    highImpactConfirmKey: 'confirm.stayChannelId',
  },
  {
    patchKey: 'locale',
    commandOption: 'locale',
    kind: 'locale',
    labelKey: 'field.locale',
    helpKey: 'field.locale.help',
  },
];

/** Modul yang bisa diubah dashboard — persis lima yang ada di `/config set`. */
export const DASHBOARD_MODULES: readonly ModuleFieldDefinition[] = [
  { moduleKey: 'music', commandOption: 'music', labelKey: 'config.module.music.label' },
  { moduleKey: 'moderation', commandOption: 'moderation', labelKey: 'config.module.moderation.label' },
  { moduleKey: 'automod', commandOption: 'automod', labelKey: 'config.module.automod.label' },
  { moduleKey: 'logging', commandOption: 'logging', labelKey: 'config.module.logging.label' },
  {
    moduleKey: 'customCommands',
    commandOption: 'custom-commands',
    labelKey: 'config.module.customCommands.label',
  },
];

/**
 * Modul yang sengaja tidak ditawarkan dashboard, walau ada di `ModulesEnabled`.
 *
 * Daftarnya eksplisit supaya tes bisa menegaskan keduanya benar-benar absen —
 * bukan hanya "belum sempat ditambahkan".
 */
export const DASHBOARD_EXCLUDED_MODULES: readonly (keyof ModulesEnabled)[] = ['reactions', 'tickets'];

/** Bahasa yang benar-benar punya katalog di bot. */
export const DASHBOARD_LOCALES = ['id', 'en'] as const;

/** Semua field yang bisa dikirim dashboard, untuk dipakai validasi kunci. */
export const DASHBOARD_PATCH_KEYS: readonly DashboardFieldKey[] = DASHBOARD_VALUE_FIELDS.map(
  (field) => field.patchKey,
);

export function findValueField(patchKey: string): ValueFieldDefinition | undefined {
  return DASHBOARD_VALUE_FIELDS.find((field) => field.patchKey === patchKey);
}
