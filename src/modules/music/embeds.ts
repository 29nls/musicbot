import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../../config/constants.js';
import { formatDuration } from '../../utils/duration.js';
import { filterModeLabel } from './filters.js';
import { loopModeLabel } from './loop.js';
import { formatSeconds } from './searchSession.js';
import { describeTrack, formatTrackDuration, progressBar } from './track.js';
import type { PlayOutcome, QueueSnapshot, TrackInfo } from './types.js';

const MAX_QUEUE_LINES = 10;

/** Batas baris hasil pencarian pada satu embed. */
const MAX_SEARCH_LINES = 5;

type AddedOutcome = Extract<PlayOutcome, { kind: 'added' }>;

/** Embed "sedang diputar" lengkap dengan progress bar dan status antrean. */
export function nowPlayingEmbed(track: TrackInfo, snapshot: QueueSnapshot): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.music)
    .setTitle(track.title)
    .setDescription(
      `${progressBar(snapshot.positionMs, track.durationMs)}\n` +
        `\`${formatDuration(snapshot.positionMs)} / ${formatTrackDuration(track)}\``,
    )
    .addFields(
      { name: 'Artis', value: track.author || '—', inline: true },
      { name: 'Diminta oleh', value: `<@${track.requesterId}>`, inline: true },
      { name: 'Volume', value: `${snapshot.volume}%`, inline: true },
      { name: 'Status', value: snapshot.paused ? '⏸️ Dijeda' : '▶️ Diputar', inline: true },
      {
        name: 'Antrean',
        value:
          snapshot.upcoming.length > 0
            ? `${snapshot.upcoming.length} lagu • ${formatDuration(snapshot.upcomingDurationMs)}`
            : 'kosong',
        inline: true,
      },
      { name: 'Diputar sejak', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
      { name: 'Loop', value: loopModeLabel(snapshot.loopMode), inline: true },
      { name: 'Filter', value: filterModeLabel(snapshot.filterMode), inline: true },
    )
    .setTimestamp();

  if (track.uri) embed.setURL(track.uri);
  if (track.artworkUrl) embed.setThumbnail(track.artworkUrl);

  if (snapshot.idleRemainingMs !== null) {
    embed.setFooter({ text: `Keluar otomatis dalam ${formatDuration(snapshot.idleRemainingMs)}` });
  } else if (snapshot.loopMode !== 'off') {
    // Loop yang aktif diberi catatan sendiri: kalau bot nanti keluar otomatis,
    // footer "keluar otomatis" akan hilang, jadi mode loop tidak boleh hanya
    // muncul di situ.
    embed.setFooter({ text: `Loop: ${loopModeLabel(snapshot.loopMode)}` });
  }

  return embed;
}

/** Daftar antrean (maksimal 10 baris supaya tetap terbaca di ponsel). */
export function queueEmbed(snapshot: QueueSnapshot): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(EMBED_COLORS.music).setTitle('🎶 Antrean Musik').setTimestamp();

  if (snapshot.current) {
    embed.addFields({
      name: 'Sedang diputar',
      value: `${describeTrack(snapshot.current, 80)}\n\`${formatDuration(snapshot.positionMs)} / ${formatTrackDuration(snapshot.current)}\``,
    });
  }

  const upcoming = snapshot.upcoming.slice(0, MAX_QUEUE_LINES);

  if (upcoming.length > 0) {
    embed.addFields({
      name: `Berikutnya — ${upcoming.length} lagu • ${formatDuration(snapshot.upcomingDurationMs)}`,
      value: upcoming
        .map((track, index) => `\`${index + 1}.\` ${describeTrack(track)} \`${formatTrackDuration(track)}\``)
        .join('\n'),
    });
  } else {
    embed.addFields({ name: 'Berikutnya', value: '*antrean kosong*' });
  }

  if (snapshot.upcoming.length > MAX_QUEUE_LINES) {
    embed.setFooter({
      text: `+${snapshot.upcoming.length - MAX_QUEUE_LINES} lagu lain tidak ditampilkan`,
    });
  }

  return embed;
}

/** Embed hasil `/play` yang berhasil menambahkan lagu. */
export function addedToQueueEmbed(outcome: AddedOutcome): EmbedBuilder {
  const [first] = outcome.tracks;
  const embed = new EmbedBuilder().setColor(EMBED_COLORS.music).setTimestamp();

  if (!first) {
    return embed.setTitle('🎶 Antrean diperbarui');
  }

  embed.setTitle(outcome.playlistName ? `📃 Playlist: ${outcome.playlistName}` : first.title);

  const lines = [
    outcome.started
      ? '▶️ Mulai diputar sekarang.'
      : `➕ Ditambahkan ke antrean (posisi **#${outcome.position}**).`,
    `🎵 ${describeTrack(first, 80)}`,
  ];

  if (outcome.tracks.length > 1) {
    lines.push(`…dan **${outcome.tracks.length - 1}** lagu lain.`);
  }
  if (outcome.skipped > 0) {
    lines.push(`⚠️ **${outcome.skipped}** lagu tidak ditambahkan karena antrean penuh.`);
  }

  embed.setDescription(lines.join('\n'));

  if (first.uri) embed.setURL(first.uri);
  if (first.artworkUrl && outcome.tracks.length === 1) embed.setThumbnail(first.artworkUrl);

  return embed;
}

/**
 * Embed hasil `/search`.
 *
 * Daftar di sini sengaja sama dengan isi select menu, jadi user yang memilih
 * lewat voiceover atau reader layar tetap tahu persis apa yang bisa dipilih.
 */
export function searchResultsEmbed(input: {
  query: string;
  tracks: readonly TrackInfo[];
}): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.music)
    .setTitle('🔍 Hasil pencarian')
    .setTimestamp();

  const query = input.query.trim();
  embed.setDescription(
    query
      ? `Hasil untuk \`${query}\` — pilih satu dari menu di bawah.`
      : 'Pilih satu dari menu di bawah.',
  );

  const shown = input.tracks.slice(0, MAX_SEARCH_LINES);

  if (shown.length > 0) {
    embed.addFields({
      name: `${shown.length} hasil teratas`,
      value: shown
        .map((track, index) => `\`${index + 1}.\` ${describeTrack(track, 76)} \`${formatSeconds(track.durationMs)}\``)
        .join('\n'),
    });
  }

  embed.setFooter({ text: 'Menu berlaku 15 menit. Pilih satu untuk langsung diputar.' });

  const [first] = shown;
  if (first?.artworkUrl) embed.setThumbnail(first.artworkUrl);

  return embed;
}