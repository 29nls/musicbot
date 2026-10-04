import type { LogRetentionResult } from '../modules/logging/retention.js';
import type { RetentionResult } from '../modules/moderation/retention.js';
import type { StatRetentionResult } from '../modules/stats/retention.js';
import type { TicketRetentionResult } from '../modules/tickets/retention.js';
import { getLogger } from './logger.js';

/**
 * Satu definisi tunggal untuk keempat sapuan retensi.
 *
 * Kenapa berkas ini ada: daftar sapuan pernah ditulis dua kali, sekali di job
 * dalam proses dan sekali di skrip `npm run db:prune`. Dua daftar itu
 * berbeda, dan skripcron tidak pernah menyapu tiket maupun statistik
 * playback — padahal PRD §12 mengarahkan operator justru ke jalur cron itu.
 * Tidak ada yang gagal: yang hilang cuma satu atau dua angka dari laporan
 * JSON, dan kelihatannya bot sudah membersihkan semuanya.
 *
 * Karena itu keempat runner di sini **wajib ada**. Tidak ada opsi
 * "lewati kalau tidak diisi": opsi itulah yang membuat satu jalur bisa
 * kehilangan sapuan tanpa ada yang mengeluh.
 */

/** Sapuan kasus moderasi dan peringatan. */
export interface ModerationSweepRunner {
  purgeExpired(now?: Date): Promise<RetentionResult>;
}

/** Sapuan tiket tertutup beserta transkripnya. */
export interface TicketSweepRunner {
  purgeExpired(now?: Date): Promise<TicketRetentionResult>;
}

/** Sapuan statistik playback (tabel `playback_stat`, 90 hari). */
export interface StatsSweepRunner {
  purgeExpired(now?: Date): Promise<StatRetentionResult>;
}

/** Sapuan riwayat log (30 hari). */
export interface LogSweepRunner {
  purgeExpired(now?: Date): Promise<LogRetentionResult>;
}

export interface RetentionSweepLogger {
  debug(payload: unknown, message: string): void;
  info(payload: unknown, message: string): void;
  warn(payload: unknown, message: string): void;
}

export interface RetentionSweepDeps {
  moderation: ModerationSweepRunner;
  tickets: TicketSweepRunner;
  stats: StatsSweepRunner;
  logs: LogSweepRunner;
  /** Disuntik di tes; produksi memakai logger proses. */
  logger?: RetentionSweepLogger;
}

/**
 * Hasil keempat sapuan. `null` berarti sapuan itu sudah dicoba dan gagal,
 * bukan sapuan yang dilewatkan. Dua hal ini dibedakan supaya laporan cron bisa
 * menulis "gagal" alih-alih "tidak ada".
 */
export interface RetentionSweepSummary {
  moderation: RetentionResult;
  tickets: TicketRetentionResult | null;
  stats: StatRetentionResult | null;
  logs: LogRetentionResult | null;
}

/**
 * Jalankan keempat sapuan dalam satu siklus.
 *
 * Urutannya disengaja:
 * 1. kasus dan peringatan — kalau ini gagal, seluruh sapuan gagal, karena
 *    ini basis dari data yang lain;
 * 2. tiket — retensinya dihitung sejak ditutup, jadi basis waktunya sendiri;
 * 3. statistik playback — tidak pernah menggagalkan penghapusan yang lain;
 * 4. riwayat log — volumenya paling besar dan retensinya paling pendek,
 *    jadi diletakkan terakhir supaya satu kueri lambat tidak menahan yang lain.
 *
 * Sapuan 2 sampai 4 diisolasi: satu kegagalan tidak menghentikan yang lain.
 * Yang gagal dicatat sebagai peringatan, bukan dilempar, karena janji retensi
 * lebih penting daripada yang satu tabel.
 *
 * Kegagalan sapuan kasus sengaja tetap dilempar: pemanggil yang memanggil
 * ini butuh tahu kalau siklus itu tidak menghasilkan apa pun.
 */
export async function runRetentionSweeps(
  deps: RetentionSweepDeps,
  now = new Date(),
): Promise<RetentionSweepSummary> {
  const logger = deps.logger ?? getLogger();

  const moderation = await deps.moderation.purgeExpired(now);
  if (moderation.cases > 0 || moderation.warnings > 0) {
    logger.info(
      { cutoff: moderation.cutoff.toISOString(), cases: moderation.cases, warnings: moderation.warnings },
      'Retensi: kasus & peringatan kedaluwarsa dihapus',
    );
  } else {
    logger.debug(
      { cutoff: moderation.cutoff.toISOString() },
      'Retensi: tidak ada data kedaluwarsa',
    );
  }

  const tickets = await isolate(logger, 'tiket', () => deps.tickets.purgeExpired(now));
  if (tickets && tickets.ticketsDeleted > 0) {
    logger.info(
      { cutoff: tickets.cutoff.toISOString(), tickets: tickets.ticketsDeleted },
      'Retensi: tiket kedaluwarsa dihapus',
    );
  }

  const stats = await isolate(logger, 'statistik', () => deps.stats.purgeExpired(now));
  if (stats && stats.deleted > 0) {
    logger.info(
      { cutoff: stats.cutoff.toISOString(), deleted: stats.deleted },
      'Retensi: statistik playback lama dihapus',
    );
  }

  const logs = await isolate(logger, 'log', () => deps.logs.purgeExpired(now));
  if (logs && logs.logs > 0) {
    logger.info(
      { cutoff: logs.cutoff.toISOString(), logs: logs.logs },
      'Retensi: riwayat log kedaluwarsa dihapus',
    );
  }

  return { moderation, tickets, stats, logs };
}

/**
 * Jalankan satu sapuan sampingan tanpa menjatuhkan siklus kalau ia gagal.
 *
 * Mengembalikan `null` supaya pemanggil bisa membedakan "berhasil menghapus
 * nol baris" dari "tidak pernah mencoba", yang artinya sangat berbeda kalau
 * laporan ini dibaca cron atau oleh operator.
 */
async function isolate<T>(
  logger: RetentionSweepLogger,
  label: string,
  run: () => Promise<T>,
): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    logger.warn({ err: error }, `Retensi ${label} gagal — data lain tetap aman`);
    return null;
  }
}