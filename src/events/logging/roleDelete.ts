import { AuditLogEvent, Events, type Role } from 'discord.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import { compactFields, executorFields, logEmbed } from '../../modules/logging/embeds.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.GuildRoleDelete,
  async execute(_client, role: Role): Promise<void> {
    const entry = await findAuditEntry(role.guild, AuditLogEvent.RoleDelete, { targetId: role.id });

    const embed = logEmbed({
      category: 'role',
      title: '🗑️ Role Dihapus',
      fields: compactFields([
        { name: 'Nama', value: `\`${role.name}\``, inline: true },
        { name: 'ID', value: `\`${role.id}\``, inline: true },
        { name: 'Warna', value: `\`${role.hexColor}\``, inline: true },
        ...executorFields(entry),
      ]),
    });

    await dispatchLog(role.guild, 'role', embed, {
      eventKey: 'guildRoleDelete',
      targetId: role.id,
      executorId: entry?.executor?.id ?? null,
    });
  },
} satisfies BotEvent<'roleDelete'>;
