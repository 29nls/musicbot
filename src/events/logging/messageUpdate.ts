import { Events, type Message, type PartialMessage } from 'discord.js';
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

    const description =
      before === null
        ? `*Isi sebelumnya tidak tersedia (pesan lama tidak di-cache).*\n> ${truncate(after, 400)}`
        : `**Sebelum:**\n> ${truncate(before, 400)}\n**Sesudah:**\n> ${truncate(after, 400)}`;

    const embed = logEmbed({
      category: 'message',
      title: '✏️ Pesan Diedit',
      description,
      // Tanpa executor: Discord tidak menulis entri audit log untuk edit pesan,
      // jadi kolomnya sengaja dihilangkan (bukan diisi "-").
      fields: compactFields([
        { name: 'Channel', value: `<#${newMessage.channelId}>`, inline: true },
        { name: 'Penulis', value: `<@${newMessage.author.id}> (\`${newMessage.author.tag}\`)`, inline: true },
        { name: 'Lompat', value: `[Buka pesan](${newMessage.url})`, inline: true },
      ]),
    });

    await dispatchLog(newMessage.guild, 'message', embed);
  },
} satisfies BotEvent<'messageUpdate'>;
