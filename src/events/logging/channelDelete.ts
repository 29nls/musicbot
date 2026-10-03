import {
  AuditLogEvent,
  ChannelType,
  Events,
  type DMChannel,
  type NonThreadGuildBasedChannel,
} from 'discord.js';
import { translatorFor } from '../../modules/i18n/index.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import { compactFields, executorFields, logEmbed } from '../../modules/logging/embeds.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.ChannelDelete,
  async execute(_client, channel: DMChannel | NonThreadGuildBasedChannel): Promise<void> {
    if (channel.isDMBased()) return;

    const entry = await findAuditEntry(channel.guild, AuditLogEvent.ChannelDelete, {
      targetId: channel.id,
    });

    const t = await translatorFor(channel.guild.id);
    const embed = logEmbed({
      category: 'channel',
      title: t('log.embed.title.channelDelete'),
      fields: compactFields([
        { name: t('log.embed.field.name'), value: `\`${channel.name}\``, inline: true },
        { name: t('log.embed.field.id'), value: `\`${channel.id}\``, inline: true },
        { name: t('log.embed.field.type'), value: ChannelType[channel.type], inline: true },
        channel.parentId ? { name: t('log.embed.field.category'), value: `<#${channel.parentId}>`, inline: true } : null,
        ...executorFields(entry, t),
      ]),
    }, t);

    await dispatchLog(channel.guild, 'channel', embed, {
      eventKey: 'channelDelete',
      targetId: channel.id,
      executorId: entry?.executor?.id ?? null,
    });
  },
} satisfies BotEvent<'channelDelete'>;
