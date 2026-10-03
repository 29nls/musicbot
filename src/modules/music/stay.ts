import type { GuildConfig } from '../config/index.js';

/**
 * Mode 24/7 (Fase 2, PRD §5.2): bot menjaga satu voice channel tetap
 * tersambung, bahkan saat tidak ada yang memutar apa pun.
 *
 * Pemutusannya dipisah jadi fungsi murni supaya aturannya bisa diuji tanpa
 * Lavalink dan tanpa Discord — dan supaya alasan setiap keputusan bisa
 * dicatat, bukan sekadar "tidak terjadi apa-apa".
 */

export type StayAction = 'join' | 'stay' | 'none';

export interface StayPlanInput {
  /** Channel 24/7 dari konfigurasi; null = mode mati di server ini. */
  configuredChannelId: string | null;
  /** Channel tempat bot benar-benar tersambung sekarang. */
  currentChannelId: string | null;
  moduleEnabled: boolean;
  lavalinkConnected: boolean;
  /** true kalau antrean punya lagu — bot tidak boleh disuruh pindah saat sibuk. */
  isPlaying: boolean;
}

export interface StayPlan {
  action: StayAction;
  /** Channel tujuan saat `action: 'join'`. */
  channelId?: string;
  /** Alasan singkat; selalu ada supaya keputusan bisa dicatat di log. */
  reason: string;
}

/**
 * Apa yang harus dilakukan bot untuk menjaga mode 24/7.
 *
 * Dua hal sengaja **tidak** dilakukan:
 *
 * - **Bot tidak keluar sendiri** saat mode dimatikan. Menarik bot dari
 *   channel saat tidak ada lagunya bukan keputusan bot untuk diambil;
 *   `/247 leave` adalah cara yang jelas dan eksplisit.
 * - **Bot tidak pindah channel saat sedang memutar.** Kalau admin mengubah
 *   channel 24/7 di tengah lagu, pemutaran yang sedang berjalan dibiarkan
 *   selesai; perpindahan terjadi pada pemeriksaan berikutnya.
 */
export function planStay(input: StayPlanInput): StayPlan {
  if (!input.moduleEnabled) {
    return { action: 'none', reason: 'Modul musik dimatikan di server ini' };
  }

  if (!input.lavalinkConnected) {
    return { action: 'none', reason: 'Lavalink belum terhubung' };
  }

  const target = input.configuredChannelId;
  if (target === null) {
    return { action: 'none', reason: 'Mode 24/7 tidak diaktifkan di server ini' };
  }

  if (input.currentChannelId === target) {
    return { action: 'stay', reason: 'Sudah tersambung ke channel 24/7' };
  }

  if (input.isPlaying) {
    return {
      action: 'none',
      reason: 'Bot sedang memutar; perpindahan menunggu lagu selesai',
    };
  }

  return {
    action: 'join',
    channelId: target,
    reason:
      input.currentChannelId === null
        ? 'Bot belum tersambung ke channel 24/7'
        : 'Bot tersambung di channel lain',
  };
}

/** Label singkat untuk `/247 status` dan embed konfigurasi. */
export function stayLabel(config: GuildConfig, currentChannelId: string | null): string {
  if (!config.modules.music) return 'Modul musik mati';
  if (config.stayChannelId === null) return 'Mati';
  if (currentChannelId === config.stayChannelId) return `Aktif di <#${config.stayChannelId}>`;
  return `Aktif, belum sampai <#${config.stayChannelId}>`;
}