import { DEFAULT_LOG_RETENTION_DAYS } from '@bot/modules/logging/types.js';
import { clampLogSummary } from '@bot/modules/logging/summary.js';

/**
 * Jejak audit perubahan konfigurasi (US-D4).
 *
 * **Ini menulis ke `log_entry` kategori `server`**, tabel yang sama dengan
 * `/logs`, bukan tabel baru. Tiga alasannya konkret:
 *
 * 1. Kalau tabelnya terpisah, `/logs` di Discord jadi tidak lengkap tepat di
 *    saat orang paling butuh jawaban "siapa yang mengubah ini" — yaitu
 *    setelah insiden moderasi.
 * 2. Retensi 30 hari dan jalur penghapusan data pribadi sudah ada di tabel itu.
 *    Tabel baru berarti harus membangun ulang keduanya, dan `/data-delete` akan
 *    punya dua jalur yang bisa berbeda.
 * 3. Kolomnya sudah cukup: `executor_id` untuk pelaku, `summary` untuk isi
 *    perubahan, `log_channel_id` untuk tempat embeznya dikirim.
 *
 * **`executorId` adalah user Discord, bukan bot.** Ini satu-satunya baris kode
 * yang membuatnya mudah salah: seluruh dashboard berjalan dengan token bot,
 * jadi `whoami` yang tersedia adalah Harmony. Kalau diisi ID bot, `/logs` akan
 * menampilkan "Harmony mengubah volume" padahal yang mengubah manusia. Itu
 * kebohongan audit, dan harus dicegah di lapisan ini — bukan dengan disiplin
 * pemanggil, tapi dengan mewajibkan caller meneruskan id user.
 *
 * **Yang tidak dilakukan di sini: mengirim embed ke channel log.** Dashboard
 * tidak punya koneksi gateway, jadi ia tidak bisa mengirim pesan. Yang terjadi
 * adalah baris `log_entry` dengan `logChannelId` terisi sehingga `/logs` bisa
 * memfilter dan catatan lama tetap bisa menemukan entri ini. Embed ke channel
 * log tetap menjadi urusan proses bot.
 */

const RETENTION_MS = DEFAULT_LOG_RETENTION_DAYS * 86_400_000;
const MAX_EVENT_KEY_LENGTH = 50;
const MAX_TITLE_LENGTH = 200;

/** Nama event untuk perubahan dari dashboard; muncul di filter `/logs`. */
export const CONFIG_CHANGED_EVENT_KEY = 'dashboardConfigChanged';

export interface AuditChange {
  /** Nama field konfigurasi yang berubah, mis. `defaultVolume`. */
  field: string;
  /** Nilai lama dalam bentuk yang bisa dibaca manusia (bukan JSON mentah). */
  before: string;
  /** Nilai baru; null berarti field dikosongkan. */
  after: string;
}

export interface AuditInput {
  guildId: string;
  /** ID Discord manusia yang menyelesaikan OAuth. Wajib, bukan opsional. */
  executorId: string;
  changes: readonly AuditChange[];
  /** Channel tujuan log dari konfigurasi, kalau ada. */
  logChannelId: string | null;
  /** Waktu berubah; disuntik agar tesnya tidak bergantung pada jam. */
  now?: Date;
}

export interface AuditResult {
  recorded: boolean;
  entryId?: number;
  reason?: string;
}

/** Bentuk satu baris `log_entry` yang ditulis dashboard. */
export interface AuditRowData {
  guildId: string;
  category: string;
  eventKey: string;
  title: string;
  summary: string;
  executorId: string;
  targetId: null;
  channelId: null;
  logChannelId: string | null;
  caseId: null;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Klien Prisma secukupnya untuk menulis satu baris audit.
 *
 * Sengaja hanya `logEntry.create`, dan datanya bertipe konkret: pemanggil boleh
 * mengirim klien transaksi (`prisma.$transaction`) supaya `guild_config` dan
 * `log_entry` commit bersama. Kalau tipe ini `PrismaClient` penuh, transaksi
 * tidak akan ikut, karena objek transaksi bukan instance `PrismaClient`.
 */
export interface LogEntryWriter {
  logEntry: {
    create(args: { data: AuditRowData; select: { id: true } }): Promise<{ id: number }>;
  };
}

/** Ringkasan satu baris per perubahan: `field: sebelum → sesudah`. */
export function buildAuditSummary(changes: readonly AuditChange[]): string {
  return changes
    .map((change) => `${change.field}: ${change.before} → ${change.after}`)
    .join('; ');
}

/**
 * Simpan entri audit.
 *
 * **Best-effort, tapi tidak ditelan diam-diam.** Gagal menulis audit berarti
 * perubahan tetap sudah terjadi, jadi membatalkan penulisan akan lebih buruk
 * daripada mencatat bahwa jejaknya hilang. Yang dilakukan: kembalikan
 * `recorded: false` beserta sebabnya, dan route menampilkan peringatan di
 * halaman hasil. Kalau audit gagal diam-diam, orang mengira perubahannya
 * tercatat padahal tidak.
 *
 * `category` dipaksa `'server'`: perubahan konfigurasi memang kategori itu,
 * dan membiarkan pemanggil memilih kategori akan memungkinkan entri audit
 * dashboard muncul di `/logs` sebagai ban atau pengumuman.
 */
export async function recordConfigAudit(
  prisma: LogEntryWriter,
  input: AuditInput,
): Promise<AuditResult> {
  if (input.changes.length === 0) {
    return { recorded: false, reason: 'tidak ada perubahan untuk dicatat' };
  }

  const createdAt = input.now ?? new Date();
  const summary = buildAuditSummary(input.changes);
  const title = 'Konfigurasi bot diubah lewat dashboard';

  try {
    const row = await prisma.logEntry.create({
      data: {
        guildId: input.guildId,
        category: 'server',
        eventKey: CONFIG_CHANGED_EVENT_KEY,
        title: title.slice(0, MAX_TITLE_LENGTH),
        summary: clampLogSummary(summary),
        executorId: input.executorId,
        targetId: null,
        channelId: null,
        logChannelId: input.logChannelId,
        caseId: null,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + RETENTION_MS),
      },
      select: { id: true },
    });

    return { recorded: true, entryId: row.id };
  } catch (error) {
    return {
      recorded: false,
      reason: error instanceof Error ? error.message : 'alasan tidak diketahui',
    };
  }
}

/** Event key dipotong; dipakai kalau nama event dari luar perlu diseragamkan. */
export function normalizeEventKey(value: string): string {
  return value.slice(0, MAX_EVENT_KEY_LENGTH);
}