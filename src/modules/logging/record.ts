import type { EmbedBuilder, Guild } from 'discord.js';
import { getLogger } from '../../services/logger.js';
import { getGuildConfigService } from '../config/index.js';
import { getLoggingService } from './singleton.js';
import { buildLogSummary } from './summary.js';
import type { LogCategory, LogRecordInput } from './types.js';

/** Metadata event untuk riwayat log; hanya ID yang perlu diisi manual. */
export interface LogRecordMeta {
  eventKey: string;
  executorId?: string | null;
  targetId?: string | null;
  channelId?: string | null;
  /** Nomor kasus moderasi bila aksi berasal dari perintah bot Harmony. */
  caseNumber?: number | null;
}

export interface ResolvedLogTarget {
  /** false = modul logging mati di server ini. */
  enabled: boolean;
  /** null = tidak ada channel tujuan (routing dan `logChannelId` sama-sama kosong). */
  channelId: string | null;
}

/**
 * Tentukan apakah logging aktif dan ke channel mana sebuah kategori dikirim.
 * `null` berarti konfigurasi tidak terbaca — pemanggil harus berhenti diam-diam.
 */
export async function resolveLogTarget(
  guild: Guild,
  category: LogCategory,
): Promise<ResolvedLogTarget | null> {
  let config;
  try {
    config = await getGuildConfigService().get(guild.id);
  } catch (error) {
    getLogger().warn({ err: error, guild: guild.id }, 'Konfigurasi tidak terbaca untuk logging');
    return null;
  }

  if (!config.modules.logging) return { enabled: false, channelId: null };

  let routed: string | null = null;
  try {
    routed = await getLoggingService().getChannel(guild.id, category);
  } catch (error) {
    getLogger().warn({ err: error, guild: guild.id, category }, 'Routing log tidak terbaca');
  }

  return { enabled: true, channelId: routed ?? config.logChannelId };
}

/** Rakit input baris riwayat dari embed + metadata aksi. */
export function buildRecordInput(
  category: LogCategory,
  embed: EmbedBuilder,
  logChannelId: string | null,
  meta: LogRecordMeta,
): LogRecordInput {
  return {
    category,
    eventKey: meta.eventKey,
    title: embed.data.title ?? category,
    summary: buildLogSummary(embed),
    executorId: meta.executorId,
    targetId: meta.targetId,
    channelId: meta.channelId,
    logChannelId,
    caseNumber: meta.caseNumber,
  };
}

/**
 * Simpan riwayat log **tanpa** mengirim embed.
 *
 * Dipakai perintah yang sudah mengirim embed-nya sendiri (mis. log kasus
 * moderasi ke channel log global) supaya aksi itu tetap bisa dicari di `/logs`.
 * Best-effort: modul mati atau DB offline hanya menghasilkan null.
 */
export async function recordLogEntry(
  guild: Guild,
  category: LogCategory,
  embed: EmbedBuilder,
  meta: LogRecordMeta,
): Promise<number | null> {
  const target = await resolveLogTarget(guild, category);
  if (!target?.enabled) return null;

  return getLoggingService().record(
    guild.id,
    buildRecordInput(category, embed, target.channelId, meta),
  );
}
