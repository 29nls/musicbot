/**
 * Voice player tanpa Lavalink.
 *
 * Kelas ini yang bicara langsung ke voice gateway Discord lewat
 * `@discordjs/voice`. Dulu pekerjaan itu dilakukan node Lavalink (JVM); sekarang
 * streamnya dibuat di dalam proses bot, jadi tidak ada lagi satu komponen pun
 * yang harus hidup di luar bot.
 *
 * Pola koneksi mengikuti rawon: satu `AudioPlayer` per guild, satu
 * `VoiceConnection` yang dipakai ulang selama bot tidak keluar, dan
 * `createAudioResource` dengan `StreamType.Opus` karena yang masuk sudah berupa
 * paket opus 20 ms hasil encoder, bukan PCM mentah.
 */

import {
  AudioPlayer,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionDisconnectReason,
  VoiceConnectionStatus,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  type AudioResource,
  type DiscordGatewayAdapterImplementerMethods,
  type VoiceConnection,
} from '@discordjs/voice';
import type { Guild } from 'discord.js';
import type { Readable } from 'node:stream';

import { StreamError } from './errors.js';

/** Berapa ms menunggu koneksi suara siap sebelum menyerah. */
export const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;

/** Keadaan player yang dilihat lapisan antrean. */
export type PlayerState = 'idle' | 'playing' | 'paused' | 'error';

export interface DirectPlayerHooks {
  /** Stream habis normal (lagu selesai). */
  onTrackEnd?: () => void;
  /** Galat saat memutar. */
  onError?: (error: Error) => void;
  /** Koneksi suara terputus. */
  onDisconnect?: () => void;
}

export class DirectVoicePlayer {
  public readonly player: AudioPlayer;

  private connection: VoiceConnection | null = null;
  private resource: AudioResource<unknown> | null = null;
  private lastState: PlayerState = 'idle';
  private volumePercent = 100;

  public constructor(
    private readonly guild: Guild,
    private readonly hooks: DirectPlayerHooks = {},
    private readonly connectTimeoutMs: number = DEFAULT_CONNECT_TIMEOUT_MS,
  ) {
    this.player = new AudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });

    this.player.on('error', (error: Error) => {
      this.lastState = 'error';
      this.resource = null;
      this.hooks.onError?.(error);
    });
  }

  /** Keadaan terakhir yang diketahui. */
  public get state(): PlayerState {
    return this.lastState;
  }

  /** Persentase volume terakhir yang dipasang (0–200, mengikuti DEFAULT_VOLUME). */
  public get volume(): number {
    return this.volumePercent;
  }

  /** Channel yang sedang dipakai; null kalau belum masuk. */
  public get channelId(): string | null {
    return this.connection?.joinConfig.channelId ?? null;
  }

  /** Masuk ke channel suara dan tunggu sampai siap. */
  public async join(channelId: string): Promise<void> {
    const existing = this.connection;
    if (existing && existing.joinConfig.channelId !== channelId) {
      this.connection = null;
      void existing.destroy();
    }

    if (this.connection) {
      if (this.connection.state.status === VoiceConnectionStatus.Ready) return;
      await this.waitUntilReady(this.connection);
      return;
    }

    this.connection = joinVoiceChannel({
      channelId,
      guildId: this.guild.id,
      // discord.js menyimpan `voiceAdapterCreator` di tipenya sendiri, sedangkan
      // @discordjs/voice punya salinan strukturnya; keduanya cuma perlu pengakuan tipe.
      adapterCreator: (guild) =>
        (guild as unknown as Guild).voiceAdapterCreator as unknown as DiscordGatewayAdapterImplementerMethods,
    });

    this.connection.on('stateChange', (_oldState, newState) => {
      if (
        newState.status === VoiceConnectionStatus.Disconnected &&
        newState.reason !== VoiceConnectionDisconnectReason.Manual
      ) {
        this.hooks.onDisconnect?.();
      }
    });

    await this.waitUntilReady(this.connection);
  }

  private async waitUntilReady(connection: VoiceConnection): Promise<void> {
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, this.connectTimeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new StreamError(
        'transient',
        `Tidak bisa masuk ke channel suara dalam ${this.connectTimeoutMs} ms: ${message}`,
      );
    }
  }

  /** Mainkan satu stream opus yang sudah siap dari pipeline. */
  public async play(
    stream: Readable,
    options: { volume?: number; onEnd?: () => void } = {},
  ): Promise<void> {
    if (!this.connection) {
      throw new StreamError('unknown', 'Player belum masuk ke channel suara');
    }

    if (options.volume !== undefined) this.volumePercent = options.volume;

    this.resource = createAudioResource(stream, {
      inlineVolume: true,
      inputType: StreamType.Opus,
    });

    this.resource.volume?.setVolumeLogarithmic(this.volumePercent / 100);

    // Stream habis = lagu selesai. "Premature close" muncul juga saat audio
    // dihentikan, jadi keduanya dibedakan agar antrean tidak melompati lagu.
    this.resource.playStream.once('end', () => {
      this.resource = null;
      this.lastState = 'idle';
      options.onEnd?.();
    });

    this.resource.playStream.once('error', () => {
      this.resource = null;
    });

    this.connection.subscribe(this.player);
    this.player.play(this.resource);

    this.lastState = 'playing';
  }

  /** Jeda playback tanpa menutup koneksi. */
  public pause(): boolean {
    return this.player.pause();
  }

  /** Lanjutkan playback setelah jeda. */
  public resume(): boolean {
    return this.player.unpause();
  }

  /** Ubah volume 0–200 (100 = volume normal). */
  public setVolume(percent: number): void {
    this.volumePercent = Math.min(Math.max(percent, 0), 200);
    this.resource?.volume?.setVolumeLogarithmic(this.volumePercent / 100);
  }

  /** Hentikan playback tanpa keluar dari channel. */
  public stop(): void {
    this.player.stop(true);
    this.resource = null;
    this.lastState = 'idle';
  }

  /** Keluar dari channel dan buang semua state. */
  public destroy(): void {
    this.stop();
    if (this.connection) {
      void this.connection.destroy();
      this.connection = null;
    }
  }
}
