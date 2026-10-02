import type { EmbedBuilder, Guild, Message } from 'discord.js';
import { getLogger } from '../../services/logger.js';
import { buildRecordInput, resolveLogTarget, type LogRecordMeta } from './record.js';
import { getLoggingService } from './singleton.js';
import type { LogCategory } from './types.js';

export type { LogRecordMeta } from './record.js';

/** Metadata tambahan khusus pemanggilan dari event. */
export interface DispatchMeta extends LogRecordMeta {
  /**
   * false = jangan simpan ke riwayat. Dipakai event yang tautan kasusnya sudah
   * dicatat lebih dulu oleh perintah, supaya satu aksi tidak terdua di `/logs`.
   */
  record?: boolean;
}

/**
 * Kirim embed log ke channel kategori (routing `/logging`) atau jatuh ke
 * `logChannelId` global, lalu simpan riwayatnya untuk `/logs`.
 *
 * Best-effort: modul logging mati, DB offline, channel belum diatur, atau
 * gagal kirim tidak boleh mengganggu alur event — semuanya hanya dicatat di
 * log internal bot. Urutannya: catat riwayat dulu (supaya tetap ada walau
 * pengiriman gagal), baru kirim, lalu tempelkan ID pesan untuk tautan lompat.
 */
export async function dispatchLog(
  guild: Guild,
  category: LogCategory,
  embed: EmbedBuilder,
  meta?: DispatchMeta,
): Promise<boolean> {
  const target = await resolveLogTarget(guild, category);
  if (!target?.enabled) return false;

  const service = getLoggingService();

  const entryId =
    meta && meta.record !== false
      ? await service.record(
          guild.id,
          buildRecordInput(category, embed, target.channelId, meta),
        )
      : null;

  if (!target.channelId) return false;

  const message = await sendLogEmbed(guild, target.channelId, embed);
  if (!message) return false;

  if (entryId !== null) {
    await service.attachMessage(entryId, message.id, target.channelId);
  }

  return true;
}

/** Versi `sendGuildEmbed` yang juga mengembalikan pesan agar ID-nya bisa disimpan. */
async function sendLogEmbed(
  guild: Guild,
  channelId: string,
  embed: EmbedBuilder,
): Promise<Message | null> {
  try {
    const channel = await guild.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      getLogger().warn({ guild: guild.id, channelId }, 'Channel tujuan log bukan channel teks');
      return null;
    }

    return await channel.send({ embeds: [embed] });
  } catch (error) {
    getLogger().warn({ err: error, guild: guild.id, channelId }, 'Gagal mengirim embed log');
    return null;
  }
}
