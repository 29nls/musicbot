import { AuditLogEvent, Events, type Role } from 'discord.js';
import { translatorFor } from '../../modules/i18n/index.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import { compactFields, executorFields, logEmbed } from '../../modules/logging/embeds.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.GuildRoleCreate,
  async execute(_client, role: Role): Promise<void> {
    const entry = await findAuditEntry(role.guild, AuditLogEvent.RoleCreate, { targetId: role.id });

    const t = await translatorFor(role.guild.id);
    const embed = logEmbed({
      category: 'role',
      title: t('log.embed.title.roleCreate'),
      fields: compactFields([
        { name: t('log.embed.field.role'), value: `<@&${role.id}> (\`${role.name}\`)`, inline: true },
        { name: t('log.embed.field.color'), value: `\`${role.hexColor}\``, inline: true },
        { name: t('log.embed.field.mentionable'), value: role.mentionable ? t('log.diff.yes') : t('log.diff.no'), inline: true },
        ...executorFields(entry, t),
      ]),
    }, t);

    await dispatchLog(role.guild, 'role', embed, {
      eventKey: 'guildRoleCreate',
      targetId: role.id,
      executorId: entry?.executor?.id ?? null,
    });
  },
} satisfies BotEvent<'roleCreate'>;
