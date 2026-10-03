import { AuditLogEvent, Events, type Sticker } from 'discord.js';
import { translatorFor } from '../../modules/i18n/index.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { diffValues } from '../../modules/logging/diff.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import { changesField, compactFields, executorFields, logEmbed } from '../../modules/logging/embeds.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.GuildStickerUpdate,
  async execute(_client, oldSticker: Sticker, newSticker: Sticker): Promise<void> {
    if (!newSticker.guild) return;
    const t = await translatorFor(newSticker.guild.id);

    const lines = diffValues(
      {
        name: oldSticker.name,
        description: oldSticker.description ?? '',
        tags: oldSticker.tags ?? '',
      },
      {
        name: newSticker.name,
        description: newSticker.description ?? '',
        tags: newSticker.tags ?? '',
      },
      [
        { key: 'name', label: t('log.embed.field.name') },
        { key: 'description', label: t('log.embed.field.description'), format: (value) => (value ? String(value) : '—') },
        { key: 'tags', label: t('log.embed.field.tags'), format: (value) => (value ? String(value) : '—') },
      ],
      t,
    );

    if (lines.length === 0) return;

    const entry = await findAuditEntry(newSticker.guild, AuditLogEvent.StickerUpdate, {
      targetId: newSticker.id,
    });

    const embed = logEmbed({
      category: 'server',
      title: t('log.embed.title.stickerUpdate'),
      fields: compactFields([changesField(lines, t), ...executorFields(entry, t)]),
    }, t);

    await dispatchLog(newSticker.guild, 'server', embed, {
      eventKey: 'guildStickerUpdate',
      executorId: entry?.executor?.id ?? null,
    });
  },
} satisfies BotEvent<'stickerUpdate'>;
