import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../../config/constants.js';
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
export function playlistSummary(playlist: Playlist): string {
  const count = playlist.tracks.length;
  if (count === 0) return 'kosong';

  const timed = playlist.tracks.filter((track) => track.durationMs > 0);
  const liveCount = count - timed.length;
  const totalMs = timed.reduce((sum, track) => sum + track.durationMs, 0);

  const parts = [`${count} lagu`, formatSeconds(totalMs)];
  if (liveCount > 0) parts.push(`${liveCount} live`);

  return parts.join(' • ');
}

/** Daftar playlist milik member (dan yang ia bagikan ke server ini). */
export function playlistListEmbed(input: {
  playlists: readonly Playlist[];
  userId: string;
}): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.music)
    .setTitle('🎼 Playlist')
    .setTimestamp();

  if (input.playlists.length === 0) {
    embed.setDescription(
      'Belum ada playlist. Buat dulu dengan `/playlist create <nama>`, ' +
        'lalu tambahkan lagunya dari `/playlist add`.',
    );
    return embed;
  }

  const mine = input.playlists.filter((playlist) => playlist.ownerId === input.userId);
  const shared = input.playlists.filter((playlist) => playlist.ownerId !== input.userId);

  if (mine.length > 0) {
    embed.addFields({
      name: `Milikmu (${mine.length})`,
      value: mine
        .map((playlist) => `**${playlist.name}** — ${playlistSummary(playlist)}`)
        .join('\n'),
    });
  }

  if (shared.length > 0) {
    embed.addFields({
      name: `Dibagikan server (${shared.length})`,
      value: shared
        .map(
          (playlist) =>
            `**${playlist.name}** — <@${playlist.ownerId}> · ${playlistSummary(playlist)}`,
        )
        .join('\n'),
    });
  }

  embed.setFooter({ text: 'Putar dengan `/playlist play <nama>`.' });

  return embed;
}

/** Isi satu playlist, dengan cuplikan lagu dan catatan kalau dipangkas. */
export function playlistDetailEmbed(playlist: Playlist): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.music)
    .setTitle(`🎼 ${playlist.name}`)
    .setTimestamp()
    .addFields(
      { name: 'Isi', value: playlistSummary(playlist), inline: true },
      { name: 'Pembuat', value: ownerLabel(playlist.ownerId), inline: true },
      {
        name: 'Visibility',
        value: playlist.isPublic ? 'Dibagikan ke server' : 'Pribadi',
        inline: true,
      },
    );

  if (playlist.tracks.length === 0) {
    embed.setDescription('Playlist ini masih kosong.');
    return embed;
  }

  const shown = playlist.tracks.slice(0, PLAYLIST_TRACK_PREVIEW);
  embed.setDescription(shown.map(storedTrackLine).join('\n'));

  if (playlist.tracks.length > shown.length) {
    embed.setFooter({
      text: `+${playlist.tracks.length - shown.length} lagu lain tidak ditampilkan`,
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
function ownerLabel(ownerId: string): string {
  if (ownerId.startsWith(ANONYM_PREFIX)) return 'Anonim';

  return `<@${ownerId}>`;
}