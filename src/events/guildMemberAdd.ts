import { EmbedBuilder, Events, PermissionFlagsBits, type GuildMember } from 'discord.js';
import type { BotClient } from '../client.js';
import { EMBED_COLORS } from '../config/constants.js';
import { getGuildConfigService, type GuildConfig } from '../modules/config/index.js';
import {
  DEFAULT_WELCOME_MESSAGE,
  greetingTemplate,
  renderGreeting,
  sendGuildEmbed,
} from '../modules/moderation/index.js';
import { getLogger } from '../services/logger.js';
import type { BotEvent } from '../types/event.js';
import { warningEmbed } from '../utils/embeds.js';

export default {
  name: Events.GuildMemberAdd,
  async execute(_client: BotClient, member: GuildMember): Promise<void> {
    const logger = getLogger();
    const guild = member.guild;

    let config: GuildConfig;
    try {
      config = await getGuildConfigService().get(guild.id);
    } catch (error) {
      logger.warn({ err: error, guild: guild.id }, 'Konfigurasi tidak terbaca saat member join');
      return;
    }

    await applyAutorole(member, config);

    if (!config.welcomeChannelId) return;

    const template = greetingTemplate(config.welcomeMessage, DEFAULT_WELCOME_MESSAGE);
    const text = renderGreeting(template, {
      userId: member.id,
      userTag: member.user.tag,
      serverName: guild.name,
      memberCount: guild.memberCount,
    });

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.success)
      .setTitle('👋 Member Baru')
      .setDescription(text)
      .setThumbnail(member.user.displayAvatarURL())
      .setFooter({ text: `Member ke-${guild.memberCount}` })
      .setTimestamp();

    await sendGuildEmbed(guild, config.welcomeChannelId, embed);
  },
} satisfies BotEvent;

/** Beri role otomatis sesuai konfigurasi; beda role untuk bot dan manusia. */
async function applyAutorole(member: GuildMember, config: GuildConfig): Promise<void> {
  const logger = getLogger();
  const roleId = member.user.bot ? config.autoroleBotId : config.autoroleId;
  if (!roleId) return;

  const guild = member.guild;

  try {
    const me = guild.members.me ?? (await guild.members.fetchMe());
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      throw new Error('bot tidak punya izin Manage Roles');
    }

    const role = await guild.roles.fetch(roleId);
    if (!role) throw new Error(`role ${roleId} sudah tidak ada`);
    if (me.roles.highest.position <= role.position) {
      throw new Error('role autorole berada di atas role bot');
    }

    await member.roles.add(role, 'Autorole: member baru');
  } catch (error) {
    logger.warn(
      { err: error, guild: guild.id, member: member.id, roleId },
      'Autorole gagal diberikan',
    );

    const message = error instanceof Error ? error.message : String(error);
    await sendGuildEmbed(
      guild,
      config.logChannelId,
      warningEmbed(
        `Autorole <@&${roleId}> gagal diberikan ke <@${member.id}>: ${message}.`,
        '⚠️ Autorole Gagal',
      ),
    );
  }
}
