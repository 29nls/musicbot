import { AuditLogEvent, Events, type GuildMember } from 'discord.js';
import { translatorFor } from '../../modules/i18n/index.js';
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

    const t = await translatorFor(member.guild.id);
    const embed = logEmbed({
      category: 'member',
      title: t('log.embed.title.memberAdd'),
      fields: compactFields([
        { name: t('log.embed.field.member'), value: `<@${member.id}> (\`${member.user.tag}\`)`, inline: true },
        { name: t('log.embed.field.id'), value: `\`${member.id}\``, inline: true },
        { name: t('log.embed.field.accountCreated'), value: relativeTime(member.user.createdAt), inline: true },
        ...executorFields(entry, t),
      ]),
    }, t);

    await dispatchLog(member.guild, 'member', embed, {
      eventKey: 'guildMemberAdd',
      targetId: member.id,
      executorId: entry?.executor?.id ?? null,
    });
  },
} satisfies BotEvent<'guildMemberAdd'>;
