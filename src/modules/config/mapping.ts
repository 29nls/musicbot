import { DEFAULT_MODULES, type GuildConfig, type ModulesEnabled } from './types.js';

/**
 * Bentuk baris tabel `guild_config` yang dibutuhkan pemetaan.
 * Sengaja didefinisikan lokal (bukan mengimpor tipe Prisma) supaya file ini
 * bisa dites tanpa database dan tidak terikat versi generator Prisma.
 */
export interface GuildConfigRow {
  guildId: string;
  logChannelId: string | null;
  welcomeChannelId: string | null;
  goodbyeChannelId: string | null;
  djRoleId: string | null;
  autoroleId: string | null;
  autoroleBotId: string | null;
  welcomeMessage: string | null;
  goodbyeMessage: string | null;
  defaultVolume: number;
  idleTimeoutSec: number;
  ticketPanelChannelId: string | null;
  ticketCategoryId: string | null;
  ticketStaffRoleId: string | null;
  ticketPanelMessageId: string | null;
  stayChannelId: string | null;
  modulesEnabled: unknown;
  locale: string;
}

/** Baris DB → domain. Kolom JSON `modulesEnabled` bisa berisi data lama/rusak. */
export function toDomain(row: GuildConfigRow): GuildConfig {
  return {
    guildId: row.guildId,
    logChannelId: row.logChannelId,
    welcomeChannelId: row.welcomeChannelId,
    goodbyeChannelId: row.goodbyeChannelId,
    djRoleId: row.djRoleId,
    autoroleId: row.autoroleId,
    autoroleBotId: row.autoroleBotId,
    welcomeMessage: row.welcomeMessage,
    goodbyeMessage: row.goodbyeMessage,
    defaultVolume: row.defaultVolume,
    idleTimeoutSec: row.idleTimeoutSec,
    ticketPanelChannelId: row.ticketPanelChannelId,
    ticketCategoryId: row.ticketCategoryId,
    ticketStaffRoleId: row.ticketStaffRoleId,
    ticketPanelMessageId: row.ticketPanelMessageId,
    stayChannelId: row.stayChannelId,
    modules: parseModules(row.modulesEnabled),
    locale: row.locale,
  };
}

/**
 * Domain → bentuk write Prisma. `modulesEnabled` ditulis sebagai JSON penuh
 * karena kolom JSON tidak bisa di-merge di level database.
 */
export function toPrismaData(config: GuildConfig) {
  return {
    logChannelId: config.logChannelId,
    welcomeChannelId: config.welcomeChannelId,
    goodbyeChannelId: config.goodbyeChannelId,
    djRoleId: config.djRoleId,
    autoroleId: config.autoroleId,
    autoroleBotId: config.autoroleBotId,
    welcomeMessage: config.welcomeMessage,
    goodbyeMessage: config.goodbyeMessage,
    defaultVolume: config.defaultVolume,
    idleTimeoutSec: config.idleTimeoutSec,
    ticketPanelChannelId: config.ticketPanelChannelId,
    ticketCategoryId: config.ticketCategoryId,
    ticketStaffRoleId: config.ticketStaffRoleId,
    ticketPanelMessageId: config.ticketPanelMessageId,
    stayChannelId: config.stayChannelId,
    modulesEnabled: { ...config.modules },
    locale: config.locale,
  };
}

/**
 * Baca kolom JSON jadi ModulesEnabled yang selalu lengkap.
 * Nilai yang hilang / bukan boolean jatuh ke default (tahan data rusak).
 */
export function parseModules(value: unknown): ModulesEnabled {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ...DEFAULT_MODULES };
  }

  const record = value as Record<string, unknown>;
  const read = (key: keyof ModulesEnabled): boolean =>
    typeof record[key] === 'boolean' ? (record[key] as boolean) : DEFAULT_MODULES[key];

  return {
    music: read('music'),
    moderation: read('moderation'),
    automod: read('automod'),
    logging: read('logging'),
    reactions: read('reactions'),
    tickets: read('tickets'),
    customCommands: read('customCommands'),
  };
}
