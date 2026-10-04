import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../../config/constants.js';
import { defaultTranslator, type Translator } from '../i18n/index.js';
import { formatSeconds } from '../music/searchSession.js';
import { PLAYLIST_TRACK_PREVIEW, type Playlist, type StoredTrack } from './types.js';

/** Awalan pseudonim anonymisasi (lihat modul privasi). */
const ANONYM_PREFIX = 'anon:';

/** "1. Judul — Artis (3:45)" untuk daftar isi playlist. */
export function storedTrackLine(track: StoredTrack, index: number): string {
  const label = track.author ? `**${track.title}** — ${track.author}` : `**${track.title}**`;

  return `\`${index + 1}.\` ${label} \`${formatSeconds(track.durationMs)}\``;
}

/**
 * Ringkasan isi playlist untuk baris daftar: jumlah lagu dan total durasi.
 *
 * Total durasi hanya dijumlahkan dari lagu yang durasinya diketahui; live dihitung
 * terpisah karena durasinya memang tidak pernah diketahui. Menjumlahkannya sebagai
 * 0 detik dan menulis "0:00" untuk playlist yang seluruhnya live adalah angka yang
 * terlihat salah, bukan pembulatan.
 */
export function playlistSummary(
  playlist: Playlist,
  t: Translator = defaultTranslator,
): string {
  const count = playlist.tracks.length;
  if (count === 0) return t('playlist.summaryEmpty');

  const timed = playlist.tracks.filter((track) => track.durationMs > 0);
  const liveCount = count - timed.length;
  const totalMs = timed.reduce((sum, track) => sum + track.durationMs, 0);

  // Bahasa Inggris butuh bentuk tunggal dan jamak, jadi kuncinya berpasangan.
  const trackCount = t(count === 1 ? 'playlist.summaryTrack' : 'playlist.summaryTracks', {
    count,
  });
  const parts = [trackCount, formatSeconds(totalMs)];
  if (liveCount > 0) parts.push(t('playlist.summaryLive', { count: liveCount }));

  return parts.join(' • ');
}

/** Daftar playlist milik member (dan yang ia bagikan ke server ini). */
export function playlistListEmbed(
  input: {
    playlists: readonly Playlist[];
    userId: string;
  },
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.music)
    .setTitle(t('playlist.listTitle'))
    .setTimestamp();

  if (input.playlists.length === 0) {
    embed.setDescription(t('playlist.listEmpty'));
    return embed;
  }

  const mine = input.playlists.filter((playlist) => playlist.ownerId === input.userId);
  const shared = input.playlists.filter((playlist) => playlist.ownerId !== input.userId);

  if (mine.length > 0) {
    embed.addFields({
      name: t('playlist.listMine', { count: mine.length }),
      value: mine
        .map((playlist) => `**${playlist.name}** — ${playlistSummary(playlist, t)}`)
        .join('\n'),
    });
  }

  if (shared.length > 0) {
    embed.addFields({
      name: t('playlist.listShared', { count: shared.length }),
      value: shared
        .map(
          (playlist) =>
            `**${playlist.name}** — <@${playlist.ownerId}> · ${playlistSummary(playlist, t)}`,
        )
        .join('\n'),
    });
  }

  embed.setFooter({ text: t('playlist.listFooter') });

  return embed;
}

/** Isi satu playlist, dengan cuplikan lagu dan catatan kalau dipangkas. */
export function playlistDetailEmbed(
  playlist: Playlist,
  t: Translator = defaultTranslator,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.music)
    .setTitle(`🎼 ${playlist.name}`)
    .setTimestamp()
    .addFields(
      { name: t('playlist.fieldContents'), value: playlistSummary(playlist, t), inline: true },
      { name: t('playlist.fieldCreator'), value: ownerLabel(playlist.ownerId, t), inline: true },
      {
        name: t('playlist.fieldVisibility'),
        value: playlist.isPublic ? t('playlist.visibilityPublic') : t('playlist.visibilityPrivate'),
        inline: true,
      },
    );

  if (playlist.tracks.length === 0) {
    embed.setDescription(t('playlist.detailEmpty'));
    return embed;
  }

  const shown = playlist.tracks.slice(0, PLAYLIST_TRACK_PREVIEW);
  embed.setDescription(shown.map(storedTrackLine).join('\n'));

  if (playlist.tracks.length > shown.length) {
    embed.setFooter({
      text: t('playlist.detailMoreTracks', { count: playlist.tracks.length - shown.length }),
    });
  }

  return embed;
}

/**
 * Pemilik playlist untuk ditampilkan.
 *
 * Playlist yang sudah dianonimkan lewat `/data-delete` tidak boleh menampilkan
 * mention ke user ID asli — mention itu akan lebih dulu memberitahu member yang
 * meminta penghapusan bahwa datanya masih ada.
 */
function ownerLabel(ownerId: string, t: Translator): string {
  if (ownerId.startsWith(ANONYM_PREFIX)) return t('playlist.ownerAnonymized');

  return `<@${ownerId}>`;
}