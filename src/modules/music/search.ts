const URL_PATTERN = /^https?:\/\//i;

/**
 * Ubah input user menjadi identifier yang dimengerti Lavalink.
 *
 * - URL (YouTube/SoundCloud/Spotify mirror) dikirim apa adanya.
 * - Kata kunci biasa dicari lewat YouTube (`ytsearch:` dari youtube-plugin).
 */
export type SearchSourceName = 'youtube' | 'soundcloud';

export function buildSearchIdentifier(
  query: string,
  source: SearchSourceName = 'youtube',
): string {
  const trimmed = query.trim();

  if (URL_PATTERN.test(trimmed)) return trimmed;

  if (source === 'soundcloud') return `scsearch:${trimmed}`;

  return `ytsearch:${trimmed}`;
}

/** Apakah user mengirim URL (bukan kata kunci)? */
export function isUrl(query: string): boolean {
  return URL_PATTERN.test(query.trim());
}
