import {
  MessageFlags,
  SlashCommandBuilder,
  type Collection,
  type Message,
  type MessageResolvable,
  type PartialMessage,
  type Snowflake,
} from 'discord.js';
import { MAX_PURGE_COUNT, purgeLogEmbed, sendGuildEmbed } from '../../modules/moderation/index.js';
import { errorEmbed, successEmbed, warningEmbed } from '../../utils/embeds.js';
import type { BotCommand } from '../../types/command.js';
import { ADMIN_PERMISSIONS, gateAdminCommand, handleAdminFailure, replyEphemeralError } from './_shared.js';

export default {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Hapus sejumlah pesan di channel ini (maks 100)')
    .setDefaultMemberPermissions(ADMIN_PERMISSIONS.purge.bit)
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('Jumlah pesan terakhir yang diperiksa (1–100)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(MAX_PURGE_COUNT),
    )
    .addUserOption((option) =>
      option.setName('user').setDescription('Hanya hapus pesan dari user ini'),
    )
    .addStringOption((option) =>
      option
        .setName('contains')
        .setDescription('Hanya hapus pesan yang mengandung teks ini')
        .setMaxLength(100),
    ),
  category: 'admin',
  guildOnly: true,
  cooldownSeconds: 5,
  async execute(interaction, _client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const gate = await gateAdminCommand(interaction, ADMIN_PERMISSIONS.purge);
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }
      const { ctx } = gate;

      const channel = interaction.channel;
      // `'bulkDelete' in channel` membuang DM/partial channel dari union sehingga
      // TS yakin bulkDelete memang tersedia.
      if (!channel || !channel.isTextBased() || channel.isDMBased() || !('bulkDelete' in channel)) {
        await replyEphemeralError(
          interaction,
          errorEmbed('Perintah ini hanya bisa dipakai di channel teks dalam server.'),
        );
        return;
      }

      const amount = interaction.options.getInteger('amount', true);
      const filterUser = interaction.options.getUser('user');
      const contains = interaction.options.getString('contains');

      const fetched = await channel.messages.fetch({ limit: amount });
      let selected = [...fetched.values()];

      if (filterUser) selected = selected.filter((message) => message.author.id === filterUser.id);
      if (contains) {
        const needle = contains.toLowerCase();
        selected = selected.filter((message) => message.content.toLowerCase().includes(needle));
      }

      if (selected.length === 0) {
        await interaction.editReply({
          embeds: [warningEmbed('Tidak ada pesan yang cocok dengan filter itu dalam rentang yang diperiksa.')],
        });
        return;
      }

      const deletedCount = await deleteMessages(channel, selected);

      const filters: string[] = [];
      if (filterUser) filters.push(`Penulis: <@${filterUser.id}>`);
      if (contains) filters.push(`Mengandung: \`${contains}\``);

      const logged = await sendGuildEmbed(
        ctx.guild,
        ctx.config.logChannelId,
        purgeLogEmbed({
          moderatorId: interaction.user.id,
          channelId: channel.id,
          deleted: deletedCount,
          filters,
        }),
      );

      const lines = [`🧹 **${deletedCount}** pesan dihapus dari <#${channel.id}>.`];
      if (deletedCount < selected.length) {
        lines.push(
          `ℹ️ **${selected.length - deletedCount}** pesan tidak bisa dihapus (lebih tua dari 14 hari atau dipinned).`,
        );
      }
      if (!logged) {
        lines.push('⚠️ Channel log belum diatur atau tidak bisa dikirim, jadi log tidak tersimpan.');
      }

      await interaction.editReply({ embeds: [successEmbed(lines.join('\n'), '🧹 Purge Selesai')] });
    } catch (error) {
      await handleAdminFailure(interaction, error, 'purge');
    }
  },
} satisfies BotCommand;

/**
 * Hapus pesan lewat bulk delete.
 * `filterOld = true` membuat pesan >14 hari dilewati otomatis (batas Discord);
 * bulk delete juga butuh minimal dua pesan, jadi satu pesan dihapus manual.
 */
interface BulkDeletableChannel {
  bulkDelete: (
    messages: readonly MessageResolvable[],
    filterOld?: boolean,
  ) => Promise<Collection<Snowflake, Message | PartialMessage | undefined>>;
}

async function deleteMessages(channel: BulkDeletableChannel, messages: Message[]): Promise<number> {
  const first = messages[0];
  if (!first) return 0;

  if (messages.length === 1) {
    await first.delete();
    return 1;
  }

  const deleted = await channel.bulkDelete(messages, true);
  return deleted.size;
}
