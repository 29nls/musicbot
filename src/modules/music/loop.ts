/**
 * Mode loop antrean.
 *
 * Murni — parser, label, dan keputusan "lagu apa yang berikutnya" semuanya di
 * sini supaya aturan loop bisa diuji tanpa Lavalink.
 */

import { defaultTranslator, type Translator } from '../i18n/index.js';
import type { TrackInfo } from './types.js';

/** Mode loop, sesuai §6.1 PRD: `off` / `track` / `queue`. */
export const LOOP_MODES = ['off', 'track', 'queue'] as const;

export type LoopMode = (typeof LOOP_MODES)[number];

/** Alias yang diterima karena itulah yang biasa diketik orang. */
const MODE_ALIASES: Record<string, LoopMode> = {
  off: 'off',
  mati: 'off',
  track: 'track',
  lagu: 'track',
  satu: 'track',
  queue: 'queue',
  antrean: 'queue',
};

/**
 * Kunci katalog untuk tiap mode.
 *
 * Dipisah dari label supaya `parseLoopMode` dan aturan loop tetap murni:
 * berkas ini tidak butuh apa pun dari i18n kecuali saat label benar-benar
 * ditampilkan.
 */
const MODE_LABEL_KEYS: Record<
  LoopMode,
  | 'music.loop.off'
  | 'music.loop.track'
  | 'music.loop.queue'
> = {
  off: 'music.loop.off',
  track: 'music.loop.track',
  queue: 'music.loop.queue',
};

/** Terjemahkan input user ke mode; null kalau tidak dikenal. */
export function parseLoopMode(input: string): LoopMode | null {
  return MODE_ALIASES[input.trim().toLowerCase()] ?? null;
}

/** Saran pilihan saat input tidak dikenali — mentioning apa yang bisa dipakai. */
export function loopModeHint(t: Translator = defaultTranslator): string {
  return LOOP_MODES.map((mode) => `\`${loopModeLabel(mode, t)}\``).join(' / ');
}

export function loopModeLabel(mode: LoopMode, t: Translator = defaultTranslator): string {
  return t(MODE_LABEL_KEYS[mode]);
}

/** Apa yang terjadi ke siklus yang sudah selesai saat mode dimatikan/berubah. */
export type CycleReset = 'clear' | 'keep';

/**
 * Siklus yang sudah diputar perlu disimpan agar `queue` bisa memutar ulang.
 *
 * Kalau mode dimatikan, siklus itu tidak berguna lagi dan justru menahan
 * referensi ke lagu yang sudah tidak pernah diputar — jadi dibuang.
 */
export function cycleResetOn(mode: LoopMode, previous: LoopMode): CycleReset {
  return mode === 'queue' || previous === 'queue' ? 'keep' : 'clear';
}

/** Keputusan setelah satu lagu selesai: apa yang diputar berikutnya. */
export type AdvancePlan =
  /** Lagu yang sama diputar ulang. */
  | { action: 'replay'; track: TrackInfo }
  /** Lagu baru dimulai; `queue` & `cycle` adalah keadaan setelahnya. */
  | { action: 'play'; track: TrackInfo; queue: TrackInfo[]; cycle: TrackInfo[] }
  /** Tidak ada yang tersisa — pemutaran berhenti. */
  | { action: 'stop' };

/**
 * Rencanakan lagu berikutnya setelah `finished` selesai.
 *
 * Dipisah dari Lavalink supaya aturan loop bisa diuji tanpa node audio:
 * tiga mode punya tiga hasil berbeda dan semuanya mudah salah kalau hanya
 * diuji lewat playback sungguhan.
 *
 * Urutan: satu hal yang mudah terbalik di sini adalah `finished` masuk ke riwayat
 * siklus **sebelum** antrean dicek untuk diisi ulang. Kalau tidak, siklus baru akan
 * dimulai tanpa lagu yang terakhir berbunyi — dan urutan satu putaran tidak lagi
 * sama dengan putaran sebelumnya. Karena `finished` dicatat di **akhir** riwayat,
 * pengulangan mengulang satu putaran dari awal: lagu terakhir berbunyi lagi paling
 * akhir, persis di tempatnya semula.
 */
export function planAdvance(input: {
  mode: LoopMode;
  /** Lagu yang baru saja selesai; null kalau tidak ada yang memutar. */
  finished: TrackInfo | null;
  /** Sisa antrean saat ini. */
  queue: readonly TrackInfo[];
  /** Lagu yang sudah diputar dalam siklus berjalan. */
  cycle: readonly TrackInfo[];
  /** `/skip` mengirim false: perintah itu meminta dilewati, bukan diulang. */
  respectTrackLoop?: boolean;
}): AdvancePlan {
  const { mode, finished, queue, cycle, respectTrackLoop = true } = input;

  if (mode === 'track' && finished && respectTrackLoop) {
    return { action: 'replay', track: finished };
  }

  const nextCycle = mode === 'queue' && finished ? [...cycle, finished] : [];
  const next = queue[0];

  if (next) return { action: 'play', track: next, queue: queue.slice(1), cycle: nextCycle };

  if (mode === 'queue' && nextCycle.length > 0) {
    return {
      action: 'play',
      track: nextCycle[0] as TrackInfo,
      queue: nextCycle.slice(1),
      cycle: [],
    };
  }

  return { action: 'stop' };
}