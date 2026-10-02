import type { EmbedBuilder, Guild } from 'discord.js';
import { getLogger } from '../../services/logger.js';
import { getGuildConfigService } from '../config/index.js';
import { sendGuildEmbed } from '../moderation/index.js';
import { getLoggingService } from './singleton.js';
import type { LogCategory } from './types.js';

/**
 * Kirim embed log ke channel kategori (routing `/logging`) atau jatuh ke
 * `logChannelId` global. Best-effort: modul logging mati / channel belum diatur
 * / gagal kirim tidak boleh mengganggu alur event.
 */
export async function dispatchLog(
  guild: Guild,
  category: LogCategory,
  embed: EmbedBuilder,
): Promise<boolean> {
  const logger = getLogger();

  let config;
  try {
    config = await getGuildConfigService().get(guild.id);
  } catch (error) {
    logger.warn({ err: error, guild: guild.id }, 'Konfigurasi tidak terbaca untuk logging');
    return false;
  }

  if (!config.modules.logging) return false;

  let routed: string | null = null;
  try {
    routed = await getLoggingService().getChannel(guild.id, category);
  } catch (error) {
    logger.warn({ err: error, guild: guild.id, category }, 'Routing log tidak terbaca');
  }

  const channelId = routed ?? config.logChannelId;
  if (!channelId) return false;

  return sendGuildEmbed(guild, channelId, embed);
}
