import { PrismaPlaylistRepository } from '@bot/modules/playlists/repository.js';
import { PlaylistService } from '@bot/modules/playlists/service.js';
import {
  MAX_PLAYLIST_TRACKS,
  type Playlist,
  type PlaylistFailure,
} from '@bot/modules/playlists/types.js';
import type { TrackInfo } from '@bot/modules/music/types.js';
import { getPrisma } from './prisma.js';

/**
 * Playlist personal untuk dashboard.
 *
 * `PlaylistService` dan `PrismaPlaylistRepository` dipakai apa adanya dari repo
 * bot. Dashboard tidak menulis kolom JSON sendiri: aturan duplikat, batas
 * jumlah, dan serialisasi tetap satu sumber dengan `/playlist`.
 */

export function getDashboardPlaylistService(): PlaylistService {
  return new PlaylistService(new PrismaPlaylistRepository(getPrisma()));
}

export interface SerializedTrack {
  /** Posisi 1-based; dipakai UI untuk menghapus lagu. */
  position: number;
  title: string;
  author: string;
  durationMs: number;
  uri: string;
}

export interface SerializedPlaylist {
  id: number;
  name: string;
  scope: 'personal';
  trackCount: number;
  totalDurationMs: number;
  tracks: SerializedTrack[];
  createdAt: string;
  updatedAt: string;
}

export function serializePlaylist(playlist: Playlist): SerializedPlaylist {
  return {
    id: playlist.id,
    name: playlist.name,
    scope: 'personal',
    trackCount: playlist.tracks.length,
    totalDurationMs: playlist.tracks.reduce(
      (total, track) => total + (track.durationMs > 0 ? track.durationMs : 0),
      0,
    ),
    tracks: playlist.tracks.map((track, index) => ({
      position: index + 1,
      title: track.title,
      author: track.author,
      durationMs: track.durationMs,
      uri: track.uri ?? '',
    })),
    createdAt: playlist.createdAt.toISOString(),
    updatedAt: playlist.updatedAt.toISOString(),
  };
}

/**
 * Badan permintaan → lagu yang bisa disimpan.
 *
 * `encoded` tidak pernah diterima dari peramban: data itu hanya boleh datang
 * dari Lavalink. Yang disimpan adalah `uri`, dan pemutaran ulang me-resolve
 * ulang sumbernya.
 */
export function parseTrackInput(value: unknown): TrackInfo[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (value.length > MAX_PLAYLIST_TRACKS) return null;

  const tracks: TrackInfo[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;

    const item = entry as Record<string, unknown>;
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const author = typeof item.author === 'string' ? item.author.trim() : '';
    const uri = typeof item.uri === 'string' ? item.uri.trim() : '';
    const durationMs = typeof item.durationMs === 'number' ? item.durationMs : Number.NaN;

    if (title.length === 0 || title.length > 300) return null;
    if (author.length > 200) return null;
    if (!Number.isFinite(durationMs) || durationMs < 0) return null;
    if (!isHttpUrl(uri)) return null;

    tracks.push({
      encoded: '',
      title,
      author,
      durationMs: Math.trunc(durationMs),
      uri,
      artworkUrl: null,
      isStream: durationMs === 0,
      requesterId: '',
    });
  }

  return tracks;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Posisi tujuan dari body move; harus integer 1-based. */
export function parseMovePosition(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
}

export function playlistFailure(error: PlaylistFailure): {
  status: number;
  error: string;
  message: string;
} {
  switch (error.kind) {
    case 'name-taken':
      return { status: 409, error: 'name-taken', message: `Nama "${error.name}" sudah dipakai.` };
    case 'name-invalid':
      return { status: 400, error: 'name-invalid', message: 'Nama playlist tidak valid.' };
    case 'not-found':
      return { status: 404, error: 'not-found', message: 'Playlist tidak ditemukan.' };
    case 'empty':
      return { status: 422, error: 'empty', message: 'Playlist masih kosong.' };
    case 'full':
      return {
        status: 422,
        error: 'full',
        message: `Playlist sudah mencapai batas ${error.limit} lagu.`,
      };
    case 'out-of-range':
      return {
        status: 422,
        error: 'out-of-range',
        message: `Posisi lagu di luar jangkauan (${error.count} lagu).`,
      };
    case 'not-owner':
      return { status: 403, error: 'not-owner', message: 'Playlist ini bukan milik Anda.' };
    case 'private':
      return { status: 403, error: 'private', message: 'Playlist ini privat.' };
    case 'duplicate-track':
      return {
        status: 409,
        error: 'duplicate-track',
        message: `Lagu "${error.title}" sudah ada di playlist.`,
      };
  }
}
