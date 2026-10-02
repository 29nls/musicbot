import {
  AuditLogEvent,
  Events,
  type GuildMember,
  type PartialGuildMember,
} from 'discord.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import {
  caseAwareFields,
  compactFields,
  executorFields,
  logEmbed,
  relativeTime,
} from '../../modules/logging/embeds.js';
import { consumeCaseLink } from '../../modules/moderation/index.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.GuildMemberRemove,
  async execute(client, member: GuildMember | PartialGuildMember): Promise<void> {
    const [kickEntry, banEntry] = await Promise.all([
      findAuditEntry(member.guild, AuditLogEvent.MemberKick, { targetId: member.id }),
      findAuditEntry(member.guild, AuditLogEvent.MemberBanAdd, { targetId: member.id }),
    ]);

    // Ban sudah dicatat oleh event guildBanAdd — jangan dobel.
    if (banEntry) return;

    const joinedAt = member.joinedAt ?? null;
    // Hanya kicked member yang bisa punya kasus; leave biasa tidak.
    const link = consumeCaseLink(member.guild.id, member.id, ['kick']);

    const embed = logEmbed({
      category: 'member',
      title: kickEntry ? '👢 Member Kick' : '🚪 Member Leave',
      fields: compactFields([
        { name: 'Member', value: `<@${member.id}> (\`${member.user.tag}\`)`, inline: true },
        { name: 'ID', value: `\`${member.id}\``, inline: true },
        joinedAt ? { name: 'Bergabung', value: relativeTime(joinedAt), inline: true } : null,
        ...caseAwareFields(link, executorFields(kickEntry), kickEntry?.executor?.id, client.user?.id),
      ]),
    });

    await dispatchLog(member.guild, 'member', embed, {
      eventKey: 'guildMemberRemove',
      targetId: member.id,
      executorId: kickEntry?.executor?.id ?? null,
      caseNumber: link?.caseNumber ?? null,
      record: link === null,
    });
  },
} satisfies BotEvent<'guildMemberRemove'>;
