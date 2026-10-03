import { Events, type VoiceState } from 'discord.js';
import { translatorFor } from '../../modules/i18n/index.js';
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
    const t = await translatorFor(member.guild.id);

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
        { key: 'serverMute', label: t('log.embed.field.serverMute') },
        { key: 'serverDeaf', label: t('log.embed.field.serverDeaf') },
        { key: 'selfMute', label: t('log.embed.field.selfMute') },
        { key: 'selfDeaf', label: t('log.embed.field.selfDeaf') },
        { key: 'streaming', label: t('log.embed.field.streaming') },
      ],
      t,
    );

    if (!joined && !left && !moved && changes.length === 0) return;

    const title = joined
      ? t('log.embed.title.voiceJoin')
      : left
        ? t('log.embed.title.voiceLeave')
        : moved
          ? t('log.embed.title.voiceMove')
          : t('log.embed.title.voiceState');

    const embed = logEmbed({
      category: 'voice',
      title,
      fields: compactFields([
        { name: t('log.embed.field.member'), value: `<@${member.id}> (\`${member.user.tag}\`)`, inline: true },
        oldState.channelId ? { name: t('log.embed.field.from'), value: `<#${oldState.channelId}>`, inline: true } : null,
        newState.channelId ? { name: t('log.embed.field.to'), value: `<#${newState.channelId}>`, inline: true } : null,
        changesField(changes, t),
      ]),
    }, t);

    await dispatchLog(member.guild, 'voice', embed, {
      eventKey: 'voiceStateUpdate',
      targetId: member.id,
      channelId: newState.channelId ?? oldState.channelId,
    });
  },
} satisfies BotEvent<'voiceStateUpdate'>;
