import { formatDuration } from '../../utils/duration.js';

/**
 * Batas durasi track — PRD §6.2, ditulis sejak draft pertama dan baru
 * dieksekusi sekarang.
 *
 * Murni supaya aturannya bisa diuji tanpa Lavalink hidup.
 */

/**
 * Durasi maksimum satu track: 6 jam.
 *
 * Batas ini berlaku untuk **semua orang, termasuk DJ**. Yang dimproteksinya
 * bukan hak akses tapi memori: satu "radio 24 jam" yang memblokir player akan
 * membuat antrean server itu berhenti bergerak sama sekali.
 */
export const MAX_TRACK_DURATION_MS = 6 * 60 * 60 * 1_000;

/**
 * Di atas 30 menit, lagu hanya boleh ditambahkan oleh DJ (role DJ atau
 * Manage Server) — aturan anti-abuse PRD §6.2.
 */
export const LONG_TRACK_THRESHOLD_MS = 30 * 60 * 1_000;

/** Bentuk minimum lagu yang dibutuhkan pemeriksaan ini. */
export interface TrackLimitInput {
  /** Durasi ms; 0 kalau tidak diketahui (live stream). */
  durationMs: number;
  isStream: boolean;
}

export type TrackLimitVerdict =
  | { kind: 'ok' }
  /** Melewati batas 6 jam — ditolak siapa pun. */
  | { kind: 'too-long'; durationMs: number }
  /** Panjang atau live stream, dan peminta bukan DJ. */
  | { kind: 'needs-control'; durationMs: number; isStream: boolean };

/**
 * Periksa satu lagu terhadap batas §6.2.
 *
 * **Live stream diperlakukan sebagai lagu panjang**, dan itu keputusan turunan
 * yang disengaja: durasinya tidak diketahui, jadi tidak ada yang bisa menjamin
 * stream itu berhenti dalam 30 menit — persis kasus yang §6.2 mau cegah.
 */
export function checkTrackLimit(
  input: TrackLimitInput,
  options: { canControl: boolean },
): TrackLimitVerdict {
  const durationMs =
    Number.isFinite(input.durationMs) && input.durationMs > 0 ? input.durationMs : 0;
  const unknownLength = durationMs === 0 || input.isStream;

  if (durationMs > MAX_TRACK_DURATION_MS) {
    return { kind: 'too-long', durationMs };
  }

  if (unknownLength || durationMs > LONG_TRACK_THRESHOLD_MS) {
    return options.canControl
      ? { kind: 'ok' }
      : { kind: 'needs-control', durationMs, isStream: unknownLength };
  }

  return { kind: 'ok' };
}

export interface TrackLimitSplit<T> {
  accepted: T[];
  /** Melewati 6 jam — tidak bisa diputar siapa pun. */
  tooLong: T[];
  /**butuh DJ, dan peminta bukan DJ. */
  needsControl: T[];
}

/**
 * Pisahkan daftar lagu menjadi yang boleh dimuat dan yang ditolak.
 *
 * Jumlah penolakan dikembalikan apa adanya supayaembed bisa melaporkannya —
 * playlist yang separuhnya tidak dimuat karena alasan ini wajib terlihat,
 * bukan diputar lebih pendek tanpa penjelasan.
 */
export function splitByTrackLimits<T extends TrackLimitInput>(
  items: readonly T[],
  options: { canControl: boolean },
): TrackLimitSplit<T> {
  const split: TrackLimitSplit<T> = { accepted: [], tooLong: [], needsControl: [] };

  for (const item of items) {
    const verdict = checkTrackLimit(item, options);

    if (verdict.kind === 'too-long') split.tooLong.push(item);
    else if (verdict.kind === 'needs-control') split.needsControl.push(item);
    else split.accepted.push(item);
  }

  return split;
}

/** Alasan singkat untuk satu jenis penolakan (dipakai footer embed). */
export function trackLimitReason(
  kind: 'too-long' | 'needs-control',
  options: { durationMs?: number } = {},
): string {
  if (kind === 'too-long') {
    return `melewati batas ${formatDuration(MAX_TRACK_DURATION_MS)}`;
  }

  return options.durationMs === undefined
    ? `lebih dari ${formatDuration(LONG_TRACK_THRESHOLD_MS)} (atau live stream)`
    : `lebih dari ${formatDuration(LONG_TRACK_THRESHOLD_MS)}`;
}

/** Balasan lengkap kalau **semua** lagu ditolak. */
export function trackLimitRejectionMessage(
  kind: 'too-long' | 'needs-control',
  count: number,
): string {
  if (kind === 'too-long') {
    return (
      `${count} lagu ditolak: durasinya ${trackLimitReason('too-long')}. ` +
      'Batas ini berlaku untuk semua orang, termasuk DJ — ini untuk mencegah ' +
      'lagu radio yang memblokir player.'
    );
  }

  return (
    `${count} lagu ditolak: ${trackLimitReason('needs-control')}. ` +
    'Coba lagi dengan role DJ atau Manage Server, atau pilih lagu yang lebih pendek.'
  );
}