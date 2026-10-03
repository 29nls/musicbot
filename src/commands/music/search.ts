import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import {
  getSearchSessionStore,
  searchResultsEmbed,
  searchSelectRow,
  toTrackInfo,
} from '../../modules/music/index.js';
import type { BotCommand } from '../../types/command.js';
import { infoEmbed } from '../../utils/embeds.js';
import { gateMusicCommand, handleMusicFailure, replyEphemeralError } from './_shared.js';

/** Batas kata kunci yang diterima; cukup panjang untuk pencarian biasa. */
const MAX_QUERY_LENGTH = 200;

export default {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Cari lagu dan pilih dari daftar hasil')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('Kata kunci atau URL (YouTube/SoundCloud)')
        .setRequired(true)
        .setMaxLength(MAX_QUERY_LENGTH),
    ),
  category: 'music',
  guildOnly: true,
  cooldownSeconds: 5,
  async execute(interaction, _client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const gate = await gateMusicCommand(interaction, { voice: true });
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }

      const { music, guildId } = gate.ctx;
      const query = interaction.options.getString('query', true).trim();

      const found = await music.resolve(query);

      if (found.kind === 'unavailable') {
        await interaction.editReply({
          embeds: [
            infoEmbed(
              'Lavalink belum terhubung',
              'Cari lagu tidak bisa jalan sebelum node Lavalink aktif. Cek `docker compose logs lavalink`.',
            ),
          ],
        });
        return;
      }

      if (found.kind === 'error') {
        await interaction.editReply({
          embeds: [infoEmbed('Pencarian gagal', `Lavalink menjawab: ${found.message}`)],
        });
        return;
      }

      if (found.kind === 'empty' || found.tracks.length === 0) {
        await interaction.editReply({
          embeds: [
            infoEmbed(
              'Tidak ada hasil',
              `Tidak menemukan apa pun untuk \`${query}\`. Coba kata kunci lain atau kirim URL.`,
            ),
          ],
        });
        return;
      }

      const tracks = found.tracks.map((track) => toTrackInfo(track, interaction.user.id));

      // Session disimpan supaya select menu di pesan ephemeral ini masih bisa
      // dibaca di interaksi berikutnya, termasuk kalau select menu-nya sampai
      // ke shard lain (§5.3).
      const session = await getSearchSessionStore().put({
        guildId,
        requesterId: interaction.user.id,
        query,
        tracks,
      });

      if (!session) {
        await interaction.editReply({
          embeds: [
            infoEmbed(
              'Pencarian gagal',
              'Hasil pencarian tidak bisa disimpan sebentar, jadi menunya tidak bisa dibuat. Coba lagi beberapa saat lagi.',
            ),
          ],
        });
        return;
      }

      await interaction.editReply({
        embeds: [searchResultsEmbed({ query, tracks })],
        components: [searchSelectRow(session)],
      });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'search');
    }
  },
} satisfies BotCommand;