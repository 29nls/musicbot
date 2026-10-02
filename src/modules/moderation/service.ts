import { getLogger } from '../../services/logger.js';
import {
  buildModeratorProfile,
  MODERATOR_ACTIVE_WINDOW_DAYS,
  MODERATOR_PROFILE_RECENT_LIMIT,
  type ModeratorProfile,
} from './modProfile.js';
import {
  buildPriorCaseSummary,
  PRIOR_CASE_HINT_LIMIT,
  type PriorCaseSummary,
} from './priorCases.js';
import { purgeExpiredRecords, type RetentionResult } from './retention.js';
import type { ModerationRepository } from './repository.js';
import type { CreateCaseInput, DmStatus, ModerationCase, WarningRecord } from './types.js';

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

  /** Satu kasus berdasarkan nomornya; null kalau tidak ada di server ini. */
  async findCase(guildId: string, caseNumber: number): Promise<ModerationCase | null> {
    return this.repository.findCaseByNumber(guildId, caseNumber);
  }

  /**
   * Kasus lain atas target yang sama (riwayat singkat member/channel).
   * `take` dikontrol pemanggil supaya embed tidak meledak.
   */
  async listTargetCases(
    guildId: string,
    targetId: string,
    options: { excludeCaseNumber?: number; take: number },
  ): Promise<ModerationCase[]> {
    return this.repository.listCasesForTarget(guildId, targetId, options);
  }

  /** Cabut warning berdasarkan nomor kasus; null kalau kasus tidak ditemukan. */
  async revokeWarning(guildId: string, caseNumber: number): Promise<ModerationCase | null> {
    return this.repository.revokeWarning(guildId, caseNumber);
  }

/**
 * Catat hasil pengiriman DM ke target pada kasusnya.
 *
 * Best-effort: kegagalan menulis status tidak boleh menggagalkan aksi yang
 * sudah berhasil. Kasus sudah tercatat dan DM-nya sudah terkirim atau gagal;
 * status ini hanya untuk ditampilkan di `/case`.
 */
  async recordDmStatus(guildId: string, caseNumber: number, dmStatus: DmStatus): Promise<boolean> {
    try {
      await this.repository.setCaseDmStatus(guildId, caseNumber, dmStatus);

      return true;
    } catch (error) {
      getLogger().warn({ err: error, guildId, caseNumber }, 'Gagal menyimpan status DM kasus');

      return false;
    }
  }

  /**
 * Rangkai seluruh aktivitas satu moderator jadi satu profil.
   *
   * Tiga pembacaan (sebaran jenis, angka besar, kasus terbaru) berjalan
   * bersamaan karena tidak saling bergantung — menggabungkan dengan `groupBy`
   * tunggal justru memaksa database melakukan pekerjaan berulang.
   *
   * Moderator tanpa kasus tetap mengembalikan profil dengan total 0, bukan
   * `null`: "belum pernah punya kasus" adalah jawaban yang valid, bukan kondisi
   * error, dan pemanggil tidak boleh shaming dengan pesan "tidak ditemukan".
   */
  async moderatorProfile(
    guildId: string,
    moderatorId: string,
    now = new Date(),
  ): Promise<ModeratorProfile> {
    const recentSince = new Date(
      now.getTime() - MODERATOR_ACTIVE_WINDOW_DAYS * 86_400_000,
    );

    const [actionRows, totals, recentCases] = await Promise.all([
      this.repository.countByTypeAndActive(guildId, moderatorId),
      this.repository.summarizeModerator(guildId, moderatorId, recentSince),
      this.repository.listCasesByModerator(
        guildId,
        moderatorId,
        MODERATOR_PROFILE_RECENT_LIMIT,
      ),
    ]);

    return buildModeratorProfile({ moderatorId, actionRows, totals, recentCases });
  }

  /**
   * Riwayat singkat target untuk dilampirkan di balasan aksi.
   *
   * Tiga pembacaan berjalan bersamaan: agregat per jenis aksi (seluruh riwayat),
   * kasus terbaru (yang dirinci), dan jumlah peringatan aktif. Semuanya punya
   * sumber berbeda supaya tidak bisa saling menutupi kesalahan.
   *
   * `excludeCaseNumber` dipakai agar kasus yang sedang dibuat tidak ikut
   * terhitung sebagai riwayat — tanpa itu setiap ban akan melaporkan dirinya
   * sendiri sebagai "pernah di-ban sebelumnya".
   */
  async priorCaseSummary(
    guildId: string,
    targetId: string,
    excludeCaseNumber?: number,
  ): Promise<PriorCaseSummary> {
    const [actionRows, recentCases, warnings] = await Promise.all([
      this.repository.countTargetByTypeAndActive(guildId, targetId, excludeCaseNumber),
      this.repository.listCasesForTarget(guildId, targetId, {
        excludeCaseNumber,
        take: PRIOR_CASE_HINT_LIMIT,
      }),
      this.repository.countWarnings(guildId, targetId),
    ]);

    return buildPriorCaseSummary({ targetId, actionRows, recentCases, activeWarnings: warnings });
  }

  /** Tandai kasus tidak aktif (mis. aksi Discord-nya gagal dieksekusi). */
  async deactivateCase(guildId: string, caseNumber: number): Promise<void> {
    await this.repository.setCaseActive(guildId, caseNumber, false);
  }

  /**
   * Bersihkan kasus & peringatan yang lewat retensi 12 bulan (PRD Bab 12).
   * Dipanggil job terjadwal; error dibiarkan lempar supaya pemanggil mencatatnya.
   */
  async purgeExpired(now = new Date()): Promise<RetentionResult> {
    return purgeExpiredRecords(this.repository, now);
  }
}
