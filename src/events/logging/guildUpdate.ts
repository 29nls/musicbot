import { AuditLogEvent, Events, type Guild } from 'discord.js';
import { translatorFor } from '../../modules/i18n/index.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { diffValues } from '../../modules/logging/diff.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import { changesField, compactFields, executorFields, logEmbed } from '../../modules/logging/embeds.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.GuildUpdate,
  async execute(_client, oldGuild: Guild, newGuild: Guild): Promise<void> {
    const t = await translatorFor(newGuild.id);
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
        { key: 'name', label: t('log.embed.field.serverName') },
        { key: 'vanity', label: t('log.embed.field.vanityUrl'), format: (value) => (value ? `discord.gg/${String(value)}` : '—') },
        { key: 'owner', label: t('log.embed.field.owner'), format: (value) => `<@${String(value)}>` },
        { key: 'tier', label: t('log.embed.field.boostTier'), format: (value) => t('log.embed.value.level', { level: String(value) }) },
        { key: 'boosts', label: t('log.embed.field.boosts') },
        { key: 'icon', label: t('log.embed.field.icon'), format: (value) => (value ? t('log.embed.value.present') : t('log.embed.value.absent')) },
        { key: 'banner', label: t('log.embed.field.banner'), format: (value) => (value ? t('log.embed.value.present') : t('log.embed.value.absent')) },
      ],
      t,
    );

    if (lines.length === 0) return;

    const entry = await findAuditEntry(newGuild, AuditLogEvent.GuildUpdate);

    const embed = logEmbed({
      category: 'server',
      title: t('log.embed.title.guildUpdate'),
      fields: compactFields([
        changesField(lines, t),
        ...executorFields(entry, t),
      ]),
    }, t);

    await dispatchLog(newGuild, 'server', embed, {
      eventKey: 'guildUpdate',
      executorId: entry?.executor?.id ?? null,
    });
  },
} satisfies BotEvent<'guildUpdate'>;
