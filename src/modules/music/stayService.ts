import { getLogger } from '../../services/logger.js';
import type { GuildConfig } from '../config/index.js';
import { planStay, type StayPlan } from './stay.js';

/**
 * Penerapan mode 24/7.
 *
 * Ini lapisan tipis: keputusan diambil oleh `planStay` (murni), lapisan ini
 * hanya membacanya lalu menerjemahkan ke aksi nyata. Semua dependency
 * disuntik supaya bisa diuji tanpa Lavalink dan tanpa Discord.
 */

export interface StayMusicPort {
  /** Channel voice tempat bot tersambung sekarang; null kalau tidak. */
  botVoiceChannelId(guildId: string): string | null;
  /** true kalau ada lagu yang sedang diputar di server ini. */
  isPlaying(guildId: string): boolean;
  /** true kalau ada node Lavalink yang siap. */
  readonly isConnected: boolean;
  /** Sambung bot ke channel 24/7 (tidak memulai pemutaran apa pun). */
  joinStayChannel(guildId: string, channelId: string, shardId: number): Promise<void>;
}

export interface StayDeps {
  music: StayMusicPort;
  getConfig: (guildId: string) => Promise<GuildConfig>;
  logger?: {
    info: (payload: unknown, message: string) => void;
    warn: (payload: unknown, message: string) => void;
  };
}

export interface StayOutcome {
  guildId: string;
  plan: StayPlan;
  /** true kalau bot benar-benar tersambung ke channel tujuan. */
  joined: boolean;
  /** Error yang terjadi saat menyambung; null kalau bersih. */
  error: string | null;
}

export class StayService {
  constructor(private readonly deps: StayDeps) {}

  /**
   * Periksa satu server lalu jalankan keputusannya.
   *
   * Tidak pernah melempar: satu server yang bermasalah (channel dihapus,
   * Lavalink mati, hilang izin) tidak boleh menghentikan pemeriksaan server lain
   * — job akan menemuinya lagi pada sapuan berikutnya.
   */
  async apply(guildId: string, shardId: number): Promise<StayOutcome> {
    const logger = this.deps.logger ?? getLogger();

    let config: GuildConfig;
    try {
      config = await this.deps.getConfig(guildId);
    } catch (error) {
      logger.warn({ err: error, guildId }, 'Konfigurasi 24/7 tidak terbaca');
      return {
        guildId,
        plan: { action: 'none', reason: 'Konfigurasi tidak terbaca' },
        joined: false,
        error: 'konfigurasi tidak terbaca',
      };
    }

    const music = this.deps.music;
    const plan = planStay({
      configuredChannelId: config.stayChannelId,
      currentChannelId: music.botVoiceChannelId(guildId),
      moduleEnabled: config.modules.music,
      lavalinkConnected: music.isConnected,
      isPlaying: music.isPlaying(guildId),
    });

    if (plan.action !== 'join' || !plan.channelId) {
      return { guildId, plan, joined: false, error: null };
    }

    try {
      await music.joinStayChannel(guildId, plan.channelId, shardId);
      logger.info({ guildId, channelId: plan.channelId }, 'Bot masuk channel 24/7');

      return { guildId, plan, joined: true, error: null };
    } catch (error) {
      // Channel dihapus admin, bot kehilangan izin Move/Connect, atau shard mati.
      // Semuanya akan dicoba lagi pada sapuan berikutnya; diam-diam mengulang
      // tanpa catatan membuat "24/7" terlihat aktif padahal tidak berjalan.
      logger.warn(
        { err: error, guildId, channelId: plan.channelId },
        'Gagal masuk channel 24/7',
      );

      return {
        guildId,
        plan,
        joined: false,
        error: error instanceof Error ? error.message : 'gagal menyambung',
      };
    }
  }
}