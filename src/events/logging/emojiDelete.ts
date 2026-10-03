import { AuditLogEvent, Events, type GuildEmoji } from 'discord.js';
import { translatorFor } from '../../modules/i18n/index.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import { compactFields, executorFields, logEmbed } from '../../modules/logging/embeds.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.GuildEmojiDelete,
  async execute(_client, emoji: GuildEmoji): Promise<void> {
    const entry = await findAuditEntry(emoji.guild, AuditLogEvent.EmojiDelete, {
      targetId: emoji.id,
    });

    const t = await translatorFor(emoji.guild.id);
    const embed = logEmbed({
      category: 'server',
      title: t('log.embed.title.emojiDelete'),
      fields: compactFields([
        { name: t('log.embed.field.name'), value: `\`${emoji.name}\``, inline: true },
        { name: t('log.embed.field.id'), value: `\`${emoji.id}\``, inline: true },
        ...executorFields(entry, t),
      ]),
    }, t);

    await dispatchLog(emoji.guild, 'server', embed, {
      eventKey: 'guildEmojiDelete',
      executorId: entry?.executor?.id ?? null,
    });
  },
} satisfies BotEvent<'emojiDelete'>;
