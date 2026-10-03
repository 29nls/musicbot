import { AuditLogEvent, Events, type Message, type PartialMessage } from 'discord.js';
import { translatorFor } from '../../modules/i18n/index.js';
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

    const t = await translatorFor(message.guild.id);
    const embed = logEmbed({
      category: 'message',
      title: t('log.embed.title.messageDelete'),
      description: message.content
          ? `> ${truncate(message.content, 400)}`
          : t('log.embed.value.noContent'),
      fields: compactFields([
        { name: t('log.embed.field.channel'), value: `<#${message.channelId}>`, inline: true },
        author ? { name: t('log.embed.field.author'), value: `<@${author.id}> (\`${author.tag}\`)`, inline: true } : null,
        { name: t('log.embed.field.messageId'), value: `\`${message.id}\``, inline: true },
        attachmentCount > 0 ? { name: t('log.embed.field.attachments'), value: t('log.embed.value.attachmentCount', { count: attachmentCount }), inline: true } : null,
        ...executorFields(entry, t),
      ]),
    }, t);

    await dispatchLog(message.guild, 'message', embed, {
      eventKey: 'messageDelete',
      targetId: author?.id ?? null,
      channelId: message.channelId,
    });
  },
} satisfies BotEvent<'messageDelete'>;
