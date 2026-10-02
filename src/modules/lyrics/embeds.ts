import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../../config/constants.js';
import { formatTimecode, selectLyricWindow } from './lrc.js';
import type { LyricsDocument, LyricsSource } from './types.js';

/** Batas aman isi field Discord (1024 karakter) dikurangi sedikit. */
export const LYRICS_FIELD_LIMIT = 1_000;

/** Batas aman isi description Discord (4096 karakter) dikurangi sedikit. */
export const LYRICS_DESCRIPTION_LIMIT = 2_000;

/** Berapa baris lirik polos yang ditampilkan sebelum dipotong. */
export const LYRICS_PLAIN_LINES = 20;

/** Berapa baris sebelum/sesudah baris aktif yang ikut ditampilkan. */
export const LYRICS_CONTEXT_BEFORE = 3;
export const LYRICS_CONTEXT_AFTER = 4;

const SOURCE_LABEL: Record<LyricsSource, string> = {
  'lrclib-synced': 'Lirik sinkron dari LRCLIB — baris aktif ditandai `▶`.',
  'lrclib-plain': 'Lirik teks polos dari LRCLIB.',
  genius: 'Lirik dari Genius (tanpa timing).',
};

/**
 * Embed lirik.
 *
 * Kalau liriknya sinkron dan ada posisi pemutaran, yang ditampilkan adalah
 * beberapa baris sekitar posisi itu (baris aktif ditandai `>`) supaya user
 * tidak perlu menggulir hundreds of baris. Lirik polos ditampilkan dari atas
 * karena tidak ada patokan posisi.
 */
export function lyricsEmbed(input: {
  document: LyricsDocument;
  /** Posisi pemutaran (ms); null kalau user minta judul secara manual. */
  positionMs?: number | null;
  uri?: string | null;
  artworkUrl?: string | null;
}): EmbedBuilder {
  const { document } = input;
  const positionMs = input.positionMs ?? null;
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.music)
    .setTitle(`🎤 ${heading(document)}`)
    .setTimestamp();

  if (input.uri) embed.setURL(input.uri);
  if (input.artworkUrl) embed.setThumbnail(input.artworkUrl);

  const showSyncWindow = document.synced && positionMs !== null;

  if (showSyncWindow && positionMs !== null) {
    const window = selectLyricWindow(document.lines, positionMs, {
      before: LYRICS_CONTEXT_BEFORE,
      after: LYRICS_CONTEXT_AFTER,
    });

    const body = clip(
      window
        .map((entry) =>
          entry.active
            ? `▶ **${entry.line.text}**`
            : `\`${formatTimecode(entry.line.timeMs)}\` ${entry.line.text}`,
        )
        .join('\n'),
      LYRICS_DESCRIPTION_LIMIT,
    );

    embed.setDescription(body.text);
    embed.addFields({ name: 'Posisi sekarang', value: `\`${formatTimecode(positionMs)}\``, inline: true });
  } else {
    const body = clip(
      document.lines
        .slice(0, LYRICS_PLAIN_LINES)
        .map((line) => line.text)
        .join('\n'),
      LYRICS_DESCRIPTION_LIMIT,
    );

    embed.setDescription(body.text);
  }

  const footnotes = [SOURCE_LABEL[document.source]];
  if (document.lines.length > LYRICS_PLAIN_LINES) {
    footnotes.push(`${document.lines.length} baris, sebagian dipotong.`);
  }
  footnotes.push('Cari lagu lain dengan `/lyrics <judul>`.');

  embed.setFooter({ text: footnotes.join(' · ') });

  return embed;
}

function heading(document: LyricsDocument): string {
  const name = document.trackName.trim() || 'Lirik';
  return document.artistName.trim() ? `${name} — ${document.artistName.trim()}` : name;
}

function clip(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit - 1)}…`, truncated: true };
}