import { Events, type Message, type PartialMessage } from 'discord.js';
import { translatorFor } from '../../modules/i18n/index.js';
import { dispatchLog } from '../../modules/logging/dispatch.js';
import { compactFields, logEmbed, truncate } from '../../modules/logging/embeds.js';
import type { BotEvent } from '../../types/event.js';

export default {
  name: Events.MessageUpdate,
  async execute(_client, oldMessage: Message | PartialMessage, newMessage: Message): Promise<void> {
    if (!newMessage.inGuild()) return;

    const before = oldMessage.partial ? null : oldMessage.content;
    const after = newMessage.content;

    // Perubahan non-teks (embed/lampiran) sengaja tidak dicatat agar tidak berisik.
    if (before === after) return;
    if (after.length === 0 && before === null) return;
    const t = await translatorFor(newMessage.guild.id);

    const description =
      before === null
        ? t('log.embed.value.noPrevious') +
          `> ${truncate(after, 400)}`
        : t('log.embed.value.before') +
          `> ${truncate(before, 400)}` +
          t('log.embed.value.after') +
          `> ${truncate(after, 400)}`;

    const embed = logEmbed({
      category: 'message',
      title: t('log.embed.title.messageUpdate'),
      description,
      // Tanpa executor: Discord tidak menulis entri audit log untuk edit pesan,
      // jadi kolomnya sengaja dihilangkan (bukan diisi "-").
      fields: compactFields([
        { name: t('log.embed.field.channel'), value: `<#${newMessage.channelId}>`, inline: true },
        { name: t('log.embed.field.author'), value: `<@${newMessage.author.id}> (\`${newMessage.author.tag}\`)`, inline: true },
        { name: t('log.embed.field.jump'), value: `[${t('log.embed.value.jumpLink')}](${newMessage.url})`, inline: true },
      ]),
    }, t);

    await dispatchLog(newMessage.guild, 'message', embed, {
      eventKey: 'messageUpdate',
      targetId: newMessage.author.id,
      channelId: newMessage.channelId,
    });
  },
} satisfies BotEvent<'messageUpdate'>;
