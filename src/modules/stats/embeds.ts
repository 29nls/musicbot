import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../../config/constants.js';
import { formatDuration } from '../../utils/duration.js';
import { bar, sharePercent } from './aggregate.js';
import { dayKey } from './day.js';
import type { StatSummary } from './types.js';

/**
 * Tampilan `/stats`.
 *
 * Dua hal yang dijaga di sini:
 *
 * - **Nol tetap ditampilkan sebagai nol.** Server yang belum punya playback
 *   tetap melihat embed berisi angka, karena "belum ada yang diputar" dan
 *   "statistik gagal dimuat" sangat berbeda bagi yang membacanya.
 * - **Leaderboard dan grafik memakai rentang yang sama.** Kalau leaderboard
 *   dihimpun dari 90 hari tapi grafik hanya 14 hari, keduanya benar tapi
 *   maknanya berbeda.
 */
export function statsEmbed(summary: StatSummary): EmbedBuilder {
  const isTrack = summary.kind === 'track';
  const maxCount = summary.top.reduce((max, item) => Math.max(max, item.count), 0);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle(isTrack ? 'Statistik Musik' : 'Statistik Perintah')
    .setDescription(
      summary.totalCount === 0
        ? `Belum ada data ${isTrack ? 'pemutaran' : 'pemakaian perintah'} dalam ${summary.days} hari terakhir.`
        : describe(summary, isTrack),
    );

  if (summary.top.length > 0) {
    embed.addFields({
      name: isTrack ? 'Lagu paling sering' : 'Perintah paling sering',
      value: summary.top
        .map((item, index) => {
          const share = sharePercent(item.count, summary.totalCount);
          const listened =
            isTrack && item.listenedMs > 0 ? `, ${formatDuration(item.listenedMs)}` : '';

          return `${index + 1}. ${bar(item.count, maxCount)} **${item.count}x** ${item.label} (${share}%)${listened}`;
        })
        .join('\n'),
    });
  }

  embed.addFields({ name: 'Harian', value: renderDaily(summary), inline: false });

  embed.setFooter({
    text: `${dayKey(summary.since)} sampai ${dayKey(summary.until)} (UTC) | ${
      summary.activeDays
    } dari ${summary.days} hari ada aktivitas | tanpa data pribadi`,
  });

  return embed.setTimestamp();
}

/** Ringkasan satu kalimat di atas embed. */
function describe(summary: StatSummary, isTrack: boolean): string {
  const total = isTrack
    ? `**${summary.totalCount}x** pemutaran, ${formatDuration(summary.totalListenedMs)} didengarkan`
    : `**${summary.totalCount}x** perintah dipakai`;

  const peak = summary.peak
    ? ` Hari paling ramai: **${dayKey(summary.peak.day)}** (${summary.peak.count}).`
    : '';

  return `${total} dalam ${summary.days} hari terakhir.${peak}`;
}

/**
 * Grafik harian.
 *
 * Rentang lebih dari 14 hari dijumlahkan per minggu: 90 baris di dalam embed
 * jauh lebih buruk dibaca daripada 13 blok, sedangkan angkanya tetap sama.
 */
function renderDaily(summary: StatSummary): string {
  if (summary.daily.length === 0) return '*Tidak ada data.*';

  const max = summary.daily.reduce((highest, point) => Math.max(highest, point.count), 0);

  if (summary.daily.length <= 14) {
    return summary.daily
      .map((point) => `${dayKey(point.day)} ${bar(point.count, max, 8)} ${point.count}`)
      .join('\n');
  }

  const weeks = groupByWeek(summary.daily);
  const maxWeek = weeks.reduce((highest, week) => Math.max(highest, week.count), 0);

  return [
    ...weeks.map((week) => `${week.label} ${bar(week.count, maxWeek, 8)} ${week.count}`),
    `_Rentang dijumlahkan per minggu: ${summary.days} hari jadi ${weeks.length} blok._`,
  ].join('\n');
}

interface WeekBucket {
  label: string;
  count: number;
}

/** Kelompokkan titik harian ke blok mingguan (Minggu sebagai awal). */
function groupByWeek(daily: readonly StatSummary['daily'][number][]): WeekBucket[] {
  const weeks: WeekBucket[] = [];

  for (const point of daily) {
    const weekStart = new Date(point.day.getTime() - point.day.getUTCDay() * 86_400_000);
    const label = dayKey(weekStart);
    const bucket = weeks[weeks.length - 1];

    if (bucket && bucket.label === label) {
      bucket.count += point.count;
      continue;
    }

    weeks.push({ label, count: point.count });
  }

  return weeks;
}