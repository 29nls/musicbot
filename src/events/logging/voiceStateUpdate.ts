import { Events, type VoiceState } from 'discord.js';
import { diffValues } from '../../modules/logging/diff.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import { changesField, compactFields, logEmbed } from '../../modules/logging/embeds.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.VoiceStateUpdate,
  async execute(_client, oldState: VoiceState, newState: VoiceState): Promise<void> {
    const member = newState.member ?? oldState.member;
    if (!member) return;

    const joined = !oldState.channelId && Boolean(newState.channelId);
    const left = Boolean(oldState.channelId) && !newState.channelId;
    const moved = oldState.channelId !== newState.channelId && !joined && !left;

    const changes = diffValues(
      {
        serverMute: oldState.serverMute,
        serverDeaf: oldState.serverDeaf,
        selfMute: oldState.selfMute,
        selfDeaf: oldState.selfDeaf,
        streaming: oldState.streaming,
      },
      {
        serverMute: newState.serverMute,
        serverDeaf: newState.serverDeaf,
        selfMute: newState.selfMute,
        selfDeaf: newState.selfDeaf,
        streaming: newState.streaming,
      },
      [
        { key: 'serverMute', label: 'Server mute' },
        { key: 'serverDeaf', label: 'Server deaf' },
        { key: 'selfMute', label: 'Self mute' },
        { key: 'selfDeaf', label: 'Self deaf' },
        { key: 'streaming', label: 'Streaming' },
      ],
    );

    if (!joined && !left && !moved && changes.length === 0) return;

    const title = joined
      ? '🔊 Join Voice'
      : left
        ? '🔇 Leave Voice'
        : moved
          ? '🔁 Pindah Voice'
          : '🎙️ Voice State';

    const embed = logEmbed({
      category: 'voice',
      title,
      fields: compactFields([
        { name: 'Member', value: `<@${member.id}> (\`${member.user.tag}\`)`, inline: true },
        oldState.channelId ? { name: 'Dari', value: `<#${oldState.channelId}>`, inline: true } : null,
        newState.channelId ? { name: 'Ke', value: `<#${newState.channelId}>`, inline: true } : null,
        changesField(changes),
      ]),
    });

    await dispatchLog(member.guild, 'voice', embed, {
      eventKey: 'voiceStateUpdate',
      targetId: member.id,
      channelId: newState.channelId ?? oldState.channelId,
    });
  },
} satisfies BotEvent<'voiceStateUpdate'>;
