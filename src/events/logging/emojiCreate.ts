import { AuditLogEvent, Events, type GuildEmoji } from 'discord.js';
import { translatorFor } from '../../modules/i18n/index.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import { compactFields, executorFields, logEmbed } from '../../modules/logging/embeds.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.GuildEmojiCreate,
  async execute(_client, emoji: GuildEmoji): Promise<void> {
    const entry = await findAuditEntry(emoji.guild, AuditLogEvent.EmojiCreate, {
      targetId: emoji.id,
    });

    const t = await translatorFor(emoji.guild.id);
    const embed = logEmbed({
      category: 'server',
      title: t('log.embed.title.emojiCreate'),
      fields: compactFields([
        { name: t('log.embed.field.emoji'), value: `${emoji} (\`${emoji.name}\`)`, inline: true },
        { name: t('log.embed.field.id'), value: `\`${emoji.id}\``, inline: true },
        { name: t('log.embed.field.animated'), value: emoji.animated ? t('log.diff.yes') : t('log.diff.no'), inline: true },
        ...executorFields(entry, t),
      ]),
    }, t);

    await dispatchLog(emoji.guild, 'server', embed, {
      eventKey: 'guildEmojiCreate',
      executorId: entry?.executor?.id ?? null,
    });
  },
} satisfies BotEvent<'emojiCreate'>;
