import type { KeyValueStore } from '@bot/services/kvStore.js';
import { log } from './log.js';

/**
 * Penghitung metrik dashboard (PRD §4.5).
 *
 * Dua angka yang diminta PRD:
 *
 * - `harmony_dashboard_writes_total` — setiap penulisan yang berhasil.
 * - `harmony_dashboard_write_denied_total` — setiap penolakan penulisan,
 *   alasan apa pun (izin, rate limit, nilai tidak valid, origin salah).
 *
 * **Kenapa di penyimpanan bersama, bukan penghitung in-process.** Alasan
 * yang sama dengan rate limit: penghitung di memori proses Next.js
 * hilang saat restart dan tidak terlihat oleh instance lain. Angka
 * yang hilang lebih buruk daripada tidak ada angka, karena operator
 * akan menyimpulkan "nol penolakan" padahal yang terjadi adalah "tidak
 * terhitung". `increment` tanpa `ttlMs` tidak kedaluwarsa, jadi angka
 * ini bertahan melewati restart dan dijumlahkan lintas instance.
 *
 * **Pencacahan terbaik-usaha (best-effort), dan itu disengaja.**
 * Metrik adalah pelengkap, bukan bagian dari kontrak penulisan. Kalau
 * Redis sedang mati, penulisan sudah ditolak lebih dulu lewat D3
 * (kanal bersama mati), jadi kegagalan `increment` di sini hanya
 * terjadi pada kegagalan sesaat setelah kanal dipastikan hidup.
 * Yang terjadi saat itu: satu angka tidak bertambah, peringatan di
 * log, permintaan tetap dilayani. Membatalkan penulisan yang sah
 * karena metrik gagal menukar masalah kecil dengan yang besar.
 *
 * **Tidak ada data pribadi.** Kuncinya global, bukan per guild atau
 * per user. Tidak ada ID, tidak ada nama, tidak ada nilai konfigurasi —
 * karena itu `/api/health` boleh menampilkannya tanpa autentikasi.
 */

/** Kunci penghitung di penyimpanan bersama. Tanpa TTL: tidak kedaluwarsa. */
const WRITES_TOTAL_KEY = 'harmony:dashboard:writes:total';
const WRITE_DENIED_TOTAL_KEY = 'harmony:dashboard:writeDenied:total';

/** Nama metrik gaya Prometheus, sebagaimana tertulis di PRD §4.5. */
export const METRIC_WRITES_TOTAL = 'harmony_dashboard_writes_total';
export const METRIC_WRITE_DENIED_TOTAL = 'harmony_dashboard_write_denied_total';

export interface DashboardMetrics {
  /** Jumlah penulisan berhasil sejak penghitung dibuat. */
  writesTotal: number;
  /** Jumlah penolakan penulisan sejak penghitung dibuat. */
  writeDeniedTotal: number;
}

/**
 * Naikkan satu penghitung, jangan pernah lempar.
 *
 * Kegagalan dicatat di log dengan level `warn` — bukan `error`, karena
 * satu penghitung yang gagal bukan insiden; dan bukan diam, karena
 * metrik yang hilang tanpa jejut persis kebohongan yang §4.5 ingin
 * hindari.
 */
async function bump(store: KeyValueStore, key: string): Promise<void> {
  try {
    await store.increment(key);
  } catch {
    log.warn('metrics.increment.failed', { key });
  }
}

/** Catat satu penulisan berhasil. */
export async function recordDashboardWrite(store: KeyValueStore): Promise<void> {
  await bump(store, WRITES_TOTAL_KEY);
}

/** Catat satu penolakan penulisan, alasan apa pun. */
export async function recordDashboardWriteDenied(store: KeyValueStore): Promise<void> {
  await bump(store, WRITE_DENIED_TOTAL_KEY);
}

function parseCount(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Baca satu penghitung; kegagalan adalah nol, bukan lempar. */
async function readCount(store: KeyValueStore, key: string): Promise<number> {
  try {
    return parseCount(await store.get(key));
  } catch {
    log.warn('metrics.read.failed', { key });
    return 0;
  }
}

/**
 * Baca kedua penghitung.
 *
 * Membaca tidak pernah melempar: kunci yang belum ada adalah angka
 * nol, dan kegagalan koneksi adalah nol juga — pembaca (monitoring)
 * harus tahu "tidak ada data", bukan mendapat 500 dari endpoint
 * yang seharusnya menjawab status. Kegagalan baca dicatat di log
 * supaya tidak diam-diam: angka nol yang tidak dijelaskan sama
 * menipunya dengan tidak ada angka sama sekali.
 */
export async function readDashboardMetrics(store: KeyValueStore): Promise<DashboardMetrics> {
  const [writesTotal, writeDeniedTotal] = await Promise.all([
    readCount(store, WRITES_TOTAL_KEY),
    readCount(store, WRITE_DENIED_TOTAL_KEY),
  ]);

  return { writesTotal, writeDeniedTotal };
}

/** Ekspor kunci untuk tes; produksi tidak pernah membutuhkannya. */
export const METRIC_KEYS = {
  writesTotal: WRITES_TOTAL_KEY,
  writeDeniedTotal: WRITE_DENIED_TOTAL_KEY,
} as const;
