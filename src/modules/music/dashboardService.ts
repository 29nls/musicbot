import type { KeyValueStore } from '../../services/kvStore.js';
import { getLogger } from '../logger/index.js';
import { canControlMusic, isInSameVoiceChannel } from './permissions.js';
import type { PlayOutcome, TrackInfo } from './types.js';
import type { LoopMode } from './loop.js';
import {
  claimDashboardCommand,
  decodeDashboardMusicCommand,
  DASHBOARD_PLAYER_CONTROLS,
  toDashboardTrack,
  writeDashboardResult,
  type DashboardAction,
  type DashboardCommand,
  type DashboardFailureReason,
  type DashboardResult,
  type DashboardTrack,
  type SearchSource,
} from './dashboard.js';

/**
 * Perintah musik dashboard → proses bot.
 *
 * Dashboard tidak bisa memanggil player langsung: player hidup di proses bot.
 * Jembatannya kanal pub/sub dan lease kepemilikan yang sudah dipakai untuk
 * invalidasi konfigurasi, bukan endpoint HTTP baru. Modul ini penerjemahnya:
 * satu pesan kanal menjadi pemanggilan `MusicService`, dan hasilnya ditulis
 * balik ke key yang ditunggu dashboard.
 *
 * **Otorisasi bukan di sini.** Bentuk pesan sudah divalidasi oleh kontrak dan
 * route dashboard sudah memeriksa session dan keanggotaan guild. Yang dilakukan
 * di sini adalah cek tingkat kedua yang tidak boleh dilewati siapa pun: modul
 * musik aktif, DJ role menurut gateway (bukan menurut peramban), dan user
 * benar-benar berada di voice channel yang sama dengan bot saat ini.
 *
 * **Hanya shard pemilik guild yang menjalankan.** Semua proses berlangganan
 * kanal yang sama; `ownsGuild` memastikan perintah tidak dijalankan dua kali.
 */

/** Port ke `MusicService`, dipersempit ke yang benar-benar dipanggil modul ini. */
export interface DashboardMusicPort {
  botVoiceChannelId(guildId: string): string | null;
  /** true kalau ada node Lavalink yang siap. */
  readonly isConnected: boolean;
  play(request: {
    guildId: string;
    query: string;
    requesterId: string;
    voiceChannelId: string;
    shardId: number;
    canControl: boolean;
  }): Promise<PlayOutcome>;
  enqueue(request: {
    guildId: string;
    tracks: readonly TrackInfo[];
    voiceChannelId: string;
    shardId: number;
    canControl: boolean;
    playlistName?: string;
  }): Promise<PlayOutcome>;
  setPaused(guildId: string, paused: boolean): Promise<boolean>;
  skip(guildId: string): Promise<{ skipped: unknown | null; next: unknown | null }>;
  stop(guildId: string): Promise<unknown>;
  setLoopMode(guildId: string, mode: LoopMode): Promise<LoopMode>;
  setVolume(guildId: string, level: number): Promise<number>;
}

export interface DashboardGuildConfig {
  modules: { music: boolean };
  djRoleId: string | null;
}

/**
 * Keanggotaan menurut **gateway** proses bot.
 *
 * `null` = guild tidak dikelola proses ini atau membernya tidak bisa dibaca;
 * keduanya berarti perintah tidak dijalankan di sini. Data dari peramban tidak
 * pernah dipakai untuk menjawab pertanyaan ini.
 */
export interface DashboardMembership {
  canManageGuild: boolean;
  memberRoleIds: readonly string[];
  /** `null` = user tidak sedang di voice channel. */
  voiceChannelId: string | null;
}

/** Hasil pencarian yang sudah diterjemahkan ke bentuk aman untuk peramban. */
export type DashboardSearchResult =
  | { kind: 'ok'; tracks: DashboardTrack[] }
  | { kind: 'empty' }
  | { kind: 'not-configured' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string };

/** Playlist personal yang sudah di-resolve ulang oleh proses bot. */
export type DashboardPlaylistLoad =
  | { kind: 'ok'; playlistName: string; tracks: TrackInfo[]; failed: number; total: number }
  | { kind: 'not-found' };

export interface DashboardMusicDeps {
  /** true hanya di proses yang memegang guild ini menurut gateway. */
  ownsGuild(guildId: string): boolean;
  /** Port ke `MusicService` milik proses bot ini. */
  music(): DashboardMusicPort;
  getConfig(guildId: string): Promise<DashboardGuildConfig>;
  /** Resolve lewat jalur yang sama dengan `/play` atau `/search`. */
  search(
    guildId: string,
    userId: string,
    query: string,
    source: SearchSource,
  ): Promise<DashboardSearchResult>;
  canControl(guildId: string, userId: string): Promise<DashboardMembership | null>;
  /** Muat playlist personal milik `userId`, lalu resolve ulang tiap lagu. */
  loadPlaylist(guildId: string, userId: string, playlistId: number): Promise<DashboardPlaylistLoad>;
  shardIdForGuild(guildId: string): number;
  /** Store bersama tempat hasil ditulis; ditanya saat menulis, bukan disimpan. */
  store(): KeyValueStore;
  /** ID proses ini; menjadi penanda siapa yang menulis hasil. */
  owner(): string;
  now?: () => number;
}

/**
 * Jalankan satu perintah dari dashboard lalu tulis hasilnya ke store.
 *
 * `null` = pesan rusak, terlalu tua, bukan untuk shard ini, atau sudah pernah
 * dijalankan. Pemanggil mencatatnya lalu membiarkan. Tidak pernah melempar: satu
 * perintah gagal tidak boleh mematikan langganan.
 */
export async function handleDashboardMusicCommand(
  deps: DashboardMusicDeps,
  raw: string,
  now = Date.now(),
): Promise<{ requestId: string; result: DashboardResult } | null> {
  const message = decodeDashboardMusicCommand(raw, now);
  if (!message) return null;

  const { guildId, userId, requestId, command } = message;

  // Setiap proses menerima kanal yang sama. Hanya proses yang benar-benar
  // memegang guild ini yang boleh menyentuh player-nya.
  if (!deps.ownsGuild(guildId)) return null;

  if (!(await claimDashboardCommand(deps.store(), requestId))) return null;

  let result: DashboardResult;
  try {
    result = await execute(deps, guildId, userId, command);
  } catch (error) {
    getLogger().error({ err: error, guildId, requestId, action: command.kind }, 'Perintah musik dashboard gagal');
    result = fail(command.kind, 'failed');
  }

  await writeDashboardResult(deps.store(), deps.owner(), requestId, result).catch((error: unknown) => {
    getLogger().warn({ err: error, requestId }, 'Hasil perintah musik dashboard gagal ditulis');
  });

  return { requestId, result };
}

function fail(action: DashboardAction, reason: DashboardFailureReason, message?: string): DashboardResult {
  return { action, ok: false, reason, ...(message ? { message } : {}) };
}

async function execute(
  deps: DashboardMusicDeps,
  guildId: string,
  userId: string,
  command: DashboardCommand,
): Promise<DashboardResult> {
  const action = command.kind;
  const config = await deps.getConfig(guildId);

  if (!config.modules.music) return fail(action, 'music-disabled');

  const membership = await deps.canControl(guildId, userId);
  if (!membership) return fail(action, 'permission-unknown');

  if (command.kind === 'search') {
    const found = await deps.search(guildId, userId, command.query, command.source);
    if (found.kind === 'empty') return fail(action, 'empty');
    if (found.kind === 'not-configured') return fail(action, 'not-configured');
    if (found.kind === 'unavailable') return fail(action, 'player-unavailable');
    if (found.kind === 'error') return fail(action, 'failed', found.message);

    return { action: 'search', ok: true, tracks: found.tracks };
  }

  const music = deps.music();
  const canControl = canControlMusic({
    djRoleId: config.djRoleId,
    memberRoleIds: [...membership.memberRoleIds],
    canManageGuild: membership.canManageGuild,
  });

  // Sama seperti gate slash command musik: server tanpa role DJ membolehkan
  // siapa pun, server ber-role DJ hanya pemegangnya (dan Manage Server).
  if (!canControl) return fail(action, 'need-dj-role', config.djRoleId ?? undefined);

  const botChannelId = music.botVoiceChannelId(guildId);
  const isPlayerControl = DASHBOARD_PLAYER_CONTROLS.includes(action);

  // Tombol pause/resume/skip/stop tidak boleh membuat bot bergabung ke voice
  // hanya karena user menekannya. Tidak ada player berarti tidak ada yang bisa
  // dikontrol.
  if (isPlayerControl && !botChannelId) return fail(action, 'player-unavailable');

  // Keputusan voice diambil dari gateway, bukan dari peramban. Untuk play,
  // player yang belum ada hanya boleh diambil user yang memang sedang di voice.
  if (botChannelId) {
    if (!isInSameVoiceChannel(membership.voiceChannelId, botChannelId, membership.canManageGuild)) {
      return fail(action, 'not-same-voice-channel');
    }
  } else if (!membership.voiceChannelId) {
    return fail(action, 'no-voice');
  }

  const voiceChannelId = botChannelId ?? membership.voiceChannelId;
  if (!voiceChannelId) return fail(action, 'no-voice');

  if (command.kind === 'play' || command.kind === 'enqueue') {
    if (!music.isConnected) return fail(action, 'player-unavailable');

    return toPlayResult(
      command.kind,
      await music.play({
        guildId,
        query: command.query,
        requesterId: userId,
        voiceChannelId,
        shardId: deps.shardIdForGuild(guildId),
        canControl,
      }),
    );
  }

  switch (command.kind) {
    case 'playlist': {
      if (!music.isConnected) return fail(action, 'player-unavailable');

      const playlist = await deps.loadPlaylist(guildId, userId, command.playlistId);
      if (playlist.kind === 'not-found') return fail(action, 'playlist-not-found');
      if (playlist.tracks.length === 0) {
        return fail(action, 'empty', 'Tidak ada lagu playlist yang bisa diputar.');
      }

      const outcome = await music.enqueue({
        guildId,
        tracks: playlist.tracks,
        voiceChannelId,
        shardId: deps.shardIdForGuild(guildId),
        canControl,
        playlistName: playlist.playlistName,
      });

      if (outcome.kind !== 'added') return toPlayResult('playlist', outcome);

      return {
        action: 'playlist',
        ok: true,
        started: outcome.started,
        added: outcome.tracks.length,
        failed: playlist.failed,
        total: playlist.total,
      };
    }
    case 'pause':
      return (await music.setPaused(guildId, true))
        ? { action: command.kind, ok: true }
        : fail(action, 'player-unavailable');
    case 'resume':
      return (await music.setPaused(guildId, false))
        ? { action: command.kind, ok: true }
        : fail(action, 'player-unavailable');
    case 'skip': {
      const { skipped } = await music.skip(guildId);
      return skipped ? { action: command.kind, ok: true } : fail(action, 'player-unavailable');
    }
    case 'stop':
      await music.stop(guildId);
      return { action: 'stop', ok: true };
    case 'loop':
      await music.setLoopMode(guildId, command.mode);
      return { action: 'loop', ok: true };
    case 'volume':
      await music.setVolume(guildId, command.level);
      return { action: 'volume', ok: true };
  }
}

/**
 * Hasil `play` → jawaban dashboard.
 *
 * `started: false` berarti lagu masuk antrean, bukan langsung diputar — beda yang
 * nyata saat user menekan Play dua kali, dan UI harus bisa membedakannya.
 */
function toPlayResult(action: 'play' | 'enqueue' | 'playlist', outcome: PlayOutcome): DashboardResult {
  switch (outcome.kind) {
    case 'added': {
      const first = outcome.tracks[0];
      if (!first) return fail(action, 'empty');

      if (action === 'playlist') {
        return {
          action,
          ok: true,
          started: outcome.started,
          added: outcome.tracks.length,
          failed: 0,
          total: outcome.tracks.length,
        };
      }

      return { action, ok: true, started: outcome.started, track: toDashboardTrack(first) };
    }
    case 'empty':
      return fail(action, 'empty');
    case 'unavailable':
      return fail(action, 'player-unavailable');
    case 'queue-full':
      return fail(action, 'failed', 'Antrean penuh');
    case 'rejected':
      return fail(action, 'failed', `Ditolak: ${outcome.reason}`);
    case 'attachment-failed':
      return fail(action, 'failed', outcome.reason);
    case 'error':
      return fail(action, 'failed', outcome.message);
  }
}
