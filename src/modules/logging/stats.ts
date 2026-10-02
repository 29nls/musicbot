import { ACTION_LABELS, isModerationAction } from '../moderation/types.js';
import {
  DEFAULT_LOG_RETENTION_DAYS,
  LOG_CATEGORIES,
  type LogCategory,
  type LogSearchFilter,
} from './types.js';

/** Berapa banyak entri yang ditampilkan di daftar "aksi teratas". */
export const STATS_TOP_ACTIONS = 5;

/** Berapa banyak member yang ditampilkan di daftar "paling sering terkait". */
export const STATS_TOP_MEMBERS = 5;

/** Panjang batang proporsi dalam karakter blok. */
export const STATS_BAR_WIDTH = 10;

/**
 * Kategori yang `targetId`-nya benar-benar sebuah member.
 *
 * Kategori `channel` & `role` menyimpan ID channel/role di kolom yang sama,
 * jadi ikut di peringkat akan menampilkan `<@id>` yang bukan orang.
 */
export const MEMBER_TARGET_CATEGORIES: readonly LogCategory[] = ['member', 'message', 'voice'];

/** Satu hasil `groupBy` — jumlah entri untuk sebuah kunci. */
export interface LogCountRow {
  key: string;
  count: number;
}

/** Baris `groupBy` target: satu baris per pasangan (target, kategori). */
export interface MemberTargetRow {
  key: string;
  category: string;
  count: number;
}

export interface LogCategoryStat {
  category: LogCategory;
  count: number;
}

export interface LogActionStat {
  eventKey: string;
  count: number;
}

export interface LogMemberStat {
  userId: string;
  /** Entri yang menyebut member ini, sebagai target maupun executor. */
  count: number;
  asTarget: number;
  asExecutor: number;
}

/** Ringkasan `/logs … stats:true` untuk satu periode. */
export interface LogStats {
  total: number;
  /** Selalu berisi enam kategori; kategori tanpa entri bernilai 0. */
  categories: LogCategoryStat[];
  topActions: LogActionStat[];
  topMembers: LogMemberStat[];
}

export interface LogStatsInput {
  categories: readonly LogCountRow[];
  actions: readonly LogCountRow[];
  targets: readonly LogCountRow[];
  executors: readonly LogCountRow[];
  /**
   * Entri saat target dan executor adalah member yang sama (aksi pada diri
   * sendiri), dikunci per member. Tanpa ini member tersebut terhitung dua kali.
   */
  selfActions?: readonly LogCountRow[];
  topActions?: number;
  topMembers?: number;
}

export function isMemberTargetCategory(category: string): category is LogCategory {
  return (MEMBER_TARGET_CATEGORIES as readonly string[]).includes(category);
}

/**
 * Gabungkan baris target per kategori menjadi satu baris per member.
 *
 * `groupBy(['targetId', 'category'])` memisahkan satu member yang jadi target
 * di beberapa kategori, jadi jumlahnya harus dijumlahkan lagi. Target dari
 * kategori non-member (ID channel/role) dibuang di sini.
 */
export function toMemberTargetRows(rows: readonly MemberTargetRow[]): LogCountRow[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (!row.key || !isMemberTargetCategory(row.category)) continue;
    totals.set(row.key, (totals.get(row.key) ?? 0) + row.count);
  }

  return [...totals].map(([key, count]) => ({ key, count }));
}

/**
 * Gabungkan hasil `groupBy` mentah menjadi statistik siap tampil.
 *
 * Murni: seluruh perhitungan ada di sini supaya bisa diuji tanpa database.
 * Kunci yang tidak dikenal (mis. kategori rusak di database) diabaikan di
 * tabel per kategori, tapi tetap ikut menambah total supaya angka tidak
 * terlihat lebih kecil dari kenyataan.
 */
export function summarizeLogStats(input: LogStatsInput): LogStats {
  const counts = countByKey(input.categories);

  return {
    total: input.categories.reduce((sum, row) => sum + row.count, 0),
    categories: LOG_CATEGORIES.map((category) => ({ category, count: counts.get(category) ?? 0 })),
    topActions: topActions(input.actions, input.topActions ?? STATS_TOP_ACTIONS),
    topMembers: topMembers(
      input.targets,
      input.executors,
      input.selfActions ?? [],
      input.topMembers ?? STATS_TOP_MEMBERS,
    ),
  };
}

/** Periode statistik: batas simpan riwayat bila user tidak menyebut `from`. */
export interface LogStatsPeriod {
  from: Date;
  to: Date;
  /** true = `from` diisi otomatis karena user tidak memberi rentang. */
  defaulted: boolean;
}

/**
 * Tentukan periode statistik dari filter `/logs`.
 *
 * Tanpa `from`, statistik dibatasi ke masa simpan riwayat — bukan "selama ini".
 * Hasilnya jauh lebih ringan diproses, dan angka yang ditampilkan jujur
 * mencerminkan data yang benar-benar masih ada.
 */
export function statsPeriod(filter: LogSearchFilter, now = new Date()): LogStatsPeriod {
  const from = filter.from ?? new Date(now.getTime() - DEFAULT_LOG_RETENTION_DAYS * 86_400_000);

  return { from, to: filter.to ?? now, defaulted: filter.from === null };
}

/**
 * Adakah user yang muncul sebagai target sekaligus executor?
 *
 * Kalau tidak ada,repository bisa melewati query tablas silang yang berat.
 */
export function memberIdsOverlap(
  targets: readonly LogCountRow[],
  executors: readonly LogCountRow[],
): boolean {
  if (targets.length === 0 || executors.length === 0) return false;

  const ids = new Set(targets.map((row) => row.key));
  return executors.some((row) => ids.has(row.key));
}

/** Label ramah untuk `eventKey`; kunci tak dikenal ditampilkan apa adanya. */
export function eventKeyLabel(eventKey: string): string {
  if (eventKey.startsWith('moderation.')) {
    const action = eventKey.slice('moderation.'.length);
    return isModerationAction(action) ? ACTION_LABELS[action].label : `Aksi ${action}`;
  }

  return EVENT_LABELS[eventKey] ?? eventKey;
}

/** Emoji kecil untuk `eventKey`, dipakai daftar aksi teratas. */
export function eventKeyEmoji(eventKey: string): string {
  if (eventKey.startsWith('moderation.')) {
    const action = eventKey.slice('moderation.'.length);
    return isModerationAction(action) ? ACTION_LABELS[action].emoji : '⚙️';
  }

  return EVENT_EMOJIS[eventKey] ?? '•';
}

/** Label keputusan event Discord (22 event yang dilingkupi Harmony). */
const EVENT_LABELS: Record<string, string> = {
  guildBanAdd: 'Member di-ban',
  guildBanRemove: 'Ban dilepas',
  guildMemberAdd: 'Member bergabung',
  guildMemberRemove: 'Member keluar',
  guildMemberUpdate: 'Member diperbarui',
  messageDelete: 'Pesan dihapus',
  messageUpdate: 'Pesan diedit',
  messageBulkDelete: 'Pesan dihapus massal',
  channelCreate: 'Channel dibuat',
  channelDelete: 'Channel dihapus',
  channelUpdate: 'Channel diperbarui',
  guildRoleCreate: 'Role dibuat',
  guildRoleDelete: 'Role dihapus',
  guildRoleUpdate: 'Role diperbarui',
  voiceStateUpdate: 'Perubahan voice',
  guildUpdate: 'Server diperbarui',
  guildEmojiCreate: 'Emoji ditambahkan',
  guildEmojiUpdate: 'Emoji diubah',
  guildEmojiDelete: 'Emoji dihapus',
  guildStickerCreate: 'Stiker ditambahkan',
  guildStickerUpdate: 'Stiker diubah',
  guildStickerDelete: 'Stiker dihapus',
};

const EVENT_EMOJIS: Record<string, string> = {
  guildBanAdd: '🔨',
  guildBanRemove: '🔓',
  guildMemberAdd: '📥',
  guildMemberRemove: '📤',
  guildMemberUpdate: '✏️',
  messageDelete: '🗑️',
  messageUpdate: '💭',
  messageBulkDelete: '🧹',
  channelCreate: '➕',
  channelDelete: '➖',
  channelUpdate: '✏️',
  guildRoleCreate: '➕',
  guildRoleDelete: '➖',
  guildRoleUpdate: '✏️',
  voiceStateUpdate: '🔊',
  guildUpdate: '🏠',
  guildEmojiCreate: '➕',
  guildEmojiUpdate: '✏️',
  guildEmojiDelete: '➖',
  guildStickerCreate: '➕',
  guildStickerUpdate: '✏️',
  guildStickerDelete: '➖',
};

/** Persentase bulat; total 0 menghasilkan "0%". */
export function formatShare(count: number, total: number): string {
  if (total <= 0) return '0%';
  return `${Math.round((count / total) * 100)}%`;
}

/** Batang proporsi blok, mis. `██████░░░░` untuk 6 dari 10. */
export function statsBar(count: number, max: number, width = STATS_BAR_WIDTH): string {
  if (max <= 0 || width <= 0) return '';
  if (count <= 0) return '░'.repeat(width);

  // `Math.max(1, …)` supaya entri terkecil di daftar teratas tetap terlihat.
  const filled = Math.max(1, Math.min(width, Math.round((count / max) * width)));

  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

function countByKey(rows: readonly LogCountRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.key) continue;
    counts.set(row.key, (counts.get(row.key) ?? 0) + row.count);
  }

  return counts;
}

function topActions(rows: readonly LogCountRow[], limit: number): LogActionStat[] {
  return rankRows(rows)
    .slice(0, Math.max(0, limit))
    .map((row) => ({ eventKey: row.key, count: row.count }));
}

function topMembers(
  targets: readonly LogCountRow[],
  executors: readonly LogCountRow[],
  selfActions: readonly LogCountRow[],
  limit: number,
): LogMemberStat[] {
  const totals = new Map<string, LogMemberStat>();

  const bucket = (userId: string): LogMemberStat => {
    const existing = totals.get(userId);
    if (existing) return existing;

    const created: LogMemberStat = { userId, count: 0, asTarget: 0, asExecutor: 0 };
    totals.set(userId, created);
    return created;
  };

  for (const row of targets) {
    if (!row.key) continue;
    const entry = bucket(row.key);
    entry.asTarget += row.count;
    entry.count += row.count;
  }

  for (const row of executors) {
    if (!row.key) continue;
    const entry = bucket(row.key);
    entry.asExecutor += row.count;
    entry.count += row.count;
  }

  // Aksi pada diri sendiri sudah masuk `asTarget` sekaligus `asExecutor`;
  // untuk peringkat "sering terkait" entri itu harus dihitung satu kali.
  for (const row of selfActions) {
    if (!row.key) continue;
    const entry = totals.get(row.key);
    if (entry) entry.count -= row.count;
  }

  return [...totals.values()]
    .filter((entry) => entry.count > 0)
    .sort((a, b) => (a.count !== b.count ? b.count - a.count : compareText(a.userId, b.userId)))
    .slice(0, Math.max(0, limit));
}

/** Urut jumlah turun, lalu kunci menaik supaya hasilnya stabil. */
function rankRows(rows: readonly LogCountRow[]): LogCountRow[] {
  return rows
    .filter((row) => row.key.length > 0 && row.count > 0)
    .map((row) => ({ ...row }))
    .sort(compareByCountThenKey);
}

function compareByCountThenKey(a: LogCountRow, b: LogCountRow): number {
  if (a.count !== b.count) return b.count - a.count;
  return compareText(a.key, b.key);
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
