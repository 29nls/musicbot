import { SlashCommandBuilder } from 'discord.js';
import { getLyricsService, lyricsEmbed } from '../../modules/lyrics/index.js';
import type { LyricsQuery, LyricsResult } from '../../modules/lyrics/index.js';
import type { BotCommand } from '../../types/command.js';
import { errorEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { gateMusicCommand, handleMusicFailure, replyEphemeralError } from './_shared.js';

interface ResolvedRequest {
  query: LyricsQuery;
  positionMs: number | null;
  uri: string | null;
  artworkUrl: string | null;
}

export default {
  data: new SlashCommandBuilder()
    .setName('lyrics')
    .setDescription('Tampilkan lirik lagu yang sedang diputar, atau cari lewat judul')
    .addStringOption((option) =>
      option
        .setName('judul')
        .setDescription('Judul lagu — kosongkan untuk lirik lagu yang sedang diputar')
        .setMaxLength(120),
    ),
  category: 'music',
  guildOnly: true,
  // Panggil API luar, jadi diberi jeda lebih lama dari perintah baca biasa.
  cooldownSeconds: 5,
  async execute(interaction, _client) {
    await interaction.deferReply();

    try {
      const requested = interaction.options.getString('judul')?.trim();

      let request: ResolvedRequest;

      if (requested) {
        // Pencarian manual tidak butuh musik aktif: user boleh minta lirik
        // lagu apa pun dari kanal teks.
        request = {
          query: { title: requested, artist: '', durationMs: 0 },
          positionMs: null,
          uri: null,
          artworkUrl: null,
        };
      } else {
        const gate = await gateMusicCommand(interaction, { playing: true });
        if (!gate.ok) {
          await replyEphemeralError(interaction, gate.embed);
          return;
        }

        const snapshot = await gate.ctx.music.snapshot(gate.ctx.guildId);
        const current = snapshot.current;

        if (!current) {
          await interaction.editReply({
            embeds: [errorEmbed('Tidak ada lagu yang sedang diputar. Tambahkan dulu dengan `/play`.')],
          });
          return;
        }

        request = {
          query: {
            title: current.title,
            artist: current.author,
            durationMs: current.durationMs,
          },
          positionMs: snapshot.positionMs,
          uri: current.uri,
          artworkUrl: current.artworkUrl,
        };
      }

      const result: LyricsResult = await getLyricsService().lookup(request.query);

      if (result.kind === 'not-found') {
        await interaction.editReply({
          embeds: [infoEmbed('🎤 Lirik tidak ditemukan', result.message)],
        });
        return;
      }

      if (result.kind === 'error') {
        await interaction.editReply({
          embeds: [warningEmbed(result.message, '⚠️ Sumber Lirik Bermasalah')],
        });
        return;
      }

      await interaction.editReply({
        embeds: [
          lyricsEmbed({
            document: result.document,
            positionMs: request.positionMs,
            uri: request.uri,
            artworkUrl: request.artworkUrl,
          }),
        ],
      });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'lyrics');
    }
  },
} satisfies BotCommand;