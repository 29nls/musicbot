import { AuditLogEvent, Events, type GuildBan } from 'discord.js';
import { translatorFor } from '../../modules/i18n/index.js';
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
  name: Events.GuildBanAdd,
  async execute(client, ban: GuildBan): Promise<void> {
    const link = consumeCaseLink(ban.guild.id, ban.user.id, ['ban']);
    const entry = await findAuditEntry(ban.guild, AuditLogEvent.MemberBanAdd, {
      targetId: ban.user.id,
    });

    const t = await translatorFor(ban.guild.id);
    const embed = logEmbed({
      category: 'member',
      title: link ? t('log.embed.title.banAddHarmony') : t('log.embed.title.banAdd'),
      fields: compactFields([
        { name: t('log.embed.field.member'), value: `<@${ban.user.id}> (\`${ban.user.tag}\`)`, inline: true },
        { name: t('log.embed.field.id'), value: `\`${ban.user.id}\``, inline: true },
        ...caseAwareFields(link, executorFields(entry, t), entry?.executor?.id, client.user?.id, t),
      ]),
    }, t);

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
