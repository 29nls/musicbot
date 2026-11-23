import {
  dashboardResultKey,
  decodeDashboardResult,
  isRequestId,
  type DashboardResult,
} from '@bot/modules/music/dashboard.js';

/**
 * Transport perintah musik dashboard → bot.
 *
 * Dashboard tidak memegang player dan tidak bisa memutar lagu sendiri; ia
 * menerbitkan perintah ke `harmony:dashboard:music` dan menunggu bot menulis
 * hasil. Modul ini **tidak** boleh mengimpor `dashboardService.ts`: yang kedua
 * menyentuh `MusicService` (dan lewat dia Discord gateway), yang mana tidak ada
 * di proses ini.
 */

/** Umur hasil yang dianggap masih bisa dijawab untuk permintaan ini. */
export const RESULT_ACCEPT_MS = 30_000;

/**
 * Lama menunggu.
 *
 * Delapan detik: pencarian Lavalink normalnya di bawah dua detik, dan tombol
 * yang menggantung lebih lama dari ini lebih buruk bagi user daripada jawaban
 * \"bot tidak menjawab\".
 */
export const RESULT_TIMEOUT_MS = 8_000;
const POLL_MS = 200;

export interface WaitDeps {
  /** Hasil mentah untuk `requestId`; `null` = belum ada. */
  readResult(requestId: string): Promise<string | null>;
  deleteResult(requestId: string): Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const sleepDefault = (ms: number): Promise<void> =>
  new Promise((resolveWait) => setTimeout(resolveWait, ms));

/**
 * Tunggu hasil yang ditulis proses bot.
 *
 * Hasil dibaca sekali lalu dihapus. `requestId` yang dipakai sebagai kunci
 * dibuat acak oleh route dan tidak pernah datang dari peramban, jadi hasil yang
 * ditemukan di kunci ini memang jawaban untuk permintaan ini.
 */
export async function waitForDashboardResult(
  requestId: string,
  deps: WaitDeps,
): Promise<
  | { status: 'result'; result: DashboardResult }
  | { status: 'timeout' | 'invalid' | 'store-error' }
> {
  if (!isRequestId(requestId)) return { status: 'invalid' };

  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? sleepDefault;
  const startedAt = now();
  const timeoutMs = deps.timeoutMs ?? RESULT_TIMEOUT_MS;
  const key = dashboardResultKey(requestId);

  while (now() - startedAt < timeoutMs) {
    let raw: string | null;
    try {
      raw = await deps.readResult(key);
    } catch {
      // Store bersama mati setelah perintah terkirim. Menunggu sisanya hanya
      // menambah delapan detik tanpa kemungkinan berhasil, jadi jawab jelas.
      return { status: 'store-error' };
    }

    if (raw) {
      await deps.deleteResult(key).catch(() => undefined);
      const result = decodeDashboardResult(raw);
      if (result) return { status: 'result', result };
    }

    await sleep(POLL_MS);
  }

  return { status: 'timeout' };
}
