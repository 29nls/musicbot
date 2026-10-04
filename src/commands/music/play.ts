import { SlashCommandBuilder } from 'discord.js';
import { canControlMusic } from '../../modules/music/index.js';
import type { Translator } from '../../modules/i18n/index.js';
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
        const embed = renderSpotifyResult(spotify, gate.ctx.t);
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

          await interaction.editReply({ embeds: [renderPlayOutcome(outcome, gate.ctx.t)] });
          return;
        }
      }

      const outcome = await gate.ctx.music.play({
        ...shared,
        query,
        requesterId: interaction.user.id,
      });

      await interaction.editReply({ embeds: [renderPlayOutcome(outcome, gate.ctx.t)] });
    } catch (error) {
      await handleMusicFailure(interaction, error, 'play');
    }
  },
} satisfies BotCommand;

/** Ringkasan untuk embed /play, atau null kalau hasilnya harus diputar. */
function renderSpotifyResult(
  result: Awaited<ReturnType<typeof resolveSpotifyPlay>>,
  t: Translator,
) {
  if (result.kind === 'resolved') return null;

  if (result.kind === 'unsupported') {
    return errorEmbed(result.message, t('music.play.spotifyUnsupported'));
  }
  if (result.kind === 'not-configured') {
    return warningEmbed(
      t('music.play.spotifyNotConfigured'),
      t('music.play.spotifyNotConfiguredTitle'),
    );
  }
  if (result.kind === 'not-found') {
    return infoEmbed(t('music.play.spotifyNotFound'), result.message);
  }
  if (result.kind === 'search-failed') {
    return errorEmbed(t('music.play.spotifySearchFailed', { message: result.message }), t('embed.title.error'));
  }
  if (result.kind === 'no-match') {
    return errorEmbed(
      t('music.play.spotifyNoMatch', { title: result.meta.title, tried: result.tried }),
      `🎵 ${t('music.play.spotifyNoMatchTitle')}`,
    );
  }

  return errorEmbed(result.message, t('music.play.spotifyFailed'));
}