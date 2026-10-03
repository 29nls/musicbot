import {
  AuditLogEvent,
  Events,
  OverwriteType,
  type DMChannel,
  type NonThreadGuildBasedChannel,
} from 'discord.js';
import { translatorFor } from '../../modules/i18n/index.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { diffOverwrites, diffValues, type OverwriteSnapshot } from '../../modules/logging/diff.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import {
  caseAwareFields,
  changesField,
  compactFields,
  executorFields,
  logEmbed,
} from '../../modules/logging/embeds.js';
import { consumeCaseLink } from '../../modules/moderation/index.js';
import type { BotEvent } from '../../types/event.js';

type ChannelSnapshot = Record<string, unknown>;

function snapshot(channel: NonThreadGuildBasedChannel): ChannelSnapshot {
  return {
    name: channel.name,
    topic: 'topic' in channel ? (channel.topic ?? '') : '',
    nsfw: 'nsfw' in channel ? channel.nsfw : false,
    slowmode: 'rateLimitPerUser' in channel ? (channel.rateLimitPerUser ?? 0) : 0,
    parent: channel.parentId ?? '',
    userLimit: 'userLimit' in channel ? (channel.userLimit ?? 0) : 0,
  };
}

function overwriteSnapshots(channel: NonThreadGuildBasedChannel): OverwriteSnapshot[] {
  const snapshots: OverwriteSnapshot[] = [];

  for (const overwrite of channel.permissionOverwrites.cache.values()) {
    snapshots.push({
      key: `${overwrite.type}:${overwrite.id}`,
      label: overwrite.type === OverwriteType.Role ? `<@&${overwrite.id}>` : `<@${overwrite.id}>`,
      allow: overwrite.allow.bitfield,
      deny: overwrite.deny.bitfield,
    });
  }

  return snapshots;
}

export default {
  name: Events.ChannelUpdate,
  async execute(
    client,
    oldChannel: DMChannel | NonThreadGuildBasedChannel,
    newChannel: DMChannel | NonThreadGuildBasedChannel,
  ): Promise<void> {
    if (newChannel.isDMBased() || oldChannel.isDMBased()) return;
    const t = await translatorFor(newChannel.guild.id);

    const lines = diffValues(snapshot(oldChannel), snapshot(newChannel), [
      { key: 'name', label: t('log.embed.field.name') },
      { key: 'topic', label: t('log.embed.field.topic'), format: (value) => (value ? String(value) : '—') },
      { key: 'nsfw', label: t('log.embed.field.nsfw') },
      { key: 'slowmode', label: t('log.embed.field.slowmode'), format: (value) => t('log.embed.value.seconds', { count: Number(value ?? 0) }) },
      { key: 'parent', label: t('log.embed.field.category'), format: (value) => (value ? `<#${String(value)}>` : '—') },
      { key: 'userLimit', label: t('log.embed.field.userLimit') },
    ], t);

    lines.push(...diffOverwrites(overwriteSnapshots(oldChannel), overwriteSnapshots(newChannel)));

    if (lines.length === 0) return;

    const entry = await findAuditEntry(newChannel.guild, AuditLogEvent.ChannelUpdate, {
      targetId: newChannel.id,
    });

    // `/slowmode`, `/lock`, dan `/unlock` semuanya mengubah channel ini.
    const link = consumeCaseLink(newChannel.guild.id, newChannel.id, ['slowmode', 'lock', 'unlock']);

    const embed = logEmbed({
      category: 'channel',
      title: link ? t('log.embed.title.channelUpdateHarmony') : t('log.embed.title.channelUpdate'),
      fields: compactFields([
        { name: t('log.embed.field.channel'), value: `<#${newChannel.id}> (\`${newChannel.name}\`)` },
        ...caseAwareFields(
          link,
          compactFields([changesField(lines, t), ...executorFields(entry, t)]),
          entry?.executor?.id,
          client.user?.id,
          t,
        ),
      ]),
    }, t);

    await dispatchLog(newChannel.guild, 'channel', embed, {
      eventKey: 'channelUpdate',
      targetId: newChannel.id,
      caseNumber: link?.caseNumber ?? null,
      record: link === null,
      executorId: entry?.executor?.id ?? null,
    });
  },
} satisfies BotEvent<'channelUpdate'>;
