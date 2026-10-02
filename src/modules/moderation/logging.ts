import type { EmbedBuilder, Guild } from 'discord.js';
import { getLogger } from '../../services/logger.js';
import type { LogCategory } from '../logging/types.js';
import type { ModerationAction } from './types.js';

/**
 * Kategori log tempat aksi moderasi dicatat.
 *
 * `null` untuk `/note` — catatan internal tidak mengubah apa pun di server,
 * jadi tidak ada event log yang relevan.
 */
export function moderationLogCategory(action: ModerationAction): LogCategory | null {
  switch (action) {
    case 'ban':
    case 'kick':
    case 'timeout':
    case 'unban':
    case 'warn':
      return 'member';
    case 'slowmode':
    case 'lock':
    case 'unlock':
      return 'channel';
    case 'note':
      return null;
  }
}

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
