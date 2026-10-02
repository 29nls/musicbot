import { AuditLogEvent, Events, type Role } from 'discord.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import { compactFields, executorFields, logEmbed } from '../../modules/logging/embeds.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.GuildRoleCreate,
  async execute(_client, role: Role): Promise<void> {
    const entry = await findAuditEntry(role.guild, AuditLogEvent.RoleCreate, { targetId: role.id });

    const embed = logEmbed({
      category: 'role',
      title: '🎭 Role Dibuat',
      fields: compactFields([
        { name: 'Role', value: `<@&${role.id}> (\`${role.name}\`)`, inline: true },
        { name: 'Warna', value: `\`${role.hexColor}\``, inline: true },
        { name: 'Mentionable', value: role.mentionable ? 'Ya' : 'Tidak', inline: true },
        ...executorFields(entry),
      ]),
    });

    await dispatchLog(role.guild, 'role', embed);
  },
} satisfies BotEvent<'roleCreate'>;
