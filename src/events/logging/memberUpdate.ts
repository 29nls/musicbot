import {
  AuditLogEvent,
  Events,
  type GuildMember,
  type PartialGuildMember,
} from 'discord.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { diffIdSets } from '../../modules/logging/diff.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import {
  caseAwareFields,
  changesField,
  compactFields,
  executorFields,
  logEmbed,
} from '../../modules/logging/embeds.js';
import { consumeCaseLink } from '../../modules/moderation/index.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.GuildMemberUpdate,
  async execute(
    client,
    oldMember: GuildMember | PartialGuildMember,
    newMember: GuildMember,
  ): Promise<void> {
    const guild = newMember.guild;
    const lines: string[] = [];

    if (oldMember.nickname !== newMember.nickname) {
      lines.push(
        `• **Nama panggilan**: ${oldMember.nickname ?? '—'} → ${newMember.nickname ?? '—'}`,
      );
    }

    let rolesChanged = false;
    if (!oldMember.partial) {
      const { added, removed } = diffIdSets(
        [...oldMember.roles.cache.keys()],
        [...newMember.roles.cache.keys()],
      );

      if (added.length > 0) {
        lines.push(`• **Role ditambahkan**: ${added.map((id) => `<@&${id}>`).join(', ')}`);
      }
      if (removed.length > 0) {
        lines.push(`• **Role dihapus**: ${removed.map((id) => `<@&${id}>`).join(', ')}`);
      }
      rolesChanged = added.length > 0 || removed.length > 0;
    }

    const timeoutBefore = oldMember.communicationDisabledUntilTimestamp;
    const timeoutAfter = newMember.communicationDisabledUntilTimestamp;
    const timeoutChanged = timeoutBefore !== timeoutAfter;

    if (timeoutChanged) {
      const format = (timestamp: number | null): string =>
        timestamp ? `<t:${Math.floor(timestamp / 1_000)}:R>` : '—';
      lines.push(`• **Timeout**: ${format(timeoutBefore)} → ${format(timeoutAfter)}`);
    }

    if (lines.length === 0) return;

    // Tautan timeout hanya diambil saat timeout benar-benar berubah; event ini
    // juga menyalakan perubahan nickname/role yang tidak ada hubungannya.
    const link = timeoutChanged
      ? consumeCaseLink(guild.id, newMember.id, ['timeout'])
      : null;

    const change = changesField(lines);
    const auditType = rolesChanged && !timeoutChanged
      ? AuditLogEvent.MemberRoleUpdate
      : AuditLogEvent.MemberUpdate;
    const entry = await findAuditEntry(guild, auditType, { targetId: newMember.id });

    const embed = logEmbed({
      category: 'member',
      title: link ? '⏱️ Timeout Diperbarui (Harmony)' : '📝 Member Diperbarui',
      fields: compactFields([
        { name: 'Member', value: `<@${newMember.id}> (\`${newMember.user.tag}\`)`, inline: true },
        ...caseAwareFields(
          link,
          compactFields([change, ...executorFields(entry)]),
          entry?.executor?.id,
          client.user?.id,
        ),
      ]),
    });

    await dispatchLog(guild, 'member', embed, {
      eventKey: 'guildMemberUpdate',
      targetId: newMember.id,
      executorId: entry?.executor?.id ?? null,
      caseNumber: link?.caseNumber ?? null,
      record: link === null,
    });
  },
} satisfies BotEvent<'guildMemberUpdate'>;
