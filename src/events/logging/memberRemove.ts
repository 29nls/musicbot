import {
  AuditLogEvent,
  Events,
  type GuildMember,
  type PartialGuildMember,
} from 'discord.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import { compactFields, executorFields, logEmbed, relativeTime } from '../../modules/logging/embeds.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.GuildMemberRemove,
  async execute(_client, member: GuildMember | PartialGuildMember): Promise<void> {
    const [kickEntry, banEntry] = await Promise.all([
      findAuditEntry(member.guild, AuditLogEvent.MemberKick, { targetId: member.id }),
      findAuditEntry(member.guild, AuditLogEvent.MemberBanAdd, { targetId: member.id }),
    ]);

    // Ban sudah dicatat oleh event guildBanAdd — jangan dobel.
    if (banEntry) return;

    const joinedAt = member.joinedAt ?? null;

    const embed = logEmbed({
      category: 'member',
      title: kickEntry ? '👢 Member Kick' : '🚪 Member Leave',
      fields: compactFields([
        { name: 'Member', value: `<@${member.id}> (\`${member.user.tag}\`)`, inline: true },
        { name: 'ID', value: `\`${member.id}\``, inline: true },
        joinedAt ? { name: 'Bergabung', value: relativeTime(joinedAt), inline: true } : null,
        ...executorFields(kickEntry),
      ]),
    });

    await dispatchLog(member.guild, 'member', embed);
  },
} satisfies BotEvent<'guildMemberRemove'>;
