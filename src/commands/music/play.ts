import { SlashCommandBuilder } from 'discord.js';
import { canControlMusic } from '../../modules/music/index.js';
import { getSpotifyService, resolveSpotifyPlay, toPlayInfo } from '../../modules/spotify/index.js';
import type { BotCommand } from '../../types/command.js';
import { errorEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { gateMusicCommand, handleMusicFailure, renderPlayOutcome, replyEphemeralError } from './_shared.js';

export default {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Putar lagu atau tambahkan ke antrean')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('Judul lagu, kata kunci, URL (YouTube/SoundCloud), atau tautan Spotify')
        .setRequired(true),
    ),
  category: 'music',
  guildOnly: true,
  // PRD §6.2: "User spam /play (> 5/menit) → Cooldown 10 detik dengan pesan sisa waktu".
  cooldownSeconds: 10,
  async execute(interaction, _client) {
    await interaction.deferReply();

    try {
      const gate = await gateMusicCommand(interaction, { voice: true });
      if (!gate.ok) {
        await replyEphemeralError(interaction, gate.embed);
        return;
      }

      const query = interaction.options.getString('query', true);
      const canControl = canControlMusic({
        djRoleId: gate.ctx.config.djRoleId,
        memberRoleIds: gate.ctx.memberRoleIds,
        canManageGuild: gate.ctx.canManageGuild,
      });

      const shared = {
        guildId: gate.ctx.guildId,
        voiceChannelId: gate.ctx.voiceChannelId,
        shardId: gate.ctx.guild.shardId,
        canControl,
      };

      // Tautan Spotify tidak bisa langsung diselesaikan Lavalink (butuh plugin
      // berbayar), jadi metadata diambil dulu lalu audio dicari ulang dengan
      // judul resmi. Query biasa tetap lewat jalur yang selalu bekerja.
      const spotify = await resolveSpotifyPlay(query, {
        meta: (id) => getSpotifyService().getTrack(id),
        search: (searchQuery) => gate.ctx.music.resolve(searchQuery),
        requesterId: interaction.user.id,
      });

      if (spotify.kind !== 'unsupported') {
        const embed = renderSpotifyResult(spotify);
        if (embed) {
          await interaction.editReply({ embeds: [embed] });
          return;
        }

        if (spotify.kind === 'resolved') {
          const outcome = await gate.ctx.music.enqueue({
            ...shared,
            tracks: [spotify.track],
            spotify: toPlayInfo(spotify.meta, spotify.match),
          });

          await interaction.editReply({ embeds: [renderPlayOutcome(outcome)] });
          return;
        }
      }

      const outcome = await gate.ctx.music.play({
        ...shared,
        query,
        requesterId: interaction.user.id,
      });

      await interaction.editReply({ embeds: [renderPlayOutcome(outcome)] });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'play');
    }
  },
} satisfies BotCommand;

/** Ringkasan untuk embed /play, atau null kalau hasilnya harus diputar. */
function renderSpotifyResult(result: Awaited<ReturnType<typeof resolveSpotifyPlay>>) {
  if (result.kind === 'resolved') return null;

  if (result.kind === 'unsupported') {
    return errorEmbed(result.message, 'Tautan Spotify Tidak Bisa Dipakai');
  }
  if (result.kind === 'not-configured') {
    return warningEmbed(
      'Metadata Spotify belum aktif karena `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` belum diisi di .env.',
      'Spotify Belum Dikonfigurasi',
    );
  }
  if (result.kind === 'not-found') {
    return infoEmbed('Lagu tidak ditemukan di Spotify', result.message);
  }
  if (result.kind === 'search-failed') {
    return errorEmbed(`Tidak bisa mencari audio untuk lagu itu: ${result.message}`);
  }
  if (result.kind === 'no-match') {
    return errorEmbed(
      `Tidak ada hasil pencarian yang cocok dengan **${result.meta.title}** di Spotify.\n\n` +
        `${result.tried} kandidat diperiksa dan semuanya berbeda judul atau durasinya. ` +
        'Coba cari lagunya dengan kata kunci biasa.',
      '🎵 Audio Tidak Cocok',
    );
  }

  return errorEmbed(result.message, 'Gagal Meminta Metadata Spotify');
}