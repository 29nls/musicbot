import type { KeyValueStore } from '../../services/kvStore.js';
import type { LoopMode } from './loop.js';
import { LOOP_MODES } from './loop.js';
import type { TrackInfo } from './types.js';

/**
 * Kontrak kanal perintah musik dashboard ↔ proses bot.
 *
 * Dashboard tidak punya koneksi gateway maupun voice, jadi ia tidak bisa
 * memutar apa pun sendiri. Ia menerbitkan perintah ke kanal pub/sub yang sudah
 * dipakai invalidasi konfigurasi; bot berlangganan dan menjalankannya lewat
 * `MusicService` dan resolver yang sama dengan slash command. Tidak ada HTTP API
 * di bot, tidak ada port baru yang dibuka.
 *
 * Modul ini murni: encode, decode, dan aturan bentuk. Tidak ada impor service,
 * supaya dashboard bisa memakainya untuk menerbitkan dan bot untuk menerima,
 * tanpa salah satu menyeret milik yang lain.
 */

/** Kanal perintah (dashboard → bot). Satu kanal untuk semua guild. */
export const DASHBOARD_MUSIC_CHANNEL = 'harmony:dashboard:music';

/** Awalan key hasil (bot → dashboard) di store bersama. */
export const DASHBOARD_RESULT_PREFIX = 'harmony:dashboard:music:result:';

/** Awalan key klaim sekali-jalan, supaya satu `requestId` tidak dijalankan dua kali. */
export const DASHBOARD_CLAIM_PREFIX = 'harmony:dashboard:music:claim:';

/**
 * Umur hasil.
 *
 * Dashboard membaca sekali lalu menghapus; umur ini hanya jaring pengaman untuk
 * hasil yang tidak pernah dibaca (tab ditutup sebelum polling selesai).
 */
export const DASHBOARD_RESULT_TTL_MS = 30_000;

/** Umur klaim request; cukup lama untuk menutup pengiriman ulang pesan yang sama. */
export const DASHBOARD_CLAIM_TTL_MS = 90_000;

/**
 * Umur pesan saat diterima bot.
 *
 * Pesan yang lebih tua dari ini pasti untuk keadaan yang sudah tidak ada: guild
 * pindah shard, bot restart, sesi user kedaluwarsa. Menjalankannya sekarang
 * berarti memutar lagu yang orang minta beberapa menit lalu.
 */
export const MAX_DASHBOARD_COMMAND_AGE_MS = 60_000;

/** Batas panjang query pencarian / URL. */
export const MAX_DASHBOARD_QUERY_LENGTH = 200;

/** Sumber pencarian yang bisa diminta dashboard. */
export const SEARCH_SOURCES = ['youtube', 'spotify', 'soundcloud'] as const;
export type SearchSource = (typeof SEARCH_SOURCES)[number];

/** Kontrol yang tersedia dari dashboard. */
export const DASHBOARD_COMMANDS = [
  'play',
  'enqueue',
  'search',
  'pause',
  'resume',
  'skip',
  'stop',
  'playlist',
  'loop',
  'volume',
] as const;
export type DashboardAction = (typeof DASHBOARD_COMMANDS)[number];

/** Kontrol yang mengubah pemutar yang sudah ada (butuh player + voice yang sama). */
export const DASHBOARD_PLAYER_CONTROLS: readonly DashboardAction[] = [
  'pause',
  'resume',
  'skip',
  'stop',
  'loop',
  'volume',
];

/**
 * Alasan gagal yang boleh sampai ke peramban.
 *
 * Dashboard punya alasannya sendiri (sesi, guild, origin, rate limit, kanal
 * hilang, timeout) dan bot punya alasannya sendiri; keduanya satu daftar supaya
 * UI tidak perlu dua kamus status untuk satu tombol.
 */
export const DASHBOARD_FAILURE_REASONS = [
  'no-session',
  'no-guild',
  'forbidden',
  'permission-unknown',
  'bad-origin',
  'bad-request',
  'conflict',
  'rate-limited',
  'shared-store-down',
  'not-sent',
  'timeout',
  'music-disabled',
  'player-unavailable',
  'no-voice',
  'need-dj-role',
  'not-same-voice-channel',
  'not-configured',
  'playlist-not-found',
  'empty',
  'not-found',
  'failed',
] as const;
export type DashboardFailureReason = (typeof DASHBOARD_FAILURE_REASONS)[number];

/** Perintah yang diterima bot; bentuknya sengaja tidak bisa membawa channel voice. */
export type DashboardCommand =
  | { kind: 'play'; query: string; source: SearchSource }
  | { kind: 'enqueue'; query: string; source: SearchSource }
  | { kind: 'search'; query: string; source: SearchSource }
  | { kind: 'playlist'; playlistId: number }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'skip' }
  | { kind: 'stop' }
  | { kind: 'loop'; mode: LoopMode }
  | { kind: 'volume'; level: number };

export interface DashboardCommandMessage {
  guildId: string;
  /** User dari session; menjadi `requesterId` lagu. */
  userId: string;
  requestId: string;
  /** Kapan diterbitkan (epoch ms); bot menolak yang terlalu tua. */
  createdAt: number;
  command: DashboardCommand;
}

/** Satu lagu dalam bentuk yang aman dikirim ke peramban: tanpa `encoded`. */
export interface DashboardTrack {
  title: string;
  author: string;
  durationMs: number;
  uri: string | null;
  artworkUrl: string | null;
  isStream: boolean;
  /**
   * Asal metadata judul/artis: `spotify` kalau dicocokkan dengan metadata resmi,
   * `lavalink` kalau hasil pencarian apa adanya.
   *
   * Ini **bukan** asal audio. Audio selalu dari sumber yang diputar Lavalink,
   * dan itu disebut terpisah di `audioSource`.
   */
  metadataSource: 'spotify' | 'lavalink';
  /** Sumber audio yang benar-benar diputar (hostname URI), bukan asal metadata. */
  audioSource: string | null;
}

/** Hasil satu perintah, dibaca dashboard sekali lalu dihapus. */
export type DashboardResult =
  | { action: 'play' | 'enqueue'; ok: true; started: boolean; track: DashboardTrack }
  | {
      action: 'playlist';
      ok: true;
      started: boolean;
      /** Lagu yang benar-benar masuk antrean. */
      added: number;
      /** Lagu yang gagal di-resolve ulang. */
      failed: number;
      /** Jumlah lagu di playlist saat dimuat. */
      total: number;
    }
  | { action: 'search'; ok: true; tracks: DashboardTrack[] }
  | { action: 'pause' | 'resume' | 'skip' | 'stop' | 'loop' | 'volume'; ok: true }
  | { action: DashboardAction; ok: false; reason: DashboardFailureReason; message?: string };

/**
 * Satu pesan perintah yang sudah lolos decode, plus ID-nya.
 *
 * `requestId` ikut di sini karena kunci hasil ditulis atas namanya: pemanggil
 * tidak perlu mem-parse ulang pesan untuk tahu ke mana jawaban harus pergi.
 */
export interface DecodedDashboardCommand {
  guildId: string;
  userId: string;
  requestId: string;
  createdAt: number;
  command: DashboardCommand;
}

/**
 * Jawaban satu perintah untuk dashboard: blok hasil yang ditulis ke store,
 * sudah berpasangan dengan `requestId`-nya.
 *
 * Dipakai kedua sisi. Bot mengembalikannya setelah menulis; route dashboard
 * membaca balok yang sama lalu memeriksa `requestId` dan umurnya sebelum
 * dipercaya.
 */
export interface DashboardResultMessage {
  requestId: string;
  guildId: string;
  result: DashboardResult;
}

/** Satu hasil di store, beserta penulisnya. */
export interface StoredDashboardResult {
  /** ID proses bot yang menulis. */
  owner: string;
  result: DashboardResult;
  writtenAt: number;
}

/** Kunci hasil per permintaan. */
export function dashboardResultKey(requestId: string): string {
  return `${DASHBOARD_RESULT_PREFIX}${requestId}`;
}

/** Kunci klaim per permintaan. */
export function dashboardClaimKey(requestId: string): string {
  return `${DASHBOARD_CLAIM_PREFIX}${requestId}`;
}

const SNOWFLAKE = /^\d{17,20}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_MESSAGE_BYTES = 4_096;

export function isSnowflake(value: unknown): value is string {
  return typeof value === 'string' && SNOWFLAKE.test(value);
}

export function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID.test(value);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function encodeDashboardMusicCommand(message: DashboardCommandMessage): string {
  const command = message.command;
  const payload =
    command.kind === 'play' || command.kind === 'enqueue' || command.kind === 'search'
      ? {
          kind: command.kind,
          query: truncate(command.query, MAX_DASHBOARD_QUERY_LENGTH),
          source: command.source,
        }
      : command.kind === 'playlist'
        ? { kind: command.kind, playlistId: command.playlistId }
        : command.kind === 'loop'
          ? { kind: command.kind, mode: command.mode }
          : command.kind === 'volume'
            ? { kind: command.kind, level: command.level }
            : { kind: command.kind };

  return JSON.stringify({
    v: 1,
    guildId: message.guildId,
    userId: message.userId,
    requestId: message.requestId,
    createdAt: message.createdAt,
    command: payload,
  });
}

/**
 * Baca satu perintah dari kanal; `null` kalau tidak bisa dipercaya.
 *
 * Yang diperiksa: JSON utuh, versi, snowflake, `requestId`, umur pesan, jenis
 * perintah yang dikenal, dan panjang query. Pesan datang dari proses lain, jadi
 * semuanya diperiksa — dan decoder tidak pernah melempar, karena satu pesan
 * rusak tidak boleh mematikan langganan.
 */
export function decodeDashboardMusicCommand(
  raw: string,
  now = Date.now(),
): DecodedDashboardCommand | null {
  if (raw.length > MAX_MESSAGE_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || parsed.v !== 1) return null;
  if (!isSnowflake(parsed.guildId) || !isSnowflake(parsed.userId)) return null;
  if (!isRequestId(parsed.requestId)) return null;
  if (typeof parsed.createdAt !== 'number' || !Number.isFinite(parsed.createdAt)) return null;

  const age = Number.isFinite(now) ? now - parsed.createdAt : 0;
  // Umur negatif berarti jam proses lain di depan; diterima sampai batas yang
  // sama, karena jam yang bergeser sedikit bukan alasan kehilangan perintah.
  if (age > MAX_DASHBOARD_COMMAND_AGE_MS || age < -MAX_DASHBOARD_COMMAND_AGE_MS) return null;

  const command = decodeCommand(parsed.command);
  if (!command) return null;

  return {
    guildId: parsed.guildId,
    userId: parsed.userId,
    requestId: parsed.requestId,
    createdAt: parsed.createdAt,
    command,
  };
}

function decodeCommand(value: unknown): DashboardCommand | null {
  if (!isRecord(value)) return null;

  switch (value.kind) {
    case 'play':
    case 'enqueue':
    case 'search': {
      if (typeof value.query !== 'string') return null;
      const query = value.query.trim();
      if (query.length === 0 || query.length > MAX_DASHBOARD_QUERY_LENGTH) return null;

      return {
        kind: value.kind,
        query,
        source:
          value.source === 'spotify'
            ? 'spotify'
            : value.source === 'soundcloud'
              ? 'soundcloud'
              : 'youtube',
      };
    }
    case 'playlist': {
      if (typeof value.playlistId !== 'number' || !Number.isInteger(value.playlistId)) return null;
      if (value.playlistId <= 0) return null;

      return { kind: 'playlist', playlistId: value.playlistId };
    }
    case 'pause':
    case 'resume':
    case 'skip':
    case 'stop':
      return { kind: value.kind };
    case 'loop': {
      if (typeof value.mode !== 'string') return null;
      if (!LOOP_MODES.includes(value.mode as LoopMode)) return null;
      return { kind: 'loop', mode: value.mode as LoopMode };
    }
    case 'volume': {
      if (typeof value.level !== 'number' || !Number.isInteger(value.level)) return null;
      if (value.level < 0 || value.level > 200) return null;
      return { kind: 'volume', level: value.level };
    }
    default:
      return null;
  }
}

/** `TrackInfo` → bentuk untuk peramban. `encoded` dibuang: hanya bot yang butuh. */
export function toDashboardTrack(
  track: TrackInfo,
  metadataSource: DashboardTrack['metadataSource'] = 'lavalink',
): DashboardTrack {
  return {
    title: track.title,
    author: track.author,
    durationMs: track.durationMs,
    uri: track.uri,
    artworkUrl: track.artworkUrl,
    isStream: track.isStream,
    metadataSource,
    audioSource: audioSourceOf(track.uri),
  };
}

/**
 * Asal audio dari URI.
 *
 * Dipakai untuk memberi tahu user bahwa lagu Spotify diputar dari audio
 * pencarian — bukan mengklaim audio Spotify.
 */
export function audioSourceOf(uri: string | null): string | null {
  if (!uri) return null;

  try {
    return new URL(uri).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Validasi hasil yang diterima dashboard.
 *
 * Hasil melewati batas proses, jadi bentuknya diperiksa lagi. `owner` tidak
 * diwajibkan di sini karena dashboard hanya butuh hasil untuk `requestId` yang
 * dibuatnya sendiri; pemanggil yang membutuhkannya bisa membaca blok mentah.
 */
export function decodeDashboardResult(raw: string | null): DashboardResult | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || !isRecord(parsed.result)) return null;

  const result = parsed.result;
  if (typeof result.ok !== 'boolean') return null;
  if (typeof result.action !== 'string' || !DASHBOARD_COMMANDS.includes(result.action as DashboardAction)) {
    return null;
  }

  if (!result.ok) {
    if (
      typeof result.reason !== 'string' ||
      !DASHBOARD_FAILURE_REASONS.includes(result.reason as DashboardFailureReason)
    ) {
      return null;
    }
  }

  return result as unknown as DashboardResult;
}

/**
 * Klaim satu `requestId` sebelum dieksekusi.
 *
 * Redis pub/sub tidak menjamin pengiriman sekali, dan dua proses bot bisa
 * menerima pesan yang sama saat shard dipindahkan. Tanpa klaim, satu klik bisa
 * menambah lagu dua kali. Store yang tidak punya `compareAndSet` tidak bisa
 * menegakkan ini; pemanggil tetap jalan (satu proses), dan itu batas yang
 * dicatat, bukan jaminan palsu.
 */
export async function claimDashboardCommand(
  store: KeyValueStore,
  requestId: string,
): Promise<boolean> {
  if (!store.compareAndSet) return true;

  try {
    return await store.compareAndSet(dashboardClaimKey(requestId), '1', {
      expectedValue: null,
      ttlMs: DASHBOARD_CLAIM_TTL_MS,
    });
  } catch {
    return false;
  }
}

/** Tulis hasil; kegagalan store bukan kegagalan perintah, jadi tidak dilempar. */
export async function writeDashboardResult(
  store: KeyValueStore,
  owner: string,
  requestId: string,
  result: DashboardResult,
): Promise<boolean> {
  const stored: StoredDashboardResult = { owner, result, writtenAt: Date.now() };

  try {
    await store.set(dashboardResultKey(requestId), JSON.stringify(stored), {
      ttlMs: DASHBOARD_RESULT_TTL_MS,
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Terbitkan satu perintah.
 *
 * `false` berarti kanal tidak tersedia — store memori tanpa PUBLISH, atau
 * PUBLISH yang melempar. Keduanya satu jawaban untuk pemanggil: tidak terkirim.
 */
export async function publishDashboardMusicCommand(
  store: KeyValueStore,
  message: DashboardCommandMessage,
): Promise<boolean> {
  if (typeof store.publish !== 'function') return false;

  try {
    return await store.publish(DASHBOARD_MUSIC_CHANNEL, encodeDashboardMusicCommand(message));
  } catch {
    return false;
  }
}

/**
 * Berlangganan kanal perintah. `null` kalau store tidak bisa berlangganan.
 *
 * Tidak melempar saat start: bot tanpa langganan ini tetap benar, hanya saja
 * perintah dari dashboard tidak dijalankan dan lognya menyebut itu.
 */
export async function subscribeDashboardMusicCommands(
  store: KeyValueStore,
  handler: (message: string) => Promise<void> | void,
): Promise<(() => Promise<void>) | null> {
  if (typeof store.subscribe !== 'function') return null;

  return store.subscribe(DASHBOARD_MUSIC_CHANNEL, (message: string) => {
    void handler(message);
  });
}
