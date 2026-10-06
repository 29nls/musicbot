import Redis from 'ioredis';
import { PrismaGuildConfigRepository } from '@bot/modules/config/repository.js';
import { toDomain } from '@bot/modules/config/mapping.js';
import {
  DEFAULT_IDLE_TIMEOUT_SEC,
  DEFAULT_MODULES,
  type GuildConfig,
} from '@bot/modules/config/types.js';
import { RedisKeyValueStore, type KeyValueStore } from '@bot/services/kvStore.js';
import { recordConfigAudit } from './audit.js';
import { botPermissionDeps, getGuildChannels, getGuildRoles } from './discord.js';
import { DEV_CHANNELS, DEV_PERMISSION_DEPS, DEV_ROLES, devFixturesEnabled } from './devFixtures.js';
import { getEnv } from './env.js';
import { getPrisma } from './prisma.js';
import { checkManageGuild } from './permissions.js';
import type { ConfigWriteDeps, GuildSnapshot, SaveAudit } from './configWrite.js';

/**
 * Menyambungkan modul murni ke dunia nyata: Prisma, Redis, dan Discord.
 *
 * Berkas ini satu-satunya tempat di dashboard yang tahu cara bicara ke database
 * dan ke Redis. Semua keputusan sudah ada di modul murni; yang di sini hanya
 * menjawab "dari mana".
 *
 * **Repository bot dipakai apa adanya.** `PrismaGuildConfigRepository` dan
 * `toDomain` diimpor langsung dari repo bot, jadi bentuk baca dan tulis
 * `guild_config` — termasuk `modulesEnabled` yang harus ditulis sebagai JSON
 * penuh karena kolom JSON tidak bisa di-merge di database — dijaga oleh kode yang
 * sama dengan yang dipakai `/config`. Menyalinnya berarti dua tempat yang harus
 * mengingat aturan itu.
 */

let store: KeyValueStore | undefined;
let redis: Redis | undefined;

export function getStore(): KeyValueStore {
  if (!store) {
    redis = new Redis(getEnv().REDIS_URL, {
      maxRetriesPerRequest: 2,
      connectTimeout: 5_000,
    });

    // Kesalahan koneksi tidak boleh mematikan proses. Yang memutuskan adalah
    // pemanggil: `publish` mengembalikan false dan `increment` melempar, jadi
    // `applyConfigPatch` menjawab `shared-store-down` alih-alih menulis diam-diam.
    redis.on('error', () => {});
    store = new RedisKeyValueStore(redis as never);
  }

  return store;
}

export async function closeStore(): Promise<void> {
  await store?.close().catch(() => undefined);
  store = undefined;
  redis = undefined;
}

/**
 * Volume default server yang belum pernah di-setup.
 *
 * 100 dicantumkan literal, bukan diimpor dari `src/config/env.js`: berkas itu
 * memaksa seluruh env bot termasuk `LAVALINK_PASSWORD` dan friends, dan
 * dashboard tidak ada urusan mengetahuinya. Nilai ini juga sudah dikunci
 * oleh skema (`@default(100)`) dan oleh validasi bot (`MAX_VOLUME = 200`),
 * jadi tiga sumber lain sudah mengunci angka yang sama.
 */
export const DEFAULT_VOLUME = 100;

/** Konfigurasi dengan bentuk domain, termasuk untuk server tanpa baris. */
export function defaultsFor(guildId: string): GuildConfig {
  return {
    guildId,
    logChannelId: null,
    welcomeChannelId: null,
    goodbyeChannelId: null,
    djRoleId: null,
    autoroleId: null,
    autoroleBotId: null,
    welcomeMessage: null,
    goodbyeMessage: null,
    defaultVolume: DEFAULT_VOLUME,
    idleTimeoutSec: DEFAULT_IDLE_TIMEOUT_SEC,
    ticketPanelChannelId: null,
    ticketCategoryId: null,
    ticketStaffRoleId: null,
    ticketPanelMessageId: null,
    stayChannelId: null,
    modules: { ...DEFAULT_MODULES },
    locale: 'id',
  };
}

export async function readGuildConfig(guildId: string): Promise<GuildConfig> {
  const stored = await new PrismaGuildConfigRepository(getPrisma()).find(guildId);

  return stored ?? defaultsFor(guildId);
}

/** Bentuk write kolom `guild_config`. */
function toWrite(config: GuildConfig) {
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
 * Tulis konfigurasi dan audit dalam satu transaksi.
 *
 * Yang membuatnya benar-benar satu transaksi: audit ditulis lewat klien
 * transaksi (`tx`), bukan klien utama. Kalau audit lewat klien utama, ia commit
 * sendiri di luar transaksi — jadi transaksi yang "gagal" masih meninggalkan
 * baris audit untuk perubahan yang tidak pernah terjadi.
 *
 * `auditRecorded` bisa `false` sementara konfigurasi tetap commit, dan itu
 * disengaja: membatalkan perubahan yang sah demi satu baris riwayat lebih buruk
 * daripada kehilangan jejaknya. Yang tidak boleh berubah dalam keadaan itu:
 * `executorId`-nya tetap ID manusia.
 */
export async function saveGuildConfig(
  config: GuildConfig,
  audit: SaveAudit,
): Promise<{ saved: GuildConfig; auditRecorded: boolean }> {
  const prisma = getPrisma();

  const row = await prisma.$transaction(async (tx) => {
    const saved = await tx.guildConfig.upsert({
      where: { guildId: config.guildId },
      create: { guildId: config.guildId, ...toWrite(config) },
      update: toWrite(config),
    });

    const result = await recordConfigAudit(tx, {
      guildId: config.guildId,
      executorId: audit.executorId,
      changes: audit.changes,
      logChannelId: audit.logChannelId,
    });

    return { saved, auditRecorded: result.recorded };
  });

  return { saved: toDomain(row.saved), auditRecorded: row.auditRecorded };
}

/** Channel dan role milik guild; `null` kalau Discord tidak menjawab. */
export async function readGuildSnapshot(guildId: string): Promise<GuildSnapshot | null> {
  if (devFixturesEnabled()) {
    return {
      channelIds: DEV_CHANNELS.map((channel) => channel.id),
      roleIds: DEV_ROLES.map((role) => role.id),
    };
  }

  const token = getEnv().DISCORD_TOKEN;
  const [channels, roles] = await Promise.all([
    getGuildChannels(token, guildId),
    getGuildRoles(token, guildId),
  ]);

  if (!channels || !roles) return null;

  return {
    channelIds: channels.map((channel) => channel.id),
    roleIds: roles.map((role) => role.id),
  };
}

/** Deps siap pakai untuk `applyConfigPatch`. */
export function configWriteDeps(): ConfigWriteDeps {
  const token = getEnv().DISCORD_TOKEN;
  const permissionDeps = devFixturesEnabled() ? DEV_PERMISSION_DEPS : botPermissionDeps(token);

  return {
    readConfig: readGuildConfig,
    save: saveGuildConfig,
    checkPermission: (guildId, userId) => checkManageGuild(permissionDeps, guildId, userId),
    readGuildSnapshot,
    store: getStore(),
  };
}