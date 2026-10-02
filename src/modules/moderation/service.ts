import type { ModerationRepository } from './repository.js';
import type { CreateCaseInput, ModerationCase, WarningRecord } from './types.js';

export interface WarningSummary {
  warnings: WarningRecord[];
  total: number;
}

/**
 * Logika domain moderasi: pencatatan kasus, warning, dan pencabutannya.
 * Tidak tahu apa-apa soal Discord — eksekusi aksi (ban/kick/dll.) ada di
 * lapisan perintah.
 */
export class ModerationService {
  constructor(private readonly repository: ModerationRepository) {}

  /** Catat aksi moderasi dan kembalikan kasusnya (termasuk nomor kasus). */
  async recordAction(input: CreateCaseInput): Promise<ModerationCase> {
    return this.repository.createCase(input);
  }

  /** Catat warn: satu kasus + satu baris warning yang saling terhubung. */
  async recordWarning(
    input: Omit<CreateCaseInput, 'type' | 'expiresAt'>,
  ): Promise<{ case: ModerationCase; warning: WarningRecord }> {
    const created = await this.repository.createCase({ ...input, type: 'warn', expiresAt: null });
    const warning = await this.repository.createWarning({
      caseId: created.id,
      guildId: input.guildId,
      userId: input.targetId,
      moderatorId: input.moderatorId,
      reason: input.reason,
    });

    return { case: created, warning };
  }

  async listWarnings(guildId: string, userId: string): Promise<WarningSummary> {
    const [warnings, total] = await Promise.all([
      this.repository.listWarnings(guildId, userId),
      this.repository.countWarnings(guildId, userId),
    ]);

    return { warnings, total };
  }

  /** Catatan internal terbaru satu user (untuk `/note show`). */
  async listNotes(guildId: string, userId: string): Promise<ModerationCase[]> {
    return this.repository.listNotes(guildId, userId);
  }

  /** Cabut warning berdasarkan nomor kasus; null kalau kasus tidak ditemukan. */
  async revokeWarning(guildId: string, caseNumber: number): Promise<ModerationCase | null> {
    return this.repository.revokeWarning(guildId, caseNumber);
  }

  /** Tandai kasus tidak aktif (mis. aksi Discord-nya gagal dieksekusi). */
  async deactivateCase(guildId: string, caseNumber: number): Promise<void> {
    await this.repository.setCaseActive(guildId, caseNumber, false);
  }
}
