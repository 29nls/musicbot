import { AuditLogEvent, ChannelType, Events, type NonThreadGuildBasedChannel } from 'discord.js';
import { translatorFor } from '../../modules/i18n/index.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import { compactFields, executorFields, logEmbed } from '../../modules/logging/embeds.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.ChannelCreate,
  async execute(_client, channel: NonThreadGuildBasedChannel): Promise<void> {
    const entry = await findAuditEntry(channel.guild, AuditLogEvent.ChannelCreate, {
      targetId: channel.id,
    });

    const t = await translatorFor(channel.guild.id);
    const embed = logEmbed({
      category: 'channel',
      title: t('log.embed.title.channelCreate'),
      fields: compactFields([
        { name: t('log.embed.field.channel'), value: `<#${channel.id}>`, inline: true },
        { name: t('log.embed.field.name'), value: `\`${channel.name}\``, inline: true },
        { name: t('log.embed.field.type'), value: ChannelType[channel.type], inline: true },
        channel.parentId ? { name: t('log.embed.field.category'), value: `<#${channel.parentId}>`, inline: true } : null,
        ...executorFields(entry, t),
      ]),
    }, t);

    await dispatchLog(channel.guild, 'channel', embed, {
      eventKey: 'channelCreate',
      targetId: channel.id,
      executorId: entry?.executor?.id ?? null,
    });
  },
} satisfies BotEvent<'channelCreate'>;
