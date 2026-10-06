import type { MessageKey } from '@bot/modules/i18n/catalog.js';
import {
  MAX_IDLE_TIMEOUT_SEC,
  MAX_VOLUME,
  MAX_WELCOME_MESSAGE_LENGTH,
  MIN_IDLE_TIMEOUT_SEC,
  type ModulesEnabled,
} from '@bot/modules/config/types.js';
import type { DashboardMessageKey } from './messages.js';

/**
 * Katalog field dashboard — ini yang membuat SC-2 bisa diperiksa mesin.
 *
 * Aturan yang dipegang: **dashboard sama dengan `/config set`, tidak lebih**.
 * Daftar di bawah bukan ringkasan bebas; tiap entri menyebut nama opsi Discord-nya
 * (`commandOption`), dan `tests/fieldParity.test.ts` membandingkan kedua daftar
 * itu langsung dari `SlashCommandBuilder` milik perintah `/config`. Kalau
 * kelak ada field baru di `/config` dan tidak ditambahkan di sini, tes gagal.
 *
 * Tiga sumber teks, dan tidak ada yang diduplikasi tanpa alasan:
 *
 * - **Nama field** diambil dari katalog bot (`config.field.*`), jadi `/config`
 *   dan dashboard tidak bisa punya dua nama untuk hal yang sama. Tipe `MessageKey`
 *   membuat kunci yang salah gagal saat build, bukan saat runtime.
 * - **Batas angka** diambil dari konstanta bot (`MAX_VOLUME` dan sejenisnya),
 *   jadi validasi dashboard dan bot benar-benar satu aturan.
 * - **Teks penjelasan** milik dashboard sendiri (`helpKey`), karena `/config`
 *   menyimpan deskripsi opsi sebagai kalimat Indonesia di dalam berkasnya —
 *   tidak ada katalog yang bisa dipakai ulang. `tests/messages.test.ts`
 *   menjaga kunci dashboard tidak pernah menabrak kunci bot dengan isi berbeda.
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
  /** Nama opsi di `/config set`. */
  commandOption: string;
  kind: ValueFieldKind;
  labelKey: MessageKey;
  /** Penjelasan singkat milik dashboard, tanpa emoji label bot. */
  helpKey: DashboardMessageKey;
  /**
   * Field yang mengubah siapa yang boleh mengendalikan musik, apa yang terjadi
   * saat member baru bergabung, atau ke mana riwayat audit pergi. Field seperti
   * ini meminta konfirmasi yang menyebut nilai lamanya (US-D3), bukan sekadar
   * "¿yakin?".
   */
  highImpactConfirmKey?: DashboardMessageKey;
  min?: number;
  max?: number;
  /** Batas panjang untuk field teks; jumlah karakter, dari konstanta bot. */
  maxLength?: number;
}

export interface ModuleFieldDefinition {
  moduleKey: keyof ModulesEnabled;
  /** Nama opsi boolean di `/config set`. */
  commandOption: string;
  /** Kunci katalog bot untuk nama modul — dipakai apa adanya, bukan diduplikasi. */
  labelKey: MessageKey;
}

export const DASHBOARD_VALUE_FIELDS: readonly ValueFieldDefinition[] = [
  {
    patchKey: 'logChannelId',
    commandOption: 'log-channel',
    kind: 'channel',
    labelKey: 'config.field.logChannel',
    helpKey: 'help.logChannel',
    // Mengarahkan seluruh riwayat audit ke channel lain adalah perubahan yang
    // tidak terlihat sampai ada yang mencari catatan lama.
    highImpactConfirmKey: 'confirm.logChannel',
  },
  {
    patchKey: 'welcomeChannelId',
    commandOption: 'welcome-channel',
    kind: 'channel',
    labelKey: 'config.field.welcomeChannel',
    helpKey: 'help.welcomeChannel',
  },
  {
    patchKey: 'goodbyeChannelId',
    commandOption: 'goodbye-channel',
    kind: 'channel',
    labelKey: 'config.field.goodbyeChannel',
    helpKey: 'help.goodbyeChannel',
  },
  {
    patchKey: 'djRoleId',
    commandOption: 'dj-role',
    kind: 'role',
    labelKey: 'config.field.djRole',
    helpKey: 'help.djRole',
    highImpactConfirmKey: 'confirm.djRole',
  },
  {
    patchKey: 'autoroleId',
    commandOption: 'autorole',
    kind: 'role',
    labelKey: 'config.field.autoroleMember',
    helpKey: 'help.autorole',
    highImpactConfirmKey: 'confirm.autorole',
  },
  {
    patchKey: 'autoroleBotId',
    commandOption: 'autorole-bot',
    kind: 'role',
    labelKey: 'config.field.autoroleBot',
    helpKey: 'help.autoroleBot',
    highImpactConfirmKey: 'confirm.autoroleBot',
  },
  {
    patchKey: 'welcomeMessage',
    commandOption: 'welcome-message',
    kind: 'text',
    labelKey: 'config.field.welcomeMessage',
    helpKey: 'help.welcomeMessage',
    maxLength: MAX_WELCOME_MESSAGE_LENGTH,
  },
  {
    patchKey: 'goodbyeMessage',
    commandOption: 'goodbye-message',
    kind: 'text',
    labelKey: 'config.field.goodbyeMessage',
    helpKey: 'help.goodbyeMessage',
    maxLength: MAX_WELCOME_MESSAGE_LENGTH,
  },
  {
    patchKey: 'defaultVolume',
    commandOption: 'volume',
    kind: 'volume',
    labelKey: 'config.field.volume',
    helpKey: 'help.defaultVolume',
    min: 0,
    max: MAX_VOLUME,
  },
  {
    patchKey: 'idleTimeoutSec',
    commandOption: 'idle-timeout',
    kind: 'integer',
    labelKey: 'config.field.idleTimeout',
    helpKey: 'help.idleTimeout',
    min: MIN_IDLE_TIMEOUT_SEC,
    max: MAX_IDLE_TIMEOUT_SEC,
  },
  {
    patchKey: 'stayChannelId',
    commandOption: 'stay-channel',
    kind: 'channel',
    labelKey: 'config.field.stayChannel',
    helpKey: 'help.stayChannel',
    // Menyalakan mode 24/7 berarti bot menduduki satu voice channel terus.
    highImpactConfirmKey: 'confirm.stayChannel',
  },
  {
    patchKey: 'locale',
    commandOption: 'locale',
    kind: 'locale',
    labelKey: 'config.field.locale',
    helpKey: 'help.locale',
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

/** Semua field nilai yang bisa dikirim dashboard, untuk validasi kunci. */
export const DASHBOARD_PATCH_KEYS: readonly DashboardFieldKey[] = DASHBOARD_VALUE_FIELDS.map(
  (field) => field.patchKey,
);

/** Semua kunci modul yang boleh dikirim dashboard. */
export const DASHBOARD_MODULE_KEYS: readonly (keyof ModulesEnabled)[] = DASHBOARD_MODULES.map(
  (module) => module.moduleKey,
);

export function findValueField(patchKey: string): ValueFieldDefinition | undefined {
  return DASHBOARD_VALUE_FIELDS.find((field) => field.patchKey === patchKey);
}

/** Field yang butuh konfirmasi, untuk dipakai halaman dan tes US-D3. */
export function highImpactFields(): readonly ValueFieldDefinition[] {
  return DASHBOARD_VALUE_FIELDS.filter((field) => field.highImpactConfirmKey !== undefined);
}