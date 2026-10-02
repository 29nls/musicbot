import type { Client } from 'discord.js';
import { Connectors, LoadType, Shoukaku, type Player, type TrackEndEvent } from 'shoukaku';
import { getLogger } from '../../services/logger.js';
import type { GuildConfig } from '../config/index.js';
import { DEFAULT_IDLE_TIMEOUT_SEC } from '../config/types.js';
import { IdleTimer } from './idleTimer.js';
import { clampVolume } from './permissions.js';
import { MusicQueue } from './queue.js';
import { buildSearchIdentifier } from './search.js';
import { toTrackInfo } from './track.js';
import type { PlayOutcome, QueueSnapshot, SearchOutcome, TrackInfo } from './types.js';

export interface MusicNodeOptions {
  host: string;
  port: number;
  password: string;
  name?: string;
}

export interface MusicServiceOptions {
  /** Baca konfigurasi server (volume default, idle timeout, modul aktif). */
  getConfig: (guildId: string) => Promise<GuildConfig>;
  node: MusicNodeOptions;
  maxQueueSize: number;
}

export interface PlayRequest {
  guildId: string;
  query: string;
  requesterId: string;
  voiceChannelId: string;
  shardId: number;
}

/**
 * Jembatan antara perintah Discord dan Lavalink (lewat shoukaku).
 *
 * Pembagian tanggung jawab:
 * - Lavalink memutar audio; `player.track` hanya berisi data base64 tanpa
 *   metadata, jadi **antrean dan lagu yang sedang diputar disimpan di sini**.
 * - Perpindahan lagu dikendalikan bot (lewat event `end`), bukan antrean
 *   internal Lavalink, supaya perilakunya bisa diprediksi dan dites.
 */
export class MusicService {
  private readonly manager: Shoukaku;
  private readonly queues = new Map<string, MusicQueue>();
  private readonly currents = new Map<string, TrackInfo>();
  private readonly idleTimers = new Map<string, IdleTimer>();
  private readonly attachedPlayers = new Map<string, Player>();

  constructor(client: Client, private readonly options: MusicServiceOptions) {
    const { node } = options;

    this.manager = new Shoukaku(
      new Connectors.DiscordJS(client),
      [
        {
          name: node.name ?? 'harmony',
          url: `${node.host}:${node.port}`,
          auth: node.password,
          secure: false,
        },
      ],
      {
        // Pindahkan player ke node lain kalau node mati, dan coba sambung ulang.
        moveOnDisconnect: true,
        reconnectTries: 10,
        reconnectInterval: 10,
        restTimeout: 20,
        userAgent: 'HarmonyBot/0.1.0 (+https://github.com/)',
      },
    );

    this.attachManagerLogging();
  }

  /** true kalau ada node Lavalink yang siap dipakai. */
  get isConnected(): boolean {
    return this.manager.getIdealNode() !== undefined;
  }

  /** Channel voice tempat bot berada di server ini. */
  botVoiceChannelId(guildId: string): string | null {
    return this.manager.connections.get(guildId)?.channelId ?? null;
  }

  isPlaying(guildId: string): boolean {
    return this.currents.has(guildId);
  }

  /** Cari lagu ke Lavalink. Tidak melempar: semua kegagalan jadi hasil terstruktur. */
  async resolve(query: string): Promise<SearchOutcome> {
    const node = this.manager.getIdealNode();
    if (!node) return { kind: 'unavailable' };

    try {
      const result = await node.rest.resolve(buildSearchIdentifier(query));
      if (!result) return { kind: 'empty' };

      switch (result.loadType) {
        case LoadType.TRACK:
          return { kind: 'tracks', tracks: [result.data] };
        case LoadType.PLAYLIST:
          return {
            kind: 'tracks',
            tracks: result.data.tracks,
            playlistName: result.data.info.name,
          };
        case LoadType.SEARCH:
          return { kind: 'tracks', tracks: result.data };
        case LoadType.EMPTY:
          return { kind: 'empty' };
        case LoadType.ERROR:
          return { kind: 'error', message: result.data.message };
        default:
          return { kind: 'empty' };
      }
    } catch (error) {
      getLogger().error({ err: error, query }, 'Pencarian ke Lavalink gagal');
      return { kind: 'unavailable' };
    }
  }

  /** Alur `/play`: cari → join voice → putar atau antrekan. */
  async play(request: PlayRequest): Promise<PlayOutcome> {
    const { guildId, query, requesterId, voiceChannelId, shardId } = request;

    const found = await this.resolve(query);
    if (found.kind === 'empty') return { kind: 'empty' };
    if (found.kind === 'error') return { kind: 'error', message: found.message };
    if (found.kind === 'unavailable') return { kind: 'unavailable' };

    const tracks = found.tracks.map((track) => toTrackInfo(track, requesterId));
    const queue = this.queueFor(guildId);

    const player = await this.ensurePlayer(guildId, voiceChannelId, shardId);
    const config = await this.options.getConfig(guildId);

    if (!this.isPlaying(guildId)) {
      const [first, ...rest] = tracks;
      if (!first) return { kind: 'empty' };

      const accepted = queue.add(rest);
      await player.setGlobalVolume(clampVolume(config.defaultVolume));
      await this.startTrack(guildId, player, first);

      return {
        kind: 'added',
        tracks: [first, ...rest.slice(0, accepted)],
        started: true,
        position: queue.size,
        skipped: rest.length - accepted,
        playlistName: found.playlistName,
      };
    }

    const accepted = queue.add(tracks);
    if (accepted === 0) return { kind: 'queue-full' };

    return {
      kind: 'added',
      tracks: tracks.slice(0, accepted),
      started: false,
      position: queue.size,
      skipped: tracks.length - accepted,
      playlistName: found.playlistName,
    };
  }

  /** Lewati lagu sekarang; kalau antrean habis, pemutaran dihentikan. */
  async skip(guildId: string): Promise<{ skipped: TrackInfo | null; next: TrackInfo | null }> {
    const skipped = this.currents.get(guildId) ?? null;
    const player = this.manager.players.get(guildId);
    if (!player) return { skipped, next: null };

    const next = this.queueFor(guildId).shift();

    if (next) {
      await this.startTrack(guildId, player, next);
      return { skipped, next };
    }

    this.currents.delete(guildId);
    await player.stopTrack().catch(() => undefined);
    await this.scheduleIdleDisconnect(guildId);

    return { skipped, next: null };
  }

  async setPaused(guildId: string, paused: boolean): Promise<boolean> {
    const player = this.manager.players.get(guildId);
    if (!player) return false;

    await player.setPaused(paused);
    return true;
  }

  /** Hentikan pemutaran dan bersihkan antrean (bot tetap di voice channel). */
  async stop(guildId: string): Promise<TrackInfo | null> {
    const stopped = this.currents.get(guildId) ?? null;
    const player = this.manager.players.get(guildId);

    this.queueFor(guildId).clear();
    this.currents.delete(guildId);

    if (player) await player.stopTrack().catch(() => undefined);
    await this.scheduleIdleDisconnect(guildId);

    return stopped;
  }

  /** Keluar dari voice channel dan bersihkan seluruh state server ini. */
  async disconnect(guildId: string): Promise<void> {
    this.resetGuildState(guildId);

    if (this.manager.players.has(guildId) || this.manager.connections.has(guildId)) {
      await this.manager.leaveVoiceChannel(guildId).catch((error: unknown) => {
        getLogger().warn({ err: error, guildId }, 'Gagal keluar dari voice channel');
      });
    }
  }

  /** Ringkasan untuk `/queue` dan `/nowplaying`. */
  async snapshot(guildId: string): Promise<QueueSnapshot> {
    const player = this.manager.players.get(guildId);
    const queue = this.queueFor(guildId);
    let volume = player?.volume ?? 100;

    if (!player) {
      try {
        volume = clampVolume((await this.options.getConfig(guildId)).defaultVolume);
      } catch {
        // Database tidak bisa dihubungi — volume default dipakai apa adanya.
      }
    }

    return {
      guildId,
      current: this.currents.get(guildId) ?? null,
      upcoming: queue.toArray(),
      upcomingDurationMs: queue.totalDurationMs(),
      paused: player?.paused ?? false,
      positionMs: player?.position ?? 0,
      volume,
      idleRemainingMs: this.idleTimers.get(guildId)?.remainingMs ?? null,
    };
  }

  /** Dipanggil saat bot dimatikan: batalkan timer dan keluar dari semua voice channel. */
  async shutdown(): Promise<void> {
    for (const timer of this.idleTimers.values()) timer.cancel();
    this.idleTimers.clear();

    const guildIds = [...this.manager.connections.keys()];
    await Promise.allSettled(guildIds.map((guildId) => this.manager.leaveVoiceChannel(guildId)));
  }

  private attachManagerLogging(): void {
    const logger = getLogger();

    this.manager.on('ready', (name) => logger.info({ node: name }, 'Node Lavalink terhubung'));
    this.manager.on('error', (name, error) =>
      logger.error({ err: error, node: name }, 'Error pada node Lavalink'),
    );
    this.manager.on('close', (name, code, reason) =>
      logger.warn({ node: name, code, reason }, 'Koneksi node Lavalink ditutup'),
    );
    this.manager.on('disconnect', (name, players) =>
      logger.warn({ node: name, players }, 'Node Lavalink terputus — menyambung ulang'),
    );
  }

  private attachPlayerLogging(player: Player): void {
    if (this.attachedPlayers.get(player.guildId) === player) return;
    this.attachedPlayers.set(player.guildId, player);

    const logger = getLogger();
    const guildId = player.guildId;

    player.on('end', (event: TrackEndEvent) => {
      void this.handleTrackEnd(guildId, player, event);
    });

    // Lavalink selalu mengirim 'end' (loadFailed) setelah exception, jadi
    // kemajuan antrean ditangani handleTrackEnd.
    player.on('exception', (event) =>
      logger.error({ guildId, exception: event.exception }, 'Lavalink gagal memutar lagu'),
    );

    player.on('stuck', (event) => {
      logger.warn({ guildId, thresholdMs: event.thresholdMs }, 'Lagu macet — dilewati');
      void this.skip(guildId).catch((error: unknown) =>
        logger.error({ err: error, guildId }, 'Gagal melewati lagu yang macet'),
      );
    });

    player.on('closed', (event) =>
      logger.warn({ guildId, code: event.code, reason: event.reason }, 'Koneksi voice ditutup Discord'),
    );
  }

  private async handleTrackEnd(guildId: string, player: Player, event: TrackEndEvent): Promise<void> {
    // 'replaced' berarti kita sendiri yang memutar lagu berikutnya — jangan
    // maju dua kali.
    if (event.reason === 'replaced') return;

    const logger = getLogger();
    if (event.reason === 'loadFailed') {
      logger.warn({ guildId, track: event.track.info.title }, 'Lagu gagal dimuat — lanjut ke berikutnya');
    }

    const next = this.queueFor(guildId).shift();
    if (next) {
      await this.startTrack(guildId, player, next).catch((error: unknown) => {
        logger.error({ err: error, guildId }, 'Gagal memutar lagu berikutnya');
      });
      return;
    }

    this.currents.delete(guildId);
    await this.scheduleIdleDisconnect(guildId);
  }

  private async startTrack(guildId: string, player: Player, track: TrackInfo): Promise<void> {
    this.currents.set(guildId, track);
    this.idleTimerFor(guildId).cancel();

    await player.playTrack({ track: { encoded: track.encoded } });
  }

  private async ensurePlayer(guildId: string, channelId: string, shardId: number): Promise<Player> {
    const existing = this.manager.players.get(guildId);
    if (existing && this.botVoiceChannelId(guildId) === channelId) return existing;

    if (existing) {
      // Player lama tapi bot tidak lagi di channel itu (koneksi basi/kicked).
      await existing.destroy().catch(() => undefined);
      this.resetGuildState(guildId);
    }

    const player = await this.manager.joinVoiceChannel({
      guildId,
      channelId,
      shardId,
      deaf: true,
    });

    this.attachPlayerLogging(player);
    return player;
  }

  private async scheduleIdleDisconnect(guildId: string): Promise<void> {
    const logger = getLogger();
    const timer = this.idleTimerFor(guildId);

    let seconds = DEFAULT_IDLE_TIMEOUT_SEC;
    try {
      seconds = (await this.options.getConfig(guildId)).idleTimeoutSec;
    } catch (error) {
      logger.warn({ err: error, guildId }, 'Gagal membaca idle timeout — memakai nilai default');
    }

    if (seconds <= 0) {
      timer.cancel();
      return;
    }

    timer.start(seconds * 1_000);
    logger.info({ guildId, seconds }, 'Antrean habis — bot akan keluar otomatis kalau tetap sepi');
  }

  private idleTimerFor(guildId: string): IdleTimer {
    const existing = this.idleTimers.get(guildId);
    if (existing) return existing;

    const timer = new IdleTimer(() => {
      void this.handleIdle(guildId);
    });
    this.idleTimers.set(guildId, timer);

    return timer;
  }

  private async handleIdle(guildId: string): Promise<void> {
    getLogger().info({ guildId }, 'Tidak ada aktivitas — keluar dari voice channel');
    await this.disconnect(guildId);
  }

  private queueFor(guildId: string): MusicQueue {
    const existing = this.queues.get(guildId);
    if (existing) return existing;

    const queue = new MusicQueue(this.options.maxQueueSize);
    this.queues.set(guildId, queue);

    return queue;
  }

  private resetGuildState(guildId: string): void {
    this.queues.get(guildId)?.clear();
    this.currents.delete(guildId);
    this.idleTimers.get(guildId)?.cancel();
    this.attachedPlayers.delete(guildId);
  }
}
