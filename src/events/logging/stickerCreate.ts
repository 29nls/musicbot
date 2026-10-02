import { AuditLogEvent, Events, type Sticker } from 'discord.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import { compactFields, executorFields, logEmbed } from '../../modules/logging/embeds.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.GuildStickerCreate,
  async execute(_client, sticker: Sticker): Promise<void> {
    if (!sticker.guild) return;

    const entry = await findAuditEntry(sticker.guild, AuditLogEvent.StickerCreate, {
      targetId: sticker.id,
    });

    const embed = logEmbed({
      category: 'server',
      title: '🩹 Sticker Ditambahkan',
      fields: compactFields([
        { name: 'Nama', value: `\`${sticker.name}\``, inline: true },
        { name: 'ID', value: `\`${sticker.id}\``, inline: true },
        sticker.description ? { name: 'Deskripsi', value: sticker.description } : null,
        ...executorFields(entry),
      ]),
    });

    await dispatchLog(sticker.guild, 'server', embed, {
      eventKey: 'guildStickerCreate',
      executorId: entry?.executor?.id ?? null,
    });
  },
} satisfies BotEvent<'stickerCreate'>;
