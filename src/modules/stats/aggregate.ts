import { dayKey, eachDay, startOfUtcDay } from './day.js';
import {
  STAT_BAR_WIDTH,
  STAT_TOP_LIMIT,
  type StatDailyTotal,
  type StatEntry,
  type StatSummary,
  type StatTotal,
} from './types.js';

/**
 * Perhitungan statistik — semua fungsi di file ini murni.
 *
 * Baris database datang per hari, sedangkan yang ditampilkan adalah satu
 * leaderboard dan satu grafik. Menggabungkannya di sini (bukan di service atau
 * di embed) berarti aturan "hari mana yang dihitung, siapa yang menang seri,
 * dan hari kosong ikut disortir" bisa diuji tanpa database dan tanpa Discord.
 */

/** Gabungkan baris harian jadi satu baris per item. */
export function mergeEntries(entries: readonly StatEntry[]): StatTotal[] {
  const merged = new Map<string, StatTotal>();

  for (const entry of entries) {
    const existing = merged.get(entry.key);

    if (!existing) {
      merged.set(entry.key, {
        key: entry.key,
        label: entry.label,
        count: entry.count,
        listenedMs: entry.listenedMs,
        lastDay: entry.day,
      });
      continue;
    }

    existing.count += entry.count;
    existing.listenedMs += entry.listenedMs;
    // Label yang lebih baru dipakai kalau baris lama tidak punya label
    // Kunci yang sama berarti item yang sama, jadi label kedua bukan informasi baru.
    if (existing.label.trim().length === 0) existing.label = entry.label;
    if (entry.day > existing.lastDay) existing.lastDay = entry.day;
  }

  return [...merged.values()];
}

/**
 * Leaderboard: paling banyak lebih dulu.
 *
 * Seri dipecah lewat `count` lalu `label`, supaya hasilnya **deterministik** —
 * urutan yang sama untuk data yang sama. Query database tidak menjamin itu,
 * dan leaderboard yang urutan barisnya berganti tiap kali `/stats` dibuka
 * terlihat seperti angkanya ikut berubah.
 */
export function rankTotals(totals: readonly StatTotal[], limit = STAT_TOP_LIMIT): StatTotal[] {
  return [...totals]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'id'))
    .slice(0, Math.max(0, limit));
}

/** Porsi satu item terhadap total, dalam persen 0–100 (dibulatkan). */
export function sharePercent(count: number, total: number): number {
  if (total <= 0) return 0;

  return Math.round((count / total) * 1000) / 10;
}

/**
 * Bar grafik sepanjang `width` karakter.
 *
 * Lebarnya dibatasi supaya embed tidak melebar di ponsel; nol menghasilkan
 * bar kosong, bukan "-" supaya kolom tetap lurus.
 */
export function bar(count: number, max: number, width = STAT_BAR_WIDTH): string {
  if (max <= 0 || count <= 0) return '─'.repeat(width);

  const filled = Math.max(1, Math.round((count / max) * width));

  return '█'.repeat(Math.min(filled, width)) + '─'.repeat(Math.max(0, width - filled));
}

/** Deret harian lengkap: hari tanpa aktivitas ikut, dengan nilai 0. */
export function dailyTotals(entries: readonly StatEntry[]): StatDailyTotal[] {
  const byDay = new Map<string, StatDailyTotal>();

  for (const entry of entries) {
    const key = dayKey(entry.day);
    const existing = byDay.get(key);

    if (existing) {
      existing.count += entry.count;
      existing.listenedMs += entry.listenedMs;
      continue;
    }

    byDay.set(key, { day: entry.day, count: entry.count, listenedMs: entry.listenedMs });
  }

  return [...byDay.values()].sort((a, b) => a.day.getTime() - b.day.getTime());
}

/**
 * Satu hari dari `entries` yang paling banyak aktivitasnya.
 *
 * Seri dipecah lewat `dayKey` supaya jam pada kolom `day` tidak memengaruhi
 * mana yang dianggap "hari yang sama" — kolomnya bertipe DATE, tapi reader
 * bisa mengirim `Date` dengan jam lokal.
 */
export function peakDay(entries: readonly StatEntry[]): StatDailyTotal | null {
  const days = dailyTotals(entries);
  if (days.length === 0) return null;

  let peak = days[0];
  for (const candidate of days) {
    if (candidate.count > (peak?.count ?? 0)) peak = candidate;
  }

  return peak ?? null;
}

/** Berapa hari dalam rentang yang punya aktivitas. */
export function countActiveDays(entries: readonly StatEntry[]): number {
  return new Set(entries.map((entry) => dayKey(entry.day))).size;
}

/**
 * Ringkasan lengkap untuk satu server + jenis statistik.
 *
 * Grafik selalu punya lebar tetap: 30 hari terakhir menghasilkan 30 titik, ada
 * atau tidak aktivitas. Server yang baru aktif seminggu lalu tidak boleh
 * terlihat seperti "100% hari aktif" hanya karena database-nya baru berisi dua
 * baris.
 */
export function buildSummary(input: {
  guildId: string;
  kind: StatSummary['kind'];
  since: Date;
  until: Date;
  entries: readonly StatEntry[];
  limit?: number;
}): StatSummary {
  const inRange = input.entries.filter(
    (entry) => entry.day >= startOfUtcDay(input.since) && entry.day <= startOfUtcDay(input.until),
  );

  const merged = mergeEntries(inRange);
  const days = eachDay(input.since, input.until);
  const byDay = new Map(dailyTotals(inRange).map((point) => [dayKey(point.day), point]));

  const daily: StatDailyTotal[] = days.map((day) => {
    const found = byDay.get(dayKey(day));

    return found ?? { day, count: 0, listenedMs: 0 };
  });

  return {
    guildId: input.guildId,
    kind: input.kind,
    since: startOfUtcDay(input.since),
    until: startOfUtcDay(input.until),
    totalCount: merged.reduce((sum, item) => sum + item.count, 0),
    totalListenedMs: merged.reduce((sum, item) => sum + item.listenedMs, 0),
    activeDays: new Set(inRange.map((entry) => entry.day.getTime())).size,
    days: days.length,
    top: rankTotals(merged, input.limit),
    daily,
    peak: peakDay(inRange),
  };
}
