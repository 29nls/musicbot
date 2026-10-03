import { AuditLogEvent, Events, type Role } from 'discord.js';
import { translatorFor } from '../../modules/i18n/index.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import { compactFields, executorFields, logEmbed } from '../../modules/logging/embeds.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.GuildRoleDelete,
  async execute(_client, role: Role): Promise<void> {
    const entry = await findAuditEntry(role.guild, AuditLogEvent.RoleDelete, { targetId: role.id });

    const t = await translatorFor(role.guild.id);
    const embed = logEmbed({
      category: 'role',
      title: t('log.embed.title.roleDelete'),
      fields: compactFields([
        { name: t('log.embed.field.name'), value: `\`${role.name}\``, inline: true },
        { name: t('log.embed.field.id'), value: `\`${role.id}\``, inline: true },
        { name: t('log.embed.field.color'), value: `\`${role.hexColor}\``, inline: true },
        ...executorFields(entry, t),
      ]),
    }, t);

    await dispatchLog(role.guild, 'role', embed, {
      eventKey: 'guildRoleDelete',
      targetId: role.id,
      executorId: entry?.executor?.id ?? null,
    });
  },
} satisfies BotEvent<'roleDelete'>;
