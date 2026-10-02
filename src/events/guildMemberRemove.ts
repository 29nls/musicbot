import { EmbedBuilder, Events, type GuildMember, type PartialGuildMember } from 'discord.js';
import type { BotClient } from '../client.js';
import { EMBED_COLORS } from '../config/constants.js';
import { getGuildConfigService } from '../modules/config/index.js';
import {
  DEFAULT_GOODBYE_MESSAGE,
  greetingTemplate,
  renderGreeting,
  sendGuildEmbed,
} from '../modules/moderation/index.js';
import { getLogger } from '../services/logger.js';
import type { BotEvent } from '../types/event.js';

export default {
  name: Events.GuildMemberRemove,
  async execute(_client: BotClient, member: GuildMember | PartialGuildMember): Promise<void> {
    const logger = getLogger();
    const guild = member.guild;

    let config;
    try {
      config = await getGuildConfigService().get(guild.id);
    } catch (error) {
      logger.warn({ err: error, guild: guild.id }, 'Konfigurasi tidak terbaca saat member keluar');
      return;
    }

    if (!config.goodbyeChannelId) return;

    const template = greetingTemplate(config.goodbyeMessage, DEFAULT_GOODBYE_MESSAGE);
    const text = renderGreeting(template, {
      userId: member.id,
      userTag: member.user.tag,
      serverName: guild.name,
      memberCount: guild.memberCount,
    });

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.primary)
      .setTitle('🚪 Member Keluar')
      .setDescription(text)
      .setThumbnail(member.user.displayAvatarURL())
      .setFooter({ text: `Sisa ${guild.memberCount} member` })
      .setTimestamp();

    await sendGuildEmbed(guild, config.goodbyeChannelId, embed);
  },
} satisfies BotEvent;
