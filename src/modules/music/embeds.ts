import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../../config/constants.js';
import { defaultTranslator, type Translator } from '../i18n/index.js';
import { formatDuration } from '../../utils/duration.js';
import { filterModeLabel } from './filters.js';
import { trackLimitReason } from './limits.js';
import { buildQueuePage, type QueuePage } from './queuePage.js';
import { loopModeLabel } from './loop.js';
import { formatSeconds } from './searchSession.js';
import { describeTrack, formatTrackDuration, progressBar } from './track.js';
import type { PlayOutcome, QueueSnapshot, TrackInfo } from './types.js';

/** Batas baris hasil pencarian pada satu embed. */
const MAX_SEARCH_LINES = 5;

type AddedOutcome = Extract<PlayOutcome, { kind: 'added' }>;

/**
 * Embed "sedang diputar" lengkap dengan progress bar dan status antrean.
 *
 * Setiap renderer di berkas ini menerima `t` opsional. Nilai bakanya bahasa
 * Indonesia supaya pemanggil yang belum menerjemahkan (tes lama, handler yang
 * belum disentuh) tetap menghasilkan teks yang sama persis seperti sebelumnya.
 * Begitu satu pemanggil meneruskan penerjemah, seluruh isi embed ikut berbahasa
 * — termasuk nama field dan judul, bukan cuma deskripsi.
 */
export function nowPlayingEmbed(
  track: TrackInfo,
  snapshot: QueueSnapshot,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.music)
    .setTitle(track.title)
    .setDescription(
      `${progressBar(snapshot.positionMs, track.durationMs)}\n` +
        `\`${formatDuration(snapshot.positionMs)} / ${formatTrackDuration(track)}\``,
    )
    .addFields(
      { name: t('music.field.artist'), value: track.author || '—', inline: true },
      { name: t('music.field.requestedBy'), value: `<@${track.requesterId}>`, inline: true },
      { name: t('music.field.volume'), value: `${snapshot.volume}%`, inline: true },
      {
        name: t('music.field.status'),
        value: snapshot.paused ? t('music.value.paused') : t('music.value.playing'),
        inline: true,
      },
      {
        name: t('music.field.queue'),
        value:
          snapshot.upcoming.length > 0
            ? t('music.queueTracks', {
                count: snapshot.upcoming.length,
                duration: formatDuration(snapshot.upcomingDurationMs),
              })
            : t('music.value.emptyQueue'),
        inline: true,
      },
      { name: t('music.field.playingSince'), value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
      { name: t('music.field.loop'), value: loopModeLabel(snapshot.loopMode, t), inline: true },
      { name: t('music.field.filter'), value: filterModeLabel(snapshot.filterMode, t), inline: true },
    )
    .setTimestamp();

  if (track.uri) embed.setURL(track.uri);
  if (track.artworkUrl) embed.setThumbnail(track.artworkUrl);

  if (snapshot.idleRemainingMs !== null) {
    embed.setFooter({
      text: t('music.nowPlaying.idleFooter', {
        duration: formatDuration(snapshot.idleRemainingMs),
      }),
    });
  } else if (snapshot.loopMode !== 'off') {
    // Loop yang aktif diberi catatan sendiri: kalau bot nanti keluar otomatis,
    // footer "keluar otomatis" akan hilang, jadi mode loop tidak boleh hanya
    // muncul di situ.
    embed.setFooter({
      text: t('music.nowPlaying.loopFooter', { mode: loopModeLabel(snapshot.loopMode, t) }),
    });
  }

  return embed;
}

/** Daftar antrean, satu halaman 10 lagu (AC §8 US-02). */
export function queueEmbed(
  snapshot: QueueSnapshot,
  page?: QueuePage<TrackInfo>,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.music)
    .setTitle(t('music.nowPlaying.title'))
    .setTimestamp();

  if (snapshot.current) {
    embed.addFields({
      name: t('music.field.nowPlaying'),
      value: `${describeTrack(snapshot.current, 80)}\n\`${formatDuration(snapshot.positionMs)} / ${formatTrackDuration(snapshot.current)}\``,
    });
  }

  // Tanpa halaman eksplisit, embed tetap memakai potongan pertama seperti
  // sebelumnya, supaya pemanggil lain tidak ikut berubah perilakunya.
  const current: QueuePage<TrackInfo> = page ?? buildQueuePage(snapshot.upcoming, 1);
  const upcoming = current.items;
  const offset = current.startIndex;
  const pageDurationMs = upcoming.reduce((total, track) => total + track.durationMs, 0);
  const paged = current.totalPages > 1;

  if (upcoming.length > 0) {
    const tracks = t('music.queueTracks', {
      count: upcoming.length,
      duration: formatDuration(paged ? pageDurationMs : snapshot.upcomingDurationMs),
    });
    // Nomor halaman ikut di judul field: pesan ini bisa berumur belasan menit
    // dan tombolnya masih bisa diklik, jadi "halaman 3" jauh lebih berguna
    // daripada "Berikutnya" yang tidak menjelaskan posisi orang sekarang.
    const title = paged
      ? t('music.queue.upNextPaged', {
          page: current.page,
          total: current.totalPages,
          tracks,
        })
      : t('music.queue.upNext', { tracks });

    embed.addFields({
      name: title,
      // Nomor dihitung dari posisi di antrean utuh: di halaman 3, baris
      // pertama tetap "21." supaya `/remove 21` menunjuk lagu yang sama.
      value: upcoming
        .map(
          (track, index) =>
            `\`${offset + index + 1}.\` ${describeTrack(track)} \`${formatTrackDuration(track)}\``,
        )
        .join('\n'),
    });
  } else {
    embed.addFields({ name: t('music.field.upNext'), value: t('music.value.emptyQueueItalic') });
  }

  if (paged) {
    embed.setFooter({ text: t('music.queue.hiddenPaged', { count: current.hiddenCount }) });
  } else if (current.hiddenCount > 0) {
    embed.setFooter({ text: t('music.queue.hidden', { count: current.hiddenCount }) });
  }

  return embed;
}

/** Embed hasil `/play` yang berhasil menambahkan lagu. */
export function addedToQueueEmbed(
  outcome: AddedOutcome,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const [first] = outcome.tracks;
  const embed = new EmbedBuilder().setColor(EMBED_COLORS.music).setTimestamp();

  if (!first) {
    return embed.setTitle(t('music.nowPlaying.updated'));
  }

  embed.setTitle(
    outcome.playlistName
      ? t('music.play.playlistTitle', { name: outcome.playlistName })
      : first.title,
  );

  const lines = [
    outcome.started ? t('music.play.started') : t('music.play.queued', { position: outcome.position }),
    `🎵 ${describeTrack(first, 80)}`,
  ];

  if (outcome.tracks.length > 1) {
    lines.push(t('music.play.moreTracks', { count: outcome.tracks.length - 1 }));
  }
  if (outcome.skipped > 0) {
    lines.push(t('music.play.queueFull', { count: outcome.skipped }));
  }

  const rejectedTooLong = outcome.rejectedTooLong ?? 0;
  const rejectedNeedsControl = outcome.rejectedNeedsControl ?? 0;

  if (rejectedTooLong > 0) {
    lines.push(
      t('music.play.rejected', {
        count: rejectedTooLong,
        reason: trackLimitReason('too-long', {}, t),
      }),
    );
  }
  if (rejectedNeedsControl > 0) {
    lines.push(
      `${t('music.play.rejected', {
        count: rejectedNeedsControl,
        reason: trackLimitReason('needs-control', {}, t),
      })} ${t('music.play.rejectedExtra')}`,
    );
  }

  embed.setDescription(lines.join('\n'));

  if (first.uri) embed.setURL(first.uri);
  if (first.artworkUrl && outcome.tracks.length === 1) embed.setThumbnail(first.artworkUrl);

  // Metadata Spotify: cover & judul asli lebih trustworthy daripada sampul
  // milik sumber audio, jadi keduanya ditampilkan berdampingan.
  if (outcome.spotify) {
    const spotify = outcome.spotify;
    const artists = spotify.artists.join(', ') || '—';

    embed.addFields({
      name: t('music.field.fromSpotify'),
      value: [
        `**[${spotify.title}](${spotify.url})**`,
        `${artists}${spotify.album ? ` • ${spotify.album}` : ''}`,
        spotify.sourceUri
          ? t('music.play.audioLineLinked', { title: spotify.sourceTitle, uri: spotify.sourceUri })
          : t('music.play.audioLine', { title: spotify.sourceTitle }),
        spotify.matchNote,
      ].join('\n'),
    });

    if (spotify.imageUrl && outcome.tracks.length === 1) embed.setThumbnail(spotify.imageUrl);
  }

  return embed;
}

/**
 * Embed hasil `/search`.
 *
 * Daftar di sini sengaja sama dengan isi select menu, jadi user yang memilih
 * lewat voiceover atau reader layar tetap tahu persis apa yang bisa dipilih.
 */
export function searchResultsEmbed(
  input: {
    query: string;
    tracks: readonly TrackInfo[];
  },
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.music)
    .setTitle(t('music.search.title'))
    .setTimestamp();

  const query = input.query.trim();
  embed.setDescription(
    query ? t('music.search.forQuery', { query }) : t('music.search.pickOne'),
  );

  const shown = input.tracks.slice(0, MAX_SEARCH_LINES);

  if (shown.length > 0) {
    embed.addFields({
      name: t('music.search.topResults', { count: shown.length }),
      value: shown
        .map(
          (track, index) =>
            `\`${index + 1}.\` ${describeTrack(track, 76)} \`${formatSeconds(track.durationMs)}\``,
        )
        .join('\n'),
    });
  }

  embed.setFooter({ text: t('music.search.footer') });

  const [first] = shown;
  if (first?.artworkUrl) embed.setThumbnail(first.artworkUrl);

  return embed;
}
