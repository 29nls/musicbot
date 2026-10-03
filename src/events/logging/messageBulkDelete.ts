import {
  AuditLogEvent,
  Events,
  type GuildTextBasedChannel,
  type Message,
  type PartialMessage,
  type ReadonlyCollection,
  type Snowflake,
} from 'discord.js';
import { translatorFor } from '../../modules/i18n/index.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import { compactFields, executorFields, logEmbed } from '../../modules/logging/embeds.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.MessageBulkDelete,
  async execute(
    _client,
    messages: ReadonlyCollection<Snowflake, Message<true> | PartialMessage<true>>,
    channel: GuildTextBasedChannel,
  ): Promise<void> {
    const entry = await findAuditEntry(channel.guild, AuditLogEvent.MessageBulkDelete, {
      maxAgeMs: 15_000,
    });

    const authorIds = [
      ...new Set(
        [...messages.values()]
          .map((message) => message.author?.id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const authorPreview = authorIds.slice(0, 5).map((id) => `<@${id}>`).join(', ');

    const t = await translatorFor(channel.guild.id);
    const embed = logEmbed({
      category: 'message',
      title: t('log.embed.title.messageBulkDelete'),
      fields: compactFields([
        { name: t('log.embed.field.channel'), value: `<#${channel.id}>`, inline: true },
        { name: t('log.embed.field.count'), value: t('log.embed.value.messageCount', { count: messages.size }), inline: true },
        authorIds.length > 0
          ? {
              name: t('log.embed.field.author'),
              value:
                authorPreview +
                (authorIds.length > 5
                  ? t('log.embed.value.others', { count: authorIds.length - 5 })
                  : ''),
            }
          : null,
        ...executorFields(entry, t),
      ]),
    }, t);

    await dispatchLog(channel.guild, 'message', embed, {
      eventKey: 'messageBulkDelete',
      targetId: authorIds.length === 1 ? (authorIds[0] ?? null) : null,
      channelId: channel.id,
      executorId: entry?.executor?.id ?? null,
    });
  },
} satisfies BotEvent<'messageDeleteBulk'>;
