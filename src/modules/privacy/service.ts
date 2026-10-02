import { getLogger } from '../../services/logger.js';
import type { LoggingRepository } from '../logging/repository.js';
import type { ModerationRepository } from '../moderation/repository.js';
import type { TicketRepository } from '../tickets/repository.js';
import {
  emptyAnonymizeOutcome,
  pseudonymFor,
  REASON_ANONYMIZED_MARKER,
  SUBJECT_ANONYMIZED_MARKER,
  type AnonymizeOutcome,
} from './anonymize.js';
import { buildInventory, type DataInventory } from './inventory.js';

/** Repository yang dipakai service ini — dipisah supaya bisa diganti fake di tes. */
export interface PrivacyRepositories {
  moderation: Pick<
    ModerationRepository,
    'countTargetByTypeAndActive' | 'countWarnings' | 'anonymizeTarget'
  >;
  tickets: Pick<TicketRepository, 'countByOpener' | 'anonymizeOpener'>;
  logging: Pick<LoggingRepository, 'countAboutUser' | 'deleteAboutUser'>;
}

/**
 * Privasi data member (PRD Bab 12).
 *
 * Menyatukan tiga modul sekaligus karena satu permintaan penghapusan menyentuh
 * ketiganya: kalau hanya salah satu yang dibersihkan, member tetap bisa
 * ditelusuri lewat data yang tidak ikut terhapus — dan GDPR-style "hapus data
 * saya" yang setengah jadi lebih buruk daripada yang tidak ada, karena member
 * akan mengira selesai.
 */
export class PrivacyService {
  constructor(private readonly repositories: PrivacyRepositories) {}

  /**
   * Apa yang disimpan Harmony tentang member ini di server ini.
   *
   * Lima pembacaan berjalan bersamaan: satu per kelompok data, plus satu
   * pembacaan agregat kasus. Semuanya pada indeks yang sudah ada, jadi
   * inventaris ini tidak memindai tabel yang lebih besar dari yang dijawab.
   */
  async inventory(guildId: string, userId: string): Promise<DataInventory> {
    // Pseudonim ikut dicocokkan supaya permintaan sebelumnya tidak dilaporkan
    // sebagai "tidak ada data" padahal barisnya masih ada dalam bentuk anonim.
    const pseudonym = pseudonymFor(guildId, userId);

    const [actionRows, activeWarnings, tickets, logEntries] = await Promise.all([
      this.repositories.moderation.countTargetByTypeAndActive(guildId, userId),
      this.repositories.moderation.countWarnings(guildId, userId),
      this.repositories.tickets.countByOpener(guildId, userId),
      this.repositories.logging.countAboutUser(guildId, userId, pseudonym),
    ]);

    return buildInventory({
      guildId,
      userId,
      actionRows,
      activeWarnings,
      tickets: tickets.tickets,
      ticketTranscripts: tickets.transcripts,
      logEntries,
    });
  }

  /**
   * Lepas data pribadi member atas permintaannya sendiri.
   *
   * Yang dibuang: identitas (ID target, pembuka tiket, penyebut di log),
   * alasan kasus, catatan internal, topik tiket, dan isi transkrip.
   * Yang tetap ada: kerangka kasusnya — tipe aksi, kapan terjadi, moderator
   * mana yang bertindak — supaya keputusan moderasi berikutnya tidak berjalan
   * tanpa konteks.
   *
   * Urutannya penting: kasus dianonimkan lebih dulu, baru tiket, baru log.
   * Kalau salah satu gagal, dua yang sudah berhasil tidak dibatalkan, dan
   * kegagalannya dilempar supaya pemanggil bisa mengatakannya apa adanya —
   * melaporkan "selesai" sementara masih ada data yang tersisa adalah kesalahan
   * yang paling merusak kepercayaan pada perintah ini.
   */
  async anonymize(guildId: string, userId: string): Promise<AnonymizeOutcome> {
    const pseudonym = pseudonymFor(guildId, userId);
    const outcome = emptyAnonymizeOutcome(pseudonym);

    const cases = await this.repositories.moderation.anonymizeTarget(
      guildId,
      userId,
      pseudonym,
      REASON_ANONYMIZED_MARKER,
    );
    outcome.cases = cases.cases;
    outcome.warnings = cases.warnings;

    const tickets = await this.repositories.tickets.anonymizeOpener(
      guildId,
      userId,
      pseudonym,
      SUBJECT_ANONYMIZED_MARKER,
    );
    outcome.tickets = tickets.tickets;
    outcome.transcripts = tickets.transcripts;

    // Log dihapus terakhir karena tidak ada yang bergantung padanya.
    outcome.logEntries = await this.repositories.logging.deleteAboutUser(
      guildId,
      userId,
      pseudonym,
    );

    getLogger().info(
      {
        guildId,
        pseudonym,
        cases: outcome.cases,
        warnings: outcome.warnings,
        tickets: outcome.tickets,
        transcripts: outcome.transcripts,
        logEntries: outcome.logEntries,
      },
      'Permintaan penghapusan data anonimasi',
    );

    return outcome;
  }
}
