import { defaultTranslator, type MessageKey, type Translator } from '../i18n/index.js';

/** Aksi moderasi yang dicatat sebagai kasus di database. */
export const MODERATION_ACTIONS = [
  'ban',
  'kick',
  'timeout',
  'warn',
  'unban',
  'slowmode',
  'lock',
  'unlock',
  'note',
] as const;

export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

/** Aksi terhadap user yang selalu mengirim DM ke target. */
export const NOTIFIABLE_ACTIONS = ['ban', 'kick', 'timeout', 'warn', 'unban'] as const;

export type NotifiableAction = (typeof NOTIFIABLE_ACTIONS)[number];

/**
 * Hasil pengiriman DM ke target.
 *
 * String union, bukan boolean: boolean nullable tidak bisa membedakan "aksi ini
 * memang tidak mengirim DM" dari "statusnya belum tercatat", sedangkan kedua
 * hal itu perlu dibedakan di halaman `/case`.
 */
export const DM_STATUSES = ['sent', 'failed'] as const;

export type DmStatus = (typeof DM_STATUSES)[number];

export function isDmStatus(value: string): value is DmStatus {
  return (DM_STATUSES as readonly string[]).includes(value);
}

export function isModerationAction(value: string): value is ModerationAction {
  return (MODERATION_ACTIONS as readonly string[]).includes(value);
}

/** Satu aksi moderasi — bentuk domain, bukan bentuk baris DB. */
export interface ModerationCase {
  id: number;
  /** Nomor kasus unik per server; ditampilkan sebagai `#CASE-0142`. */
  caseNumber: number;
  guildId: string;
  type: ModerationAction;
  targetId: string;
  moderatorId: string;
  reason: string | null;
  createdAt: Date;
  /** Kapan aksi berakhir (mis. timeout); null untuk aksi permanen. */
  expiresAt: Date | null;
  active: boolean;
  /**
   * Hasil DM ke target; null kalau aksi ini tidak mengirim DM, atau kasusnya
   * dibuat sebelum kolom ini ada.
   */
  dmStatus: DmStatus | null;
}

/** Peringatan yang bisa dilihat lewat `/warnings` dan dicabut lewat `/unwarn`. */
export interface WarningRecord {
  id: number;
  caseId: number;
  caseNumber: number;
  guildId: string;
  userId: string;
  moderatorId: string;
  reason: string | null;
  createdAt: Date;
}

export interface CreateCaseInput {
  guildId: string;
  type: ModerationAction;
  targetId: string;
  moderatorId: string;
  reason: string | null;
  expiresAt?: Date | null;
}

export interface CreateWarningInput {
  caseId: number;
  guildId: string;
  userId: string;
  moderatorId: string;
  reason: string | null;
}

/**
 * Emoji aksi — ikon, bukan kalimat, jadi tidak pernah diterjemahkan.
 */
const ACTION_EMOJIS: Record<ModerationAction, string> = {
  ban: '🔨',
  kick: '👢',
  timeout: '⏳',
  warn: '⚠️',
  unban: '🔓',
  slowmode: '🐌',
  lock: '🔒',
  unlock: '🔑',
  note: '📝',
};

/**
 * Kunci katalog untuk label yang memang berbeda antar bahasa.
 *
 * Hanya `note`: `Ban`, `Kick`, `Timeout`, `Warn`, `Unban`, `Slowmode`,
 * `Lock`, dan `Unlock` adalah istilah yang sama di kedua bahasa, dan
 * menerjemahkannya hanya membuat moderator harus mencari kata berbeda untuk
 * hal yang sama. `Catatan` menjadi `Note`.
 */
const ACTION_LABEL_KEYS: Partial<Record<ModerationAction, MessageKey>> = {
  note: 'mod.action.note',
};

/** Label aksi dalam bahasa yang diminta. */
export function actionLabel(
  action: ModerationAction,
  t: Translator = defaultTranslator,
): string {
  const key = ACTION_LABEL_KEYS[action];

  // Aksi tanpa kunci katalog tetap tampil sebagai label kapital — `ban` adalah
  // nilai enum, sedangkan yang tampil ke moderator adalah kata di awal baris.
  return key ? t(key) : action.charAt(0).toUpperCase() + action.slice(1);
}

/** Emoji aksi; tidak pernah diterjemahkan. */
export function actionEmoji(action: ModerationAction): string {
  return ACTION_EMOJIS[action];
}

/**
 * Urutan stabil untuk mengurutkan jenis aksi dengan jumlah sama.
 *
 * Semula ini mengurutkan lewat `localeCompare` pada label. Setelah label
 * bisa diterjemahkan, itu berarti **urutan daftar ikut berubah kalau
 * bahasanya diganti** — data yang sama jadi terbaca berbeda, dan moderator
 * yang membandingkan dua embed tidak bisa menemukan baris yang sama.
 * Jadi urutannya berdasarkan nama aksi, yang sama di semua bahasa.
 */
export function compareActions(a: ModerationAction, b: ModerationAction): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Batas keras Discord untuk timeout: 28 hari. */
export const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1_000;

/** Batas jumlah pesan per `/purge` (batas API Discord). */
export const MAX_PURGE_COUNT = 100;

/** Batas jumlah catatan internal yang ditampilkan `/note show`. */
export const MAX_NOTES_SHOWN = 10;

/** Jumlah baris warning yang ditampilkan `/warnings` dalam satu embed. */
export const MAX_WARNINGS_SHOWN = 10;

/** Panjang maksimum alasan di kolom database. */
export const MAX_REASON_LENGTH = 1_000;
