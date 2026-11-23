import { toDashboardTrack, type DashboardTrack } from '@bot/modules/music/dashboard.js';
import type { LoopMode } from '@bot/modules/music/loop.js';
import { PLAYER_STATE_TTL_MS, type PlayerSnapshot } from '@bot/modules/music/playerState.js';
import type { TrackInfo } from '@bot/modules/music/types.js';

/**
 * Bentuk state yang dikirim ke peramban, plus aturan kapan snapshot boleh
 * dipercaya.
 *
 * Murni supaya bisa diuji tanpa Redis dan tanpa Next.js. Yang diuji di sini
 * adalah dua keputusan yang paling mudah salah: kapan snapshot dianggap basi,
 * dan kapan snapshot bukan milik pemegang lease saat ini.
 */

export type DegradedReason = 'shared-store-down' | 'stale' | 'owner-mismatch';

export interface MusicStateResponse {
  guildId: string;
  /** `null` = tidak ada pemutar, bukan \"sedang memuat\". */
  player: PlayerSnapshot | null;
  queue: {
    tracks: DashboardTrack[];
    loopMode: LoopMode;
  };
  /** true = angka pemutar tidak bisa dipercaya; UI harus menyebut alasannya. */
  degraded: boolean;
  reason: DegradedReason | null;
  /** Saat route membaca store (epoch ms). */
  fetchedAt: number;
}

export interface MusicStateInput {
  guildId: string;
  snapshot: PlayerSnapshot | null;
  /** Pemegang lease player saat ini, atau `null` kalau tidak ada. */
  leaseOwner: string | null;
  queue: readonly TrackInfo[];
  loopMode: LoopMode;
  storeDown?: boolean;
  now?: number;
}

export function buildMusicState(input: MusicStateInput): MusicStateResponse {
  const now = input.now ?? Date.now();
  const queue = {
    tracks: input.queue.map((track) => toDashboardTrack(track)),
    loopMode: input.loopMode,
  };

  if (input.storeDown) {
    return {
      guildId: input.guildId,
      player: null,
      queue: { tracks: [], loopMode: input.loopMode },
      degraded: true,
      reason: 'shared-store-down',
      fetchedAt: now,
    };
  }

  const snapshot = input.snapshot;
  if (!snapshot) {
    return { guildId: input.guildId, player: null, queue, degraded: false, reason: null, fetchedAt: now };
  }

  if (snapshot.guildId !== input.guildId) {
    return { guildId: input.guildId, player: null, queue, degraded: true, reason: 'stale', fetchedAt: now };
  }

  // Snapshot ditulis hanya oleh pemegang lease. Kalau lease-nya sudah tidak ada
  // atau sudah berpindah, snapshot itu milik proses yang tidak lagi memutar
  // guild ini dan tidak boleh ditampilkan sebagai status aktif.
  if (!input.leaseOwner || snapshot.owner !== input.leaseOwner) {
    return {
      guildId: input.guildId,
      player: null,
      queue,
      degraded: true,
      reason: 'owner-mismatch',
      fetchedAt: now,
    };
  }

  if (!isSnapshotFresh(snapshot, now)) {
    return { guildId: input.guildId, player: null, queue, degraded: true, reason: 'stale', fetchedAt: now };
  }

  return { guildId: input.guildId, player: snapshot, queue, degraded: false, reason: null, fetchedAt: now };
}

/** Snapshot lebih tua dari TTL berarti heartbeat bot sudah berhenti. */
export function isSnapshotFresh(snapshot: PlayerSnapshot, now = Date.now()): boolean {
  const age = now - snapshot.capturedAt;

  return age >= 0 && age <= PLAYER_STATE_TTL_MS;
}

/**
 * Posisi yang ditampilkan sekarang.
 *
 * Dashboard polling tiap 2–3 detik; progress bar tidak perlu ikut polling tiap
 * detik. Angka ini dihitung dari `positionMs` + selisih waktu sejak
 * `capturedAt`, dan dibekukan saat pause.
 */
export function interpolatePosition(snapshot: PlayerSnapshot, now = Date.now()): number {
  if (!snapshot.current) return 0;
  if (snapshot.state === 'paused') return snapshot.positionMs;
  if (snapshot.state !== 'playing') return snapshot.positionMs;

  const elapsed = Math.max(0, now - snapshot.capturedAt);
  const position = snapshot.positionMs + elapsed;

  return snapshot.current.isStream || snapshot.current.durationMs <= 0
    ? position
    : Math.min(position, snapshot.current.durationMs);
}

/** Durasi untuk UI; tidak memakai em dash. */
export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '-';

  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
