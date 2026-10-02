import { AuditLogEvent, Events, type GuildEmoji } from 'discord.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { diffValues } from '../../modules/logging/diff.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import { changesField, compactFields, executorFields, logEmbed } from '../../modules/logging/embeds.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.GuildEmojiUpdate,
  async execute(_client, oldEmoji: GuildEmoji, newEmoji: GuildEmoji): Promise<void> {
    const lines = diffValues(
      { name: oldEmoji.name ?? '', animated: oldEmoji.animated },
      { name: newEmoji.name ?? '', animated: newEmoji.animated },
      [
        { key: 'name', label: 'Nama' },
        { key: 'animated', label: 'Animasi' },
      ],
    );

    if (lines.length === 0) return;

    const entry = await findAuditEntry(newEmoji.guild, AuditLogEvent.EmojiUpdate, {
      targetId: newEmoji.id,
    });

    const embed = logEmbed({
      category: 'server',
      title: '📝 Emoji Diperbarui',
      fields: compactFields([
        { name: 'Emoji', value: `${newEmoji}`, inline: true },
        changesField(lines),
        ...executorFields(entry),
      ]),
    });

    await dispatchLog(newEmoji.guild, 'server', embed, {
      eventKey: 'guildEmojiUpdate',
      executorId: entry?.executor?.id ?? null,
    });
  },
} satisfies BotEvent<'emojiUpdate'>;
