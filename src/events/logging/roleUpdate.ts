import { AuditLogEvent, Events, type Role } from 'discord.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { diffPermissions, diffValues } from '../../modules/logging/diff.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import { changesField, compactFields, executorFields, logEmbed } from '../../modules/logging/embeds.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.GuildRoleUpdate,
  async execute(_client, oldRole: Role, newRole: Role): Promise<void> {
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
        { key: 'name', label: 'Nama' },
        { key: 'color', label: 'Warna' },
        { key: 'hoist', label: 'Tampil terpisah' },
        { key: 'mentionable', label: 'Mentionable' },
      ],
    );

    const permissions = diffPermissions(
      oldRole.permissions.bitfield,
      newRole.permissions.bitfield,
    );
    if (permissions.added.length > 0) {
      lines.push(`• **Izin ditambahkan**: ${permissions.added.join(', ')}`);
    }
    if (permissions.removed.length > 0) {
      lines.push(`• **Izin dihapus**: ${permissions.removed.join(', ')}`);
    }

    if (lines.length === 0) return;

    const entry = await findAuditEntry(newRole.guild, AuditLogEvent.RoleUpdate, {
      targetId: newRole.id,
    });

    const embed = logEmbed({
      category: 'role',
      title: '📝 Role Diperbarui',
      fields: compactFields([
        { name: 'Role', value: `<@&${newRole.id}>` },
        changesField(lines),
        ...executorFields(entry),
      ]),
    });

    await dispatchLog(newRole.guild, 'role', embed, {
      eventKey: 'guildRoleUpdate',
      targetId: newRole.id,
      executorId: entry?.executor?.id ?? null,
    });
  },
} satisfies BotEvent<'roleUpdate'>;
