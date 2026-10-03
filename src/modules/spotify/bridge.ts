import { toTrackInfo, type SearchOutcome, type SpotifySourceInfo, type TrackInfo } from '../music/index.js';
import { matchNote, pickSpotifyMatch, type SpotifyMatch } from './match.js';
import { parseSpotifyLink, unsupportedLinkMessage, type SpotifyLink } from './parse.js';
import type { SpotifyResult, SpotifyTrackMeta } from './types.js';

/**
 * Jembatan `/play <tautan spotify>`: metadata dari Spotify → pencarian audio di
 * Lavalink → pencocokan.
 *
 * Semua dependency disuntik, jadi alurnya bisa diuji tanpa Discord, tanpa
 * Lavalink, dan tanpa memanggil Spotify.
 */

export interface SpotifyPlayDeps {
  /** Ambil metadata track dari service Spotify. */
  meta: (id: string) => Promise<SpotifyResult>;
  /** Cari kandidat audio (biasanya `MusicService.resolve`). */
  search: (query: string) => Promise<SearchOutcome>;
  /** ID peminta; dipakai saat mentah-terjemahkan hasil pencarian ke TrackInfo. */
  requesterId: string;
}

export type SpotifyPlayResult =
  /** Audio ditemukan dan cocok. */
  | { kind: 'resolved'; track: TrackInfo; meta: SpotifyTrackMeta; match: SpotifyMatch }
  /** Tautan playlist/album di luar cakupan fitur ini. */
  | { kind: 'unsupported'; message: string }
  /** Kredensial Spotify belum diisi. */
  | { kind: 'not-configured' }
  | { kind: 'not-found'; message: string }
  /** Lavalink tidak bisa mencari sama sekali. */
  | { kind: 'search-failed'; message: string }
  /** Ada hasil, tapi tidak ada yang cocok dengan metadata. */
  | { kind: 'no-match'; meta: SpotifyTrackMeta; tried: number }
  | { kind: 'error'; message: string };

/** Bentuk ringkas untuk render: metadata + hasil pencocokan. */
export type SpotifyPlayInfo = SpotifySourceInfo;

export async function resolveSpotifyPlay(
  query: string,
  deps: SpotifyPlayDeps,
): Promise<SpotifyPlayResult> {
  const link = parseSpotifyLink(query);

  if (link.kind === 'none') return { kind: 'unsupported', message: unsupportedLinkMessage(link) };
  if (link.kind !== 'track') return { kind: 'unsupported', message: unsupportedLinkMessage(link) };

  const found = await deps.meta(link.id);

  if (found.kind === 'not-configured') return { kind: 'not-configured' };
  if (found.kind === 'not-found') return { kind: 'not-found', message: found.message };
  if (found.kind === 'error') return { kind: 'error', message: found.message };

  const meta = found.track;
  const search = await deps.search(searchQueryFor(meta));

  if (search.kind === 'error') return { kind: 'search-failed', message: search.message };
  if (search.kind === 'unavailable') {
    return { kind: 'search-failed', message: 'Lavalink belum terhubung, jadi audio tidak bisa dicari.' };
  }
  if (search.kind === 'empty' || search.tracks.length === 0) {
    return { kind: 'no-match', meta, tried: 0 };
  }

  const candidates: TrackInfo[] = search.tracks.map((track) =>
    toTrackInfo(track, deps.requesterId),
  );
  const match = pickSpotifyMatch({ meta, candidates });

  if (!match) {
    // Hasil ada tapi tidak cocok: lebih jujur bilang "tidak ada yang cocok"
    // daripada memutar cover atau live version yang tidak diminta.
    return { kind: 'no-match', meta, tried: candidates.length };
  }

  return { kind: 'resolved', track: match.track, meta, match };
}

/** Kata kunci pencarian ke Lavalink: judul + artis pertama. */
export function searchQueryFor(meta: SpotifyTrackMeta): string {
  const artist = meta.artists[0] ?? '';
  return [meta.title, artist].filter((part) => part.length > 0).join(' ');
}

/** Ringkasan untuk ditambahkan ke embed hasil `/play`. */
export function toPlayInfo(meta: SpotifyTrackMeta, match: SpotifyMatch): SpotifyPlayInfo {
  return {
    title: meta.title,
    artists: meta.artists,
    album: meta.album,
    imageUrl: meta.imageUrl,
    url: meta.url,
    sourceTitle: match.track.title,
    sourceUri: match.track.uri,
    matchNote: matchNote(match),
  };
}

export type { SpotifyLink };