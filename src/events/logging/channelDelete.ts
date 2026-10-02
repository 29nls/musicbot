import {
  AuditLogEvent,
  ChannelType,
  Events,
  type DMChannel,
  type NonThreadGuildBasedChannel,
} from 'discord.js';
import { findAuditEntry } from '../../modules/logging/audit.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import { compactFields, executorFields, logEmbed } from '../../modules/logging/embeds.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.ChannelDelete,
  async execute(_client, channel: DMChannel | NonThreadGuildBasedChannel): Promise<void> {
    if (channel.isDMBased()) return;

    const entry = await findAuditEntry(channel.guild, AuditLogEvent.ChannelDelete, {
      targetId: channel.id,
    });

    const embed = logEmbed({
      category: 'channel',
      title: '🗑️ Channel Dihapus',
      fields: compactFields([
        { name: 'Nama', value: `\`${channel.name}\``, inline: true },
        { name: 'ID', value: `\`${channel.id}\``, inline: true },
        { name: 'Tipe', value: ChannelType[channel.type], inline: true },
        channel.parentId ? { name: 'Kategori', value: `<#${channel.parentId}>`, inline: true } : null,
        ...executorFields(entry),
      ]),
    });

    await dispatchLog(channel.guild, 'channel', embed);
  },
} satisfies BotEvent<'channelDelete'>;
