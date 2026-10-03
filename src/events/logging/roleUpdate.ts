import { AuditLogEvent, Events, type Role } from 'discord.js';
import { translatorFor } from '../../modules/i18n/index.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { diffPermissions, diffValues } from '../../modules/logging/diff.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import { changesField, compactFields, executorFields, logEmbed } from '../../modules/logging/embeds.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.GuildRoleUpdate,
  async execute(_client, oldRole: Role, newRole: Role): Promise<void> {
    const t = await translatorFor(newRole.guild.id);
    const lines = diffValues(
      {
        name: oldRole.name,
        color: oldRole.hexColor,
        hoist: oldRole.hoist,
        mentionable: oldRole.mentionable,
      },
      {
        name: newRole.name,
        color: newRole.hexColor,
        hoist: newRole.hoist,
        mentionable: newRole.mentionable,
      },
      [
        { key: 'name', label: t('log.embed.field.name') },
        { key: 'color', label: t('log.embed.field.color') },
        { key: 'hoist', label: t('log.embed.field.hoist') },
        { key: 'mentionable', label: t('log.embed.field.mentionable') },
      ],
      t,
    );

    const permissions = diffPermissions(
      oldRole.permissions.bitfield,
      newRole.permissions.bitfield,
    );
    if (permissions.added.length > 0) {
      lines.push(`• **${t('log.embed.field.permsAdded')}: ${permissions.added.join(', ')}`);
    }
    if (permissions.removed.length > 0) {
      lines.push(`• **${t('log.embed.field.permsRemoved')}: ${permissions.removed.join(', ')}`);
    }

    if (lines.length === 0) return;

    const entry = await findAuditEntry(newRole.guild, AuditLogEvent.RoleUpdate, {
      targetId: newRole.id,
    });

    const embed = logEmbed({
      category: 'role',
      title: t('log.embed.title.roleUpdate'),
      fields: compactFields([
        { name: t('log.embed.field.role'), value: `<@&${newRole.id}>` },
        changesField(lines, t),
        ...executorFields(entry, t),
      ]),
    }, t);

    await dispatchLog(newRole.guild, 'role', embed, {
      eventKey: 'guildRoleUpdate',
      targetId: newRole.id,
      executorId: entry?.executor?.id ?? null,
    });
  },
} satisfies BotEvent<'roleUpdate'>;
