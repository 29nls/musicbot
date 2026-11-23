import type { LoopMode } from './loop.js';
import type { TrackInfo } from './types.js';

/**
 * Snapshot status pemutar untuk dashboard.
 *
 * **Hubungannya dengan `nowPlaying.ts`.** `nowPlaying.ts` menjawab "lagu apa yang
 * sedang berbunyi", ditulis dari jalur `MusicService` yang memegang player.
 * Snapshot di sini menjawab pertanyaan yang lebih lebar — tersedia atau tidak,
 * milik proses mana, ringkasan antrean — dan disusun **hanya** oleh proses yang
 * memegang lease player (lihat `runAsOwner`). Dashboard membacanya, tidak pernah
 * menulisnya.
 *
 * **Yang tidak ikut ke sini.** Filter audio itu milik player, dan antrean
 * dibaca dari record bersama yang sudah ada. Snapshot tidak menyalin state
 * pemutar karena tidak ada kebutuhan dashboard untuk menampilkannya.
 */

export const PLAYER_STATE_KEY_PREFIX = 'harmony:playerstate:';

export function playerStateKey(guildId: string): string {
  return `${PLAYER_STATE_KEY_PREFIX}${guildId}`;
}

/**
 * Umur snapshot di store.
 *
 * Lease player lima menit, heartbeat satu menit, jadi TTL yang lebih pendek
 * dari satu putaran heartbeat berarti dua kali kegagalan berturut-turut — angka
 * yang cukup langka supaya "absence" tetap berarti sesuatu. TTL sengaja bukan
 * satu-satunya penanda basi: dashboard juga membandingkan `capturedAt` dan
 * kepemilikan lease.
 */
export const PLAYER_STATE_TTL_MS = 60_000;

/**
 * Seberapa sering bot memperbarui posisi.
 *
 * Dashboard polling 2–3 detik; progres di antaranya diinterpolasi peramban dari
 * `positionMs` dan `capturedAt`. Menulis lebih cepat dari ini hanya mengganti
 * angka yang belum sempat ditampilkan sebelum angka berikutnya datang.
 */
export const PLAYER_STATE_HEARTBEAT_MS = 5_000;

/** Satu lagu dalam bentuk yang aman dikirim ke dashboard: tanpa `encoded`. */
export interface PlayerTrackSummary {
  title: string;
  author: string;
  durationMs: number;
  uri: string | null;
  artworkUrl: string | null;
  isStream: boolean;
}

export interface PlayerSnapshot {
  guildId: string;
  /** Proses bot yang memegang lease player guild ini. */
  owner: string;
  /** `none` = bot tidak berada di voice channel mana pun. */
  state: 'playing' | 'paused' | 'idle' | 'none';
  current: PlayerTrackSummary | null;
  positionMs: number;
  volume: number;
  loopMode: LoopMode;
  /** true kalau node Lavalink siap; false = dashboard menampilkan degraded. */
  lavalinkConnected: boolean;
  /** Channel voice bot; `null` = belum bergabung. */
  voiceChannelId: string | null;
  /** Panjang antrean penuh; `queue` di bawah dipotong untuk tampilan. */
  queueSize: number;
  queue: PlayerTrackSummary[];
  /** Saat angka di atas diambil (epoch ms) — dasar interpolasi progres. */
  capturedAt: number;
}

export interface PlayerSnapshotInput {
  guildId: string;
  owner: string;
  /** Track yang sedang diputar menurut proses bot; `null` kalau tidak ada. */
  current: TrackInfo | null;
  paused: boolean;
  /** Channel voice bot; `null` = belum bergabung. */
  voiceChannelId: string | null;
  volume: number;
  loopMode: LoopMode;
  /** Node Lavalink siap? */
  lavalinkConnected: boolean;
  /** Posisi pemutaran menurut player, ms. */
  positionMs?: number;
  /** Track yang belum diputar (record antrean di store bersama). */
  queue: readonly TrackInfo[];
  now?: number;
}

/**
 * Pratinjau antrean di snapshot.
 *
 * Dashboard punya endpoint antrean sendiri untuk daftar lengkap; snapshot cukup
 * memuat awal antrean supaya panel "sedang diputar" bisa langsung menampilkan
 * beberapa baris berikutnya tanpa dua permintaan.
 */
export const PLAYER_SNAPSHOT_QUEUE_PREVIEW = 10;

function summarize(track: TrackInfo): PlayerTrackSummary {
  return {
    title: track.title,
    author: track.author,
    durationMs: track.durationMs,
    uri: track.uri,
    artworkUrl: track.artworkUrl,
    isStream: track.isStream,
  };
}

/**
 * Baca snapshot dari store. `null` = tidak ada, rusak, atau ditulis versi lain.
 *
 * Snapshot yang bentuknya salah tidak ditambal: dashboard lebih baik menampilkan
 * "tidak ada pemutar" daripada judul kosong dengan progres negatif.
 */
export function decodePlayerSnapshot(raw: string | null): PlayerSnapshot | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const item = parsed as Record<string, unknown>;

  if (typeof item.guildId !== 'string' || typeof item.owner !== 'string') return null;
  if (!isState(item.state)) return null;
  if (typeof item.capturedAt !== 'number' || !Number.isFinite(item.capturedAt)) return null;

  return {
    guildId: item.guildId,
    owner: item.owner,
    state: item.state,
    current: toSummary(item.current),
    positionMs: Math.max(readNumber(item.positionMs) ?? 0, 0),
    volume: readNumber(item.volume) ?? 100,
    loopMode: readLoopMode(item.loopMode),
    lavalinkConnected: item.lavalinkConnected === true,
    voiceChannelId: typeof item.voiceChannelId === 'string' ? item.voiceChannelId : null,
    queueSize: Math.max(Math.trunc(readNumber(item.queueSize) ?? 0), 0),
    queue: Array.isArray(item.queue)
      ? item.queue
          .map((entry) => toSummary(entry))
          .filter((entry): entry is PlayerTrackSummary => entry !== null)
          .slice(0, PLAYER_SNAPSHOT_QUEUE_PREVIEW)
      : [],
    capturedAt: item.capturedAt,
  };
}

function isState(value: unknown): value is PlayerSnapshot['state'] {
  return value === 'playing' || value === 'paused' || value === 'idle' || value === 'none';
}

function toSummary(value: unknown): PlayerTrackSummary | null {
  if (typeof value !== 'object' || value === null) return null;
  const track = value as Record<string, unknown>;
  if (typeof track.title !== 'string') return null;

  return {
    title: track.title,
    author: typeof track.author === 'string' ? track.author : '',
    durationMs: Math.max(readNumber(track.durationMs) ?? 0, 0),
    uri: typeof track.uri === 'string' ? track.uri : null,
    artworkUrl: typeof track.artworkUrl === 'string' ? track.artworkUrl : null,
    isStream: track.isStream === true,
  };
}

function readLoopMode(value: unknown): LoopMode {
  return value === 'track' || value === 'queue' ? value : 'off';
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function buildPlayerSnapshot(input: PlayerSnapshotInput): PlayerSnapshot {
  const current = input.current;

  return {
    guildId: input.guildId,
    owner: input.owner,
    state: stateOf(input),
    current: current ? summarize(current) : null,
    positionMs: current ? Math.max(input.positionMs ?? 0, 0) : 0,
    volume: input.volume,
    loopMode: input.loopMode,
    lavalinkConnected: input.lavalinkConnected,
    voiceChannelId: input.voiceChannelId,
    queueSize: input.queue.length,
    queue: input.queue.slice(0, PLAYER_SNAPSHOT_QUEUE_PREVIEW).map(summarize),
    capturedAt: input.now ?? Date.now(),
  };
}

function stateOf(input: PlayerSnapshotInput): PlayerSnapshot['state'] {
  if (!input.voiceChannelId && !input.current) return 'none';
  if (!input.current) return 'idle';

  return input.paused ? 'paused' : 'playing';
}
