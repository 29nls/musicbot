import {
  AuditLogEvent,
  Events,
  OverwriteType,
  type DMChannel,
  type NonThreadGuildBasedChannel,
} from 'discord.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { diffOverwrites, diffValues, type OverwriteSnapshot } from '../../modules/logging/diff.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import { changesField, compactFields, executorFields, logEmbed } from '../../modules/logging/embeds.js';
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
    _client,
    oldChannel: DMChannel | NonThreadGuildBasedChannel,
    newChannel: DMChannel | NonThreadGuildBasedChannel,
  ): Promise<void> {
    if (newChannel.isDMBased() || oldChannel.isDMBased()) return;

    const lines = diffValues(snapshot(oldChannel), snapshot(newChannel), [
      { key: 'name', label: 'Nama' },
      { key: 'topic', label: 'Topik', format: (value) => (value ? String(value) : '—') },
      { key: 'nsfw', label: 'NSFW' },
      { key: 'slowmode', label: 'Slowmode', format: (value) => `${value ?? 0} detik` },
      { key: 'parent', label: 'Kategori', format: (value) => (value ? `<#${String(value)}>` : '—') },
      { key: 'userLimit', label: 'Batas user' },
    ]);

    lines.push(...diffOverwrites(overwriteSnapshots(oldChannel), overwriteSnapshots(newChannel)));

    if (lines.length === 0) return;

    const entry = await findAuditEntry(newChannel.guild, AuditLogEvent.ChannelUpdate, {
      targetId: newChannel.id,
    });

    const embed = logEmbed({
      category: 'channel',
      title: '📝 Channel Diperbarui',
      fields: compactFields([
        { name: 'Channel', value: `<#${newChannel.id}> (\`${newChannel.name}\`)` },
        changesField(lines),
        ...executorFields(entry),
      ]),
    });

    await dispatchLog(newChannel.guild, 'channel', embed);
  },
} satisfies BotEvent<'channelUpdate'>;
