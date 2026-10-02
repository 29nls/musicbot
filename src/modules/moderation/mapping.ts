import { isModerationAction, type ModerationCase, type WarningRecord } from './types.js';

/**
 * Bentuk baris DB yang dibutuhkan pemetaan. Didefinisikan lokal (bukan impor
 * tipe Prisma) supaya file ini bisa dites tanpa database.
 */
export interface ModerationCaseRow {
  id: number;
  caseNumber: number;
  guildId: string;
  type: string;
  targetId: string;
  moderatorId: string;
  reason: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  active: boolean;
}

export interface WarningRow {
  id: number;
  caseId: number;
  guildId: string;
  userId: string;
  moderatorId: string;
  reason: string | null;
  createdAt: Date;
  case: { caseNumber: number };
}

export function toCaseDomain(row: ModerationCaseRow): ModerationCase {
  return {
    ...row,
    // Baris dengan tipe tak dikenal (data lama/rusak) diperlakukan sebagai warn
    // supaya tampilan tidak error — tipe hanya dipakai untuk label.
    type: isModerationAction(row.type) ? row.type : 'warn',
  };
}

export function toWarningDomain(row: WarningRow): WarningRecord {
  return {
    id: row.id,
    caseId: row.caseId,
    caseNumber: row.case.caseNumber,
    guildId: row.guildId,
    userId: row.userId,
    moderatorId: row.moderatorId,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}
