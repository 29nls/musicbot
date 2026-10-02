import { AuditLogEvent, Events, type GuildBan } from 'discord.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import {
  caseAwareFields,
  compactFields,
  executorFields,
  logEmbed,
} from '../../modules/logging/embeds.js';
import { consumeCaseLink } from '../../modules/moderation/index.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.GuildBanRemove,
  async execute(client, ban: GuildBan): Promise<void> {
    const link = consumeCaseLink(ban.guild.id, ban.user.id, ['unban']);
    const entry = await findAuditEntry(ban.guild, AuditLogEvent.MemberBanRemove, {
      targetId: ban.user.id,
    });

    const embed = logEmbed({
      category: 'member',
      title: link ? '♻️ Ban Dicabut (Harmony)' : '♻️ Ban Dicabut',
      fields: compactFields([
        { name: 'Member', value: `<@${ban.user.id}> (\`${ban.user.tag}\`)`, inline: true },
        { name: 'ID', value: `\`${ban.user.id}\``, inline: true },
        ...caseAwareFields(link, executorFields(entry), entry?.executor?.id, client.user?.id),
      ]),
    });

    await dispatchLog(ban.guild, 'member', embed, {
      eventKey: 'guildBanRemove',
      targetId: ban.user.id,
      executorId: entry?.executor?.id ?? null,
      caseNumber: link?.caseNumber ?? null,
      record: link === null,
    });
  },
} satisfies BotEvent<'guildBanRemove'>;
