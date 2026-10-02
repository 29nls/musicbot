import {
  AuditLogEvent,
  Events,
  type GuildTextBasedChannel,
  type Message,
  type PartialMessage,
  type ReadonlyCollection,
  type Snowflake,
} from 'discord.js';
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

    const embed = logEmbed({
      category: 'message',
      title: '🧹 Pesan Dihapus Massal',
      fields: compactFields([
        { name: 'Channel', value: `<#${channel.id}>`, inline: true },
        { name: 'Jumlah', value: `${messages.size} pesan`, inline: true },
        authorIds.length > 0
          ? {
              name: 'Penulis',
              value:
                authorPreview +
                (authorIds.length > 5 ? ` (+${authorIds.length - 5} lainnya)` : ''),
            }
          : null,
        ...executorFields(entry),
      ]),
    });

    await dispatchLog(channel.guild, 'message', embed);
  },
} satisfies BotEvent<'messageDeleteBulk'>;
