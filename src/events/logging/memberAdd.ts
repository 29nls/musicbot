import { AuditLogEvent, Events, type GuildMember } from 'discord.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import { compactFields, executorFields, logEmbed, relativeTime } from '../../modules/logging/embeds.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.GuildMemberAdd,
  async execute(_client, member: GuildMember): Promise<void> {
    // Bot yang diundang tercatat di audit log sebagai BotAdd.
    const entry = member.user.bot
      ? await findAuditEntry(member.guild, AuditLogEvent.BotAdd, { targetId: member.id })
      : null;

    const embed = logEmbed({
      category: 'member',
      title: '👤 Member Join',
      fields: compactFields([
        { name: 'Member', value: `<@${member.id}> (\`${member.user.tag}\`)`, inline: true },
        { name: 'ID', value: `\`${member.id}\``, inline: true },
        { name: 'Akun dibuat', value: relativeTime(member.user.createdAt), inline: true },
        ...executorFields(entry),
      ]),
    });

    await dispatchLog(member.guild, 'member', embed, {
      eventKey: 'guildMemberAdd',
      targetId: member.id,
      executorId: entry?.executor?.id ?? null,
    });
  },
} satisfies BotEvent<'guildMemberAdd'>;
