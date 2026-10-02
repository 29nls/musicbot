import { AuditLogEvent, Events, type GuildEmoji } from 'discord.js';
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

    const embed = logEmbed({
      category: 'server',
      title: '🗑️ Emoji Dihapus',
      fields: compactFields([
        { name: 'Nama', value: `\`${emoji.name}\``, inline: true },
        { name: 'ID', value: `\`${emoji.id}\``, inline: true },
        ...executorFields(entry),
      ]),
    });

    await dispatchLog(emoji.guild, 'server', embed);
  },
} satisfies BotEvent<'emojiDelete'>;
