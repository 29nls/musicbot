/**
 * Profil moderator: ringkasan seluruh kasus yang dicatat atas nama satu
 * moderator, beserta sebaran aksi dan sinyal kualitasnya.
 *
 * Murni — tidak menyentuh Discord maupun database — supaya aturannya bisa diuji
 * tanpa keduanya, dan supaya presentasi (urutan, persentase, batang) terpisah
 * dari query yang mengumpulkannya.
 */

import {
  ACTION_LABELS,
  isModerationAction,
  type ModerationAction,
  type ModerationCase,
} from './types.js';

/** Berapa kasus terbaru yang ditampilkan di halaman profil. */
export const MODERATOR_PROFILE_RECENT_LIMIT = 10;

/**
 * Jendela "aktif terbaru".
 *
 * Jumlah kasus total saja tidak bilang apakah seorang moderator masih aktif —
 * angka 300 bisa berarti tiga tahun lalu atau tiga minggu lalu. Jendela 30 hari
 * menjawab pertanyaan itu tanpa perlu menggambar grafik.
 */
export const MODERATOR_ACTIVE_WINDOW_DAYS = 30;

/** Aksi yang targetnya channel, bukan orang — tidak dihitung sebagai target unik. */
export const CHANNEL_TARGET_ACTIONS: readonly ModerationAction[] = ['slowmode', 'lock', 'unlock'];

/** Lebar batang visual untuk perbandingan antaraksi. */
const BAR_WIDTH = 10;

/** Satu jenis aksi milik satu moderator. */
export interface ModeratorActionStat {
  type: ModerationAction;
  /** Semua kasus dengan jenis ini, aktif maupun tidak. */
  total: number;
  /**
   * Aksi yang tercatat tetapi gagal dieksekusi Discord.
   *
   * Sengaja TIDAK termasuk peringatan yang dicabut: `active: false` pada `warn`
   * berarti moderatorniakoseconds sendiri peringatan itu, bukan kegagalan —
   * mencampurkannya akan membuat statistik ini menuduh moderator tanpa bukti.
   */
  failed: number;
  /** Peringatan yang kemudian dicabut kembali oleh moderator. */
  revoked: number;
}

/** Angka besar profil moderator, dihitung di database. */
export interface ModeratorTotals {
  total: number;
  /** Jumlah orang berbeda yang pernah jadi target (channel tidak dihitung). */
  uniqueTargets: number;
  firstCaseAt: Date | null;
  lastCaseAt: Date | null;
  /** Kasus dalam jendela `MODERATOR_ACTIVE_WINDOW_DAYS` terakhir. */
  recentCount: number;
}

/** Baris agregat mentah dari database, sebelum dirangkai jadi profil. */
export interface ModeratorActionRow {
  type: string;
  active: boolean;
  count: number;
}

/** Profil moderator — bentuk yang dipakai embed dan perintah. */
export interface ModeratorProfile {
  moderatorId: string;
  totals: ModeratorTotals;
  /** Diurutkan dari aksi terbanyak; jenis tak dikenal dibuang. */
  actions: ModeratorActionStat[];
  recentCases: ModerationCase[];
}

/**
 * Rangkai baris agregat menjadi profil.
 *
 * Jenis aksi yang tidak dikenal (versi bot yang lebih baru, atau kurasakan)
 * dibuang diam-diam. Menampilkannya sebagai "?" lebih membingungkan daripada
 * tidak menampilkannya, dan jumlahnya tetap tercermin di total.
 */
export function buildModeratorProfile(input: {
  moderatorId: string;
  actionRows: readonly ModeratorActionRow[];
  totals: ModeratorTotals;
  recentCases: readonly ModerationCase[];
}): ModeratorProfile {
  const byType = new Map<ModerationAction, ModeratorActionStat>();

  for (const row of input.actionRows) {
    if (!isModerationAction(row.type)) continue;

    const stat = byType.get(row.type) ?? { type: row.type, total: 0, failed: 0, revoked: 0 };
    stat.total += row.count;

    if (!row.active) {
      if (row.type === 'warn') stat.revoked += row.count;
      else stat.failed += row.count;
    }

    byType.set(row.type, stat);
  }

  const actions = [...byType.values()].sort(
    (a, b) => b.total - a.total || ACTION_LABELS[a.type].label.localeCompare(ACTION_LABELS[b.type].label, 'id'),
  );

  return {
    moderatorId: input.moderatorId,
    totals: input.totals,
    actions,
    recentCases: [...input.recentCases],
  };
}

/** Porsi satu jenis aksi terhadap total, dalam persen bulat. */
export function actionShare(stat: ModeratorActionStat, total: number): number {
  if (total <= 0) return 0;

  return Math.round((stat.total / total) * 100);
}

/**
 * Total kasus yang gagal dieksekusi Discord.
 *
 * Diturunkan dari baris agregat, bukan diambil dari query terpisah: sumbernya
 * sudah ada di tangan dan menghitungnya lagi berarti satu angka bisa punya dua
 * sumber kebenaran.
 */
export function moderatorFailedTotal(profile: ModeratorProfile): number {
  return profile.actions.reduce((sum, stat) => sum + stat.failed, 0);
}

/** Total peringatan yang dicabut kembali. */
export function moderatorRevokedTotal(profile: ModeratorProfile): number {
  return profile.actions.reduce((sum, stat) => sum + stat.revoked, 0);
}

/** Target unik per kasus — rasio yang tinggi berarti moderator sering mengulang target. */
export function casesPerTarget(profile: ModeratorProfile): number | null {
  if (profile.totals.uniqueTargets <= 0) return null;

  return profile.totals.total / profile.totals.uniqueTargets;
}

/** Batang visual: `████░░░░░░` — panjangnya proporsional terhadap aksi terbanyak. */
export function actionBar(stat: ModeratorActionStat, max: number, width = BAR_WIDTH): string {
  if (max <= 0 || stat.total <= 0) return '░'.repeat(width);

  const filled = Math.max(1, Math.round((stat.total / max) * width));

  return '█'.repeat(Math.min(width, filled)) + '░'.repeat(Math.max(0, width - filled));
}

/** Baris "sebaran aksi" untuk embed ringkasan. */
export function moderatorActionLines(profile: ModeratorProfile): string {
  if (profile.actions.length === 0) return '*Belum ada kasus tercatat.*';

  const max = Math.max(...profile.actions.map((stat) => stat.total));

  return profile.actions
    .map((stat) => {
      const meta = ACTION_LABELS[stat.type];
      const share = `${actionShare(stat, profile.totals.total)}%`;
      const flag = stat.failed > 0 ? ` · ⚠️ ${stat.failed} gagal` : '';

      return `${meta.emoji} **${meta.label}** ${actionBar(stat, max)} \`${stat.total}\` (${share})${flag}`;
    })
    .join('\n');
}

/**
 * Ringkasan angka besar: total, rentang waktu, target, dan aktivitas terkini.
 *
 * `recentCount` sudah dihitung di database dengan batas jendela, jadi fungsi ini
 * tidak perlu tahu waktu sekarang — dengan begitu aturannya bisa diuji dengan
 * tanggal tetap tanpa/mock clock.
 */
export function moderatorOverviewLines(profile: ModeratorProfile): string[] {
  const { totals } = profile;
  if (totals.total === 0) return ['Belum ada kasus yang tercatat untuk moderator ini.'];

  const lines = [
    `Total kasus **${totals.total}**`,
    `Target unik **${totals.uniqueTargets}** orang`,
  ];

  const perTarget = casesPerTarget(profile);
  if (perTarget !== null && perTarget > 1.5) {
    lines.push(`Rata-rata **${perTarget.toFixed(1)}** kasus per target`);
  }

  if (totals.firstCaseAt && totals.lastCaseAt) {
    lines.push(`Aktif <t:${toUnix(totals.firstCaseAt)}:d> → <t:${toUnix(totals.lastCaseAt)}:R>`);
  }

  lines.push(
    totals.recentCount > 0
      ? `${totals.recentCount} kasus dalam ${MODERATOR_ACTIVE_WINDOW_DAYS} hari terakhir`
      : `Tidak ada kasus dalam ${MODERATOR_ACTIVE_WINDOW_DAYS} hari terakhir`,
  );

  const failed = moderatorFailedTotal(profile);
  if (failed > 0) {
    lines.push(`⚠️ ${failed} kasus tercatat tapi aksi Discord-nya gagal dieksekusi`);
  }

  const revoked = moderatorRevokedTotal(profile);
  if (revoked > 0) {
    lines.push(`♻️ ${revoked} peringatan dicabut kembali`);
  }

  return lines;
}

/** Baris ringkas satu kasus untuk daftar "terbaru". */
export function moderatorCaseLine(record: ModerationCase, targetKind: TargetKind): string {
  const meta = ACTION_LABELS[record.type];
  const target = targetKind === 'channel' ? `<#${record.targetId}>` : `<@${record.targetId}>`;
  const state = record.active ? '' : record.type === 'warn' ? ' · *dicabut*' : ' · *gagal*';

  return (
    `\`${record.caseNumber}\` ${meta.emoji} ${meta.label} · ${target}` +
    ` · <t:${toUnix(record.createdAt)}:R>${state}`
  );
}

/** Target channel ditampilkan sebagai `<#id>`, selain itu `<@id>`. */
export type TargetKind = 'user' | 'channel';

/** Sama seperti `caseTargetKind`, tapi dihitung dari jenis aksi saja. */
export function moderatorTargetKind(type: ModerationAction): TargetKind {
  return CHANNEL_TARGET_ACTIONS.includes(type) ? 'channel' : 'user';
}

function toUnix(date: Date): number {
  return Math.floor(date.getTime() / 1_000);
}