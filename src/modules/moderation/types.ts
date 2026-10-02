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

export const ACTION_LABELS: Record<ModerationAction, { label: string; emoji: string }> = {
  ban: { label: 'Ban', emoji: '🔨' },
  kick: { label: 'Kick', emoji: '👢' },
  timeout: { label: 'Timeout', emoji: '⏳' },
  warn: { label: 'Warn', emoji: '⚠️' },
  unban: { label: 'Unban', emoji: '🔓' },
  slowmode: { label: 'Slowmode', emoji: '🐌' },
  lock: { label: 'Lock', emoji: '🔒' },
  unlock: { label: 'Unlock', emoji: '🔑' },
  note: { label: 'Catatan', emoji: '📝' },
};

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
