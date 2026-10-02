import type { TrackInfo } from './types.js';

/** Sumber angka acak, bisa disuntik supaya hasil pengacakan bisa diuji. */
export type RandomSource = () => number;

/**
 * Acak daftar lagu (Fisher-Yates).
 *
 * Fisher-Yates dipilih karena unbiased dan hanya butuh satu lintasan — tapi yang
 * lebih penting di sini: `random` bisa disuntik. `Math.random` langsung di
 * dalam fungsi berarti hasil pengacakan tidak pernah bisa diklaim dalam tes, dan
 * pengacakan adalah salah satu bagian yang paling mudah bikin bug diam-diam.
 *
 * Salinan baru dikembalikan; array asal tidak diubah supaya pemanggil yang
 * masih memegangnya tidak melihat daftar ikut berubah.
 */
export function shuffleTracks(
  tracks: readonly TrackInfo[],
  random: RandomSource = Math.random,
): TrackInfo[] {
  const shuffled = [...tracks];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(random() * (index + 1));
    const a = shuffled[index] as TrackInfo;
    const b = shuffled[swapWith] as TrackInfo;
    shuffled[index] = b;
    shuffled[swapWith] = a;
  }

  return shuffled;
}