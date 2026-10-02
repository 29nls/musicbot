import type { EmbedBuilder, Guild } from 'discord.js';
import { getLogger } from '../../services/logger.js';

/**
 * Kirim embed ke satu channel guild (log, welcome, goodbye, dst.).
 *
 * Best-effort: channel yang belum diatur, sudah dihapus, atau tidak punya izin
 * tidak boleh menggagalkan aksi utama yang sedang berjalan. Pemanggil cukup
 * memakai nilai baliknya untuk memberi catatan ke user.
 */
export async function sendGuildEmbed(
  guild: Guild,
  channelId: string | null,
  embed: EmbedBuilder,
): Promise<boolean> {
  if (!channelId) return false;

  try {
    const channel = await guild.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      getLogger().warn({ guild: guild.id, channelId }, 'Channel tujuan bukan channel teks');
      return false;
    }

    await channel.send({ embeds: [embed] });
    return true;
  } catch (error) {
    getLogger().warn({ err: error, guild: guild.id, channelId }, 'Gagal mengirim embed ke channel');
    return false;
  }
}
