/**
 * Riwayat singkat target untuk dilampirkan di balasan aksi.
 *
 * Murni — tidak menyentuh Discord maupun database — supaya aturannya bisa diuji
 * tanpa keduanya, dan supaya presentasi terpisah dari query yang mengumpulkannya.
 */

import { defaultTranslator, type Translator } from '../i18n/index.js';
import { caseHistoryLine } from './caseView.js';
import {
  actionEmoji,
  actionLabel,
  compareActions,
  isModerationAction,
  type ModerationAction,
  type ModerationCase,
} from './types.js';

/** Berapa kasus sebelumnya yang dirinci di balasan aksi. */
export const PRIOR_CASE_HINT_LIMIT = 5;

/** Baris agregat satu jenis aksi untuk satu target, dari database. */
export interface TargetActionRow {
  type: string;
  active: boolean;
  count: number;
}

/** Ringkasan riwayat target — bentuk yang dipakai embed. */
export interface PriorCaseSummary {
  targetId: string;
  /** Ada kasus sebelumnya yang layak ditampilkan? */
  hasHistory: boolean;
  /** Jumlah kasus sebelumnya yang tercatat, termasuk yang tidak dirinci. */
  total: number;
  /** Peringatan yang masih berlaku (belum dicabut) — sinyal paling penting. */
  activeWarnings: number;
  /** Peringatan yang lalu dicabut moderator; menjelaskan selisih angka di atas. */
  revokedWarnings: number;
  /** Ban yang benar-benar diblokir, bukan kasus ban yang gagal dieksekusi. */
  priorBans: number;
  /** Jumlah kasus sebelumnya per jenis aksi, urut dari terbanyak. */
  byAction: { type: ModerationAction; count: number; inactive: number }[];
  /** Kasus terbaru yang dirinci. */
  recentCases: ModerationCase[];
}

/**
 * Rangkai riwayat target dari agregat + kasus terbaru.
 *
 * Dua sumber itu sengaja digabung di sini: agregat menjawab "berapa banyak"
 * untuk seluruh riwayat, kasus terbaru menjawab "yang mana". Menarik semua
 * kasus hanya untuk menghitung jumlahnya akan menahan memory tanpa menambah
 * informasi — dan target yang bermasalah justru yang paling banyak kasusnya.
 *
 * `activeWarnings` sengaja dihitung dari tabel peringatan, bukan dari kasus
 * `warn` yang aktif: peringatan yang sudah dicabut moderator hilang dari tabel
 * itu, sehingga angkanya selalu "yang masih berlaku", bukan "pernah diberi".
 */
export function buildPriorCaseSummary(input: {
  targetId: string;
  actionRows: readonly TargetActionRow[];
  recentCases: readonly ModerationCase[];
  activeWarnings: number;
}): PriorCaseSummary {
  const counts = new Map<ModerationAction, { count: number; inactive: number }>();
  let total = 0;
  let revokedWarnings = 0;
  let priorBans = 0;

  for (const row of input.actionRows) {
    total += row.count;
    if (!isModerationAction(row.type)) continue;

    const bucket = counts.get(row.type) ?? { count: 0, inactive: 0 };
    bucket.count += row.count;
    // Kasus nonaktif tetap dihitung sebagai riwayat, tapi ditandai supaya
    // "Ban 3" tidak dibaca "pernah di-ban 3×" padahal dua di antaranya gagal
    // dieksekusi dan tidak pernah memblokir siapa pun.
    if (!row.active) bucket.inactive += row.count;
    counts.set(row.type, bucket);

    if (row.type === 'warn' && !row.active) revokedWarnings += row.count;
    // Hanya ban yang benar-benar diblokir. Kasus ban nonaktif berarti Discord
    // menolak eksekusinya, jadi menyebut target "pernah di-ban" akan menyatakan
    // sesuatu yang tidak pernah terjadi.
    if (row.type === 'ban' && row.active) priorBans += row.count;
  }

  const byAction = [...counts.entries()]
    .map(([type, value]) => ({ type, count: value.count, inactive: value.inactive }))
    .sort((a, b) => b.count - a.count || compareActions(a.type, b.type));

  return {
    targetId: input.targetId,
    hasHistory: total > 0,
    total,
    activeWarnings: input.activeWarnings,
    revokedWarnings,
    priorBans,
    byAction,
    recentCases: [...input.recentCases],
  };
}

/**
 * Baris paling atas balasan: sinyal yang paling menentukan sebelum moderator
 * menaikkan severity.
 *
 * Peringatan aktif ditampilkan lebih dulu karena itu satu-satunya angka yang
 * mengubah keputusan — member yang sudah diberi tahu berulang lalu di-ban
 * masalahnya bukan ban-nya, tapi peringatan yang tidak ditindaklanjuti.
 *
 * Kasus yang pernah di-ban sebelumnya juga disebut: pola bolak-ban/unban
 * berulang adalah alasan untuk menunda keputusan, bukan melanjutkannya.
 */
export function priorCaseNoteLines(
  summary: PriorCaseSummary,
  t: Translator = defaultTranslator,
): string[] {
  const lines: string[] = [];

  if (summary.activeWarnings > 0) {
    lines.push(t('mod.prior.activeWarnings', { count: summary.activeWarnings }));
  }

  // Disebut karena sebarannya masih memuat peringatan yang dicabut: tanpa ini
  // angka "peringatan" di baris bawah terlihat lebih besar daripada yang
  // berlaku, dan moderator bisa salah membaca member yang sudah dibersihkan.
  if (summary.revokedWarnings > 0) {
    lines.push(t('mod.prior.revokedWarnings', { count: summary.revokedWarnings }));
  }

  if (summary.priorBans > 0) {
    lines.push(t('mod.prior.priorBans', { count: summary.priorBans }));
  }

  if (summary.total > 0) {
    const shown = summary.byAction.slice(0, PRIOR_CASE_ACTION_BREAKDOWN);
    const rest = summary.byAction.length - shown.length;
    const breakdown = [
      ...shown.map((item) => {
        const inactive =
          item.inactive > 0 ? t('mod.prior.inactive', { count: item.inactive }) : '';

        return `${actionEmoji(item.type)} ${actionLabel(item.type, t)} \`${item.count}\`${inactive}`;
      }),
      ...(rest > 0 ? [t('mod.prior.moreActions', { count: rest })] : []),
    ].join(' · ');

    lines.push(t('mod.prior.totalLine', { count: summary.total, breakdown }));
  }

  return lines;
}

/** Berapa jenis aksi disebut di baris ringkasan; sisanya berupa "+N jenis lain". */
const PRIOR_CASE_ACTION_BREAKDOWN = 4;

/**
 * Daftar kasus terbaru untuk balasan.
 *
 * `caseHistoryLine` dipakai ulang apa adanya supaya satu kasus tampil sama
 * di `/case` maupun di balasan aksi — moderator yang membandingkan keduanya
 * tidak perlu menghafal dua format yang berbeda.
 */
export function priorCaseRecentLines(
  summary: PriorCaseSummary,
  t: Translator = defaultTranslator,
): string[] {
  return summary.recentCases
    .slice(0, PRIOR_CASE_HINT_LIMIT)
    .map((record) => caseHistoryLine(record, t));
}