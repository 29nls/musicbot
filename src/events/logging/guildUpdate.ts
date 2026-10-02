import { AuditLogEvent, Events, type Guild } from 'discord.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { diffValues } from '../../modules/logging/diff.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import { changesField, compactFields, executorFields, logEmbed } from '../../modules/logging/embeds.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.GuildUpdate,
  async execute(_client, oldGuild: Guild, newGuild: Guild): Promise<void> {
    const lines = diffValues(
      {
        name: oldGuild.name,
        vanity: oldGuild.vanityURLCode ?? '',
        owner: oldGuild.ownerId,
        tier: Number(oldGuild.premiumTier),
        boosts: oldGuild.premiumSubscriptionCount ?? 0,
        icon: Boolean(oldGuild.icon),
        banner: Boolean(oldGuild.banner),
      },
      {
        name: newGuild.name,
        vanity: newGuild.vanityURLCode ?? '',
        owner: newGuild.ownerId,
        tier: Number(newGuild.premiumTier),
        boosts: newGuild.premiumSubscriptionCount ?? 0,
        icon: Boolean(newGuild.icon),
        banner: Boolean(newGuild.banner),
      },
      [
        { key: 'name', label: 'Nama server' },
        { key: 'vanity', label: 'Vanity URL', format: (value) => (value ? `discord.gg/${String(value)}` : '—') },
        { key: 'owner', label: 'Pemilik', format: (value) => `<@${String(value)}>` },
        { key: 'tier', label: 'Boost tier', format: (value) => `Level ${String(value)}` },
        { key: 'boosts', label: 'Jumlah boost' },
        { key: 'icon', label: 'Ikon', format: (value) => (value ? 'Ada' : 'Tidak ada') },
        { key: 'banner', label: 'Banner', format: (value) => (value ? 'Ada' : 'Tidak ada') },
      ],
    );

    if (lines.length === 0) return;

    const entry = await findAuditEntry(newGuild, AuditLogEvent.GuildUpdate);

    const embed = logEmbed({
      category: 'server',
      title: '🏠 Server Diperbarui',
      fields: compactFields([
        changesField(lines),
        ...executorFields(entry),
      ]),
    });

    await dispatchLog(newGuild, 'server', embed, {
      eventKey: 'guildUpdate',
      executorId: entry?.executor?.id ?? null,
    });
  },
} satisfies BotEvent<'guildUpdate'>;
