/**
 * Bucket harian untuk statistik.
 *
 * Dipisah jadi file sendiri karena dua hal bisa salah di sini dan keduanya
 * tidak terlihat dari tes playback:
 *
 * - **Zona waktu.** Baris dikelompokkan per hari *UTC*, bukan waktu lokal
 *   server. Server Discord ada di ribuan zona waktu, jadi "hari" tidak pernah
 *   punya satu makna untuk semua orang; UTC dipilih supaya angka di `/stats`
 *   bisa dibandingkan antar server dan tidak berubah retroactive saat daylight
 *   saving bergeser.
 * - **Batas inklusif.** Rentang 30 hari berarti 30 titik, bukan 31. Salah di
 *   sini membuat "hari ini" selalu punya nilai, dan grafiknya terlihat
 *   benar padahal ujung-ujungnya meleset.
 */

export const MS_PER_DAY = 86_400_000;

/** Pukul 00:00 UTC dari tanggal mana pun. */
export function startOfUtcDay(value: Date = new Date()): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0),
  );
}

/** Kunci hari dalam bentuk `YYYY-MM-DD` — dipakai sebagai label & kunci cache. */
export function dayKey(day: Date): string {
  const year = String(day.getUTCFullYear()).padStart(4, '0');
  const month = String(day.getUTCMonth() + 1).padStart(2, '0');
  const date = String(day.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${date}`;
}

/** Ubah kunci `YYYY-MM-DD` kembali jadi `Date`; null kalau tidak valid. */
export function parseDayKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const result = new Date(Date.UTC(year, month - 1, day));
  // Menolak 2026-02-31 dan sejenisnya: Date akan melipat ke bulan berikutnya,
  // dan hari yang tidak pernah ada tidak boleh muncul di grafik.
  if (result.getUTCMonth() !== month - 1 || result.getUTCDate() !== day) return null;

  return result;
}

/**
 * Rentang hari inklusif dari `days` hari terakhir, termasuk hari ini.
 *
 * `days = 1` menghasilkan satu titik (hari ini), bukan hari ini plus kemarin —
 * itulah yang membuat "hari ini" bisa dijawab tanpa downtoffs yang aneh.
 */
export function dayRange(days: number, now: Date = new Date()): { since: Date; until: Date } {
  const until = startOfUtcDay(now);
  const span = Math.max(1, Math.trunc(days));
  const since = new Date(until.getTime() - (span - 1) * MS_PER_DAY);

  return { since, until };
}

/**
 * Deret hari tanpa celah.
 *
 * Hari tanpa aktivitas tetap dikembalikan dengan `null`, supaya pemanggil yang
 * punya jumlah bisa mengisinya. Motor rendering di sini sengaja tidak tahu
 * soal grafik — dia hanya mengembalikan tanggal.
 */
export function eachDay(since: Date, until: Date): Date[] {
  const start = startOfUtcDay(since);
  const end = startOfUtcDay(until);
  const days: Date[] = [];

  for (let time = start.getTime(); time <= end.getTime(); time += MS_PER_DAY) {
    days.push(new Date(time));
  }

  return days;
}