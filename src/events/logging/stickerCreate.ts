import { AuditLogEvent, Events, type Sticker } from 'discord.js';
import { translatorFor } from '../../modules/i18n/index.js';
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

    const t = await translatorFor(sticker.guild.id);
    const embed = logEmbed({
      category: 'server',
      title: t('log.embed.title.stickerCreate'),
      fields: compactFields([
        { name: t('log.embed.field.name'), value: `\`${sticker.name}\``, inline: true },
        { name: t('log.embed.field.id'), value: `\`${sticker.id}\``, inline: true },
        sticker.description ? { name: t('log.embed.field.description'), value: sticker.description } : null,
        ...executorFields(entry, t),
      ]),
    }, t);

    await dispatchLog(sticker.guild, 'server', embed, {
      eventKey: 'guildStickerCreate',
      executorId: entry?.executor?.id ?? null,
    });
  },
} satisfies BotEvent<'stickerCreate'>;
