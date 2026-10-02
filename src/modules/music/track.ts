import { formatDuration } from '../../utils/duration.js';
import type { RawTrack, TrackInfo } from './types.js';

/** Track Lavalink → bentuk internal bot (buang pluginInfo yang tidak dipakai). */
export function toTrackInfo(track: RawTrack, requesterId: string): TrackInfo {
  return {
    encoded: track.encoded,
    title: track.info.title,
    author: track.info.author,
    durationMs: track.info.isStream ? 0 : track.info.length,
    uri: track.info.uri ?? null,
    artworkUrl: track.info.artworkUrl ?? null,
    isStream: track.info.isStream,
    requesterId,
  };
}

/** "3:45", atau "🔴 LIVE" untuk siaran langsung. */
export function formatTrackDuration(track: TrackInfo): string {
  return track.isStream || track.durationMs <= 0 ? '🔴 LIVE' : formatDuration(track.durationMs);
}

/** Judul untuk daftar antrean, dipotong supaya embed tidak melebihi batas. */
export function describeTrack(track: TrackInfo, maxLength = 60): string {
  const label = `**${track.title}** — ${track.author}`;
  if (label.length <= maxLength) return label;

  return `${label.slice(0, Math.max(maxLength - 1, 1))}…`;
}

/** Progress bar teks, mis. `▬▬🔘▬▬▬▬▬▬▬▬`. */
export function progressBar(positionMs: number, durationMs: number, size = 14): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '🔴 live';

  const safeSize = Math.max(Math.trunc(size), 3);
  const ratio = Math.min(Math.max(positionMs / durationMs, 0), 1);
  const index = Math.min(Math.round(ratio * (safeSize - 1)), safeSize - 1);

  return `${'▬'.repeat(index)}🔘${'▬'.repeat(safeSize - 1 - index)}`;
}

/** Total durasi antrean; track live tidak dihitung (durasi tak diketahui). */
export function totalDurationMs(tracks: readonly TrackInfo[]): number {
  return tracks.reduce((total, track) => total + (track.isStream ? 0 : track.durationMs), 0);
}
