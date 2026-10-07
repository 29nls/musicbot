import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import {
  getSearchSessionStore,
  pickTracks,
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

      const { music, guildId, t } = gate.ctx;
      const query = interaction.options.getString('query', true).trim();

      const found = await music.resolve(query);

      if (found.kind === 'unavailable') {
        await interaction.editReply({
          embeds: [
            infoEmbed(t('music.search.unavailableTitle'), t('music.search.unavailableBody')),
          ],
        });
        return;
      }

      if (found.kind === 'error') {
        await interaction.editReply({
          embeds: [
            infoEmbed(
              t('music.search.failedTitle'),
              t('music.search.failedBody', { message: found.message }),
            ),
          ],
        });
        return;
      }

      // Berapa hasil yang ditawarkan diatur satu tempat (`selection.ts`),
      // sehingga select menu dan daftar di embed tidak mungkin berbeda jumlah.
      // "Tidak ada hasil" di sini berarti `pickTracks` tidak memilih apa pun —
      // bukan pembacaan kedua atas hasil pencariannya.
      const tracks = pickTracks(found, 'choices', query).map((track) =>
        toTrackInfo(track, interaction.user.id),
      );

      if (tracks.length === 0) {
        await interaction.editReply({
          embeds: [
            infoEmbed(
              t('music.search.noResultsTitle'),
              t('music.search.noResults', { query }),
            ),
          ],
        });
        return;
      }

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
            infoEmbed(t('music.search.failedTitle'), t('music.search.sessionFailed')),
          ],
        });
        return;
      }

      await interaction.editReply({
        embeds: [searchResultsEmbed({ query, tracks }, t)],
        components: [searchSelectRow(session, t)],
      });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'search');
    }
  },
} satisfies BotCommand;