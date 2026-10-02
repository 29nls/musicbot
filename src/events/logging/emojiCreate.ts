import { AuditLogEvent, Events, type GuildEmoji } from 'discord.js';
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

    const embed = logEmbed({
      category: 'server',
      title: '😀 Emoji Ditambahkan',
      fields: compactFields([
        { name: 'Emoji', value: `${emoji} (\`${emoji.name}\`)`, inline: true },
        { name: 'ID', value: `\`${emoji.id}\``, inline: true },
        { name: 'Animasi', value: emoji.animated ? 'Ya' : 'Tidak', inline: true },
        ...executorFields(entry),
      ]),
    });

    await dispatchLog(emoji.guild, 'server', embed);
  },
} satisfies BotEvent<'emojiCreate'>;
