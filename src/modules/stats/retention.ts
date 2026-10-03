import type { PlaybackStatRepository } from './repository.js';

/**
 * Retensi statistik playback (PRD 10 & 12).
 *
 * Baris statistik bukan data pribadi, jadi tidak ada aturan "hapus setelah 12
 * bulan" seperti kasus moderasi. Batas tetap perlu ada: tanpa itu, satu server
 * yang aktif lama menyimpan satu baris per lagu per hari, dan tabel yang
 * tadinya tidak berarti apa-apa tumbuh terus tanpa ada yang memperhatikan.
 */
export const STAT_RETENTION_DAYS = 90;

export interface StatRetentionResult {
  cutoff: Date;
  deleted: number;
}

/** Batas retensi: 90 hari sebelum `now`, dipotong ke 00:00 UTC. */
export function statRetentionCutoff(now = new Date()): Date {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - STAT_RETENTION_DAYS);
  cutoff.setUTCHours(0, 0, 0, 0);

  return cutoff;
}

/** Hapus baris statistik yang lebih tua dari batas retensi. */
export async function purgeStatsBefore(
  repository: Pick<PlaybackStatRepository, 'deleteBefore'>,
  now = new Date(),
): Promise<StatRetentionResult> {
  const cutoff = statRetentionCutoff(now);
  const deleted = await repository.deleteBefore(cutoff);

  return { cutoff, deleted };
}