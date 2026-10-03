import { AuditLogEvent, Events, type GuildEmoji } from 'discord.js';
import { translatorFor } from '../../modules/i18n/index.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { diffValues } from '../../modules/logging/diff.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import { changesField, compactFields, executorFields, logEmbed } from '../../modules/logging/embeds.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.GuildEmojiUpdate,
  async execute(_client, oldEmoji: GuildEmoji, newEmoji: GuildEmoji): Promise<void> {
    const t = await translatorFor(newEmoji.guild.id);
    const lines = diffValues(
      { name: oldEmoji.name ?? '', animated: oldEmoji.animated },
      { name: newEmoji.name ?? '', animated: newEmoji.animated },
      [
        { key: 'name', label: t('log.embed.field.name') },
        { key: 'animated', label: t('log.embed.field.animated') },
      ],
      t,
    );

    if (lines.length === 0) return;

    const entry = await findAuditEntry(newEmoji.guild, AuditLogEvent.EmojiUpdate, {
      targetId: newEmoji.id,
    });

    const embed = logEmbed({
      category: 'server',
      title: t('log.embed.title.emojiUpdate'),
      fields: compactFields([
        { name: t('log.embed.field.emoji'), value: `${newEmoji}`, inline: true },
        changesField(lines, t),
        ...executorFields(entry, t),
      ]),
    }, t);

    await dispatchLog(newEmoji.guild, 'server', embed, {
      eventKey: 'guildEmojiUpdate',
      executorId: entry?.executor?.id ?? null,
    });
  },
} satisfies BotEvent<'emojiUpdate'>;
