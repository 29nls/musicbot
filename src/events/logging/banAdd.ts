import { AuditLogEvent, Events, type GuildBan } from 'discord.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import { compactFields, executorFields, logEmbed } from '../../modules/logging/embeds.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.GuildBanAdd,
  async execute(_client, ban: GuildBan): Promise<void> {
    const entry = await findAuditEntry(ban.guild, AuditLogEvent.MemberBanAdd, {
      targetId: ban.user.id,
    });

    const embed = logEmbed({
      category: 'member',
      title: '🔨 Member Ban',
      fields: compactFields([
        { name: 'Member', value: `<@${ban.user.id}> (\`${ban.user.tag}\`)`, inline: true },
        { name: 'ID', value: `\`${ban.user.id}\``, inline: true },
        ...executorFields(entry),
      ]),
    });

    await dispatchLog(ban.guild, 'member', embed);
  },
} satisfies BotEvent<'guildBanAdd'>;
