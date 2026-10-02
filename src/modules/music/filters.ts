/**
 * Filter audio (Fase 2, PRD §5.2): bassboost, nightcore, vaporwave, 8D.
 *
 * Murni — daftar mode, parser, label, dan **parameter Lavalink** semuanya di
 * sini supaya nilai-nilai yang dikirim ke node audio bisa diuji tanpa Lavalink
 * hidup. Kesalahan yang paling mahal di fitur ini bukan salah pilih mode, tapi
 * mengirim angka di luar rentang yang diterima Lavalink: filter ditolak diam-diam
 * atau suara rusak, dan itu tidak ketahuan sampai ada yang memutar lagu.
 */

/** Mode filter, sesuai §5.2 PRD ditambah `off` untuk mengembalikan suara normal. */
export const FILTER_MODES = ['off', 'bassboost', 'nightcore', 'vaporwave', '8d'] as const;

export type FilterMode = (typeof FILTER_MODES)[number];

/** Alias yang diterima karena itulah yang biasa diketik orang. */
const MODE_ALIASES: Record<string, FilterMode> = {
  off: 'off',
  mati: 'off',
  normal: 'off',
  tanpa: 'off',
  bassboost: 'bassboost',
  bass: 'bassboost',
  'bass-boost': 'bassboost',
  nightcore: 'nightcore',
  'night-core': 'nightcore',
  vaporwave: 'vaporwave',
  vapor: 'vaporwave',
  'vapor-wave': 'vaporwave',
  '8d': '8d',
  '8-d': '8d',
  '8d-audio': '8d',
  '8-dimensi': '8d',
};

/** Label mode untuk embed & pesan konfirmasi. */
const MODE_LABELS: Record<FilterMode, string> = {
  off: 'Normal (tanpa filter)',
  bassboost: 'Bassboost',
  nightcore: 'Nightcore',
  vaporwave: 'Vaporwave',
  '8d': '8D',
};

/** Terjemahkan input user ke mode; null kalau tidak dikenal. */
export function parseFilterMode(input: string): FilterMode | null {
  return MODE_ALIASES[input.trim().toLowerCase()] ?? null;
}

/** Saran pilihan saat input tidak dikenal. */
export function filterModeHint(): string {
  return FILTER_MODES.map((mode) => `\`${MODE_LABELS[mode]}\``).join(' / ');
}

export function filterModeLabel(mode: FilterMode): string {
  return MODE_LABELS[mode];
}

/** Satu band equalizer Lavalink. */
export interface EqualizerBand {
  band: number;
  gain: number;
}

/** Parameter filter yang dikirim ke Lavalink v4 (`player.setFilters`). */
export interface AudioFilterParams {
  equalizer?: EqualizerBand[];
  timescale?: { speed?: number; pitch?: number; rate?: number };
  rotation?: { rotationHz?: number };
}

/**
 * Batas aman Harmony untuk parameter filter.
 *
 * Lavalink menolak equalizer di luar band 0-14 / gain -0.25..1.0. Untuk
 * timescale dan rotation Lavalink tidak menetapkan batas ketat, jadi jendela
 * di bawah adalah keputusan bot: nilai yang lebih ekstrem memang lebih
 * "keras", tapi suaranya pecah — dan itu diketahui setelah lagu diputar,
 * bukan saat perintah diketik.
 */
export const FILTER_SAFETY = {
  /** Band equalizer yang sah menurut Lavalink v4. */
  bandMin: 0,
  bandMax: 14,
  /** Gain sah menurut Lavalink v4. */
  gainMin: -0.25,
  gainMax: 1.0,
  /** Kecepatan/tone yang masih enak didengar (1.0 = normal). */
  timescaleMin: 0.5,
  timescaleMax: 1.5,
  /** Putaran audio 8D dalam Hz; di atas ~1 Hz membuat orang pusing. */
  rotationHzMin: 0,
  rotationHzMax: 1,
} as const;

/** Parameter bassboost: angkat frekuensi rendah, biarkan sisanya. */
const BASSBOOST_BANDS: EqualizerBand[] = [
  { band: 0, gain: 0.35 },
  { band: 1, gain: 0.3 },
  { band: 2, gain: 0.25 },
  { band: 3, gain: 0.2 },
];

/** Parameter filter per mode. `off` sengaja kosong: Lavalink menganggapnya reset. */
const MODE_PARAMS: Record<FilterMode, AudioFilterParams> = {
  off: {},
  bassboost: { equalizer: BASSBOOST_BANDS },
  nightcore: { timescale: { speed: 1.125, pitch: 1.125, rate: 1.125 } },
  vaporwave: { timescale: { speed: 0.8, pitch: 0.8, rate: 0.8 } },
  '8d': { rotation: { rotationHz: 0.2 } },
};

/** Parameter Lavalink untuk satu mode. */
export function filterParamsFor(mode: FilterMode): AudioFilterParams {
  return MODE_PARAMS[mode];
}

/**
 * Periksa parameter terhadap batas aman.
 *
 * Dipakai tes untuk membuktikan setiap preset tidak pernah dikirim rusak, dan
 * tersedia juga kalau nanti ada mode dengan angka yang bisa diatur user.
 */
export function isWithinSafeBounds(params: AudioFilterParams): boolean {
  for (const band of params.equalizer ?? []) {
    if (band.band < FILTER_SAFETY.bandMin || band.band > FILTER_SAFETY.bandMax) return false;
    if (band.gain < FILTER_SAFETY.gainMin || band.gain > FILTER_SAFETY.gainMax) return false;
  }

  const timescale = params.timescale;
  if (timescale) {
    for (const value of [timescale.speed, timescale.pitch, timescale.rate]) {
      if (value === undefined) continue;
      if (value < FILTER_SAFETY.timescaleMin || value > FILTER_SAFETY.timescaleMax) return false;
    }
  }

  const rotationHz = params.rotation?.rotationHz;
  if (rotationHz !== undefined) {
    if (rotationHz < FILTER_SAFETY.rotationHzMin || rotationHz > FILTER_SAFETY.rotationHzMax) {
      return false;
    }
  }

  return true;
}