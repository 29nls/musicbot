import { AuditLogEvent, Events, type GuildBan } from 'discord.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import {
  caseSourceFields,
  compactFields,
  executorFields,
  logEmbed,
} from '../../modules/logging/embeds.js';
import { consumeCaseLink } from '../../modules/moderation/index.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.GuildBanAdd,
  async execute(client, ban: GuildBan): Promise<void> {
    const link = consumeCaseLink(ban.guild.id, ban.user.id, ['ban']);
    const entry = await findAuditEntry(ban.guild, AuditLogEvent.MemberBanAdd, {
      targetId: ban.user.id,
    });

    const embed = logEmbed({
      category: 'member',
      title: link ? '🔨 Member Ban (Harmony)' : '🔨 Member Ban',
      fields: compactFields([
        { name: 'Member', value: `<@${ban.user.id}> (\`${ban.user.tag}\`)`, inline: true },
        { name: 'ID', value: `\`${ban.user.id}\``, inline: true },
        ...executorFields(entry),
        ...caseSourceFields(link, entry?.executor?.id, client.user?.id),
      ]),
    });

    await dispatchLog(ban.guild, 'member', embed, {
      eventKey: 'guildBanAdd',
      targetId: ban.user.id,
      executorId: entry?.executor?.id ?? null,
      caseNumber: link?.caseNumber ?? null,
      // Kasus sudah dicatat perintah; event ini cukup menempelkan nomornya.
      record: link === null,
    });
  },
} satisfies BotEvent<'guildBanAdd'>;
