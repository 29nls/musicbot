import { AuditLogEvent, Events, type Message, type PartialMessage } from 'discord.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import { compactFields, executorFields, logEmbed, truncate } from '../../modules/logging/embeds.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.MessageDelete,
  async execute(
    _client,
    message: Message | PartialMessage,
  ): Promise<void> {
    if (!message.inGuild()) return;

    const entry = await findAuditEntry(message.guild, AuditLogEvent.MessageDelete, {
      maxAgeMs: 10_000,
    });

    const author = message.author;
    const attachmentCount = message.attachments?.size ?? 0;

    const embed = logEmbed({
      category: 'message',
      title: '🗑️ Pesan Dihapus',
      description: message.content ? `> ${truncate(message.content, 400)}` : '*Isi pesan tidak tersedia.*',
      fields: compactFields([
        { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
        author ? { name: 'Penulis', value: `<@${author.id}> (\`${author.tag}\`)`, inline: true } : null,
        { name: 'ID pesan', value: `\`${message.id}\``, inline: true },
        attachmentCount > 0 ? { name: 'Lampiran', value: `${attachmentCount} file`, inline: true } : null,
        ...executorFields(entry),
      ]),
    });

    await dispatchLog(message.guild, 'message', embed, {
      eventKey: 'messageDelete',
      targetId: author?.id ?? null,
      channelId: message.channelId,
    });
  },
} satisfies BotEvent<'messageDelete'>;
