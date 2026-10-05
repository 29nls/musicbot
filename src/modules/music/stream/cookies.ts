/**
 * Jalur cookie untuk yt-dlp.
 *
 * Kenapa perlu: YouTube menolak permintaan dari IP pusat data dengan "Sign in to
 * confirm you're not a bot". Satu-satunya jalan yang terbukti adalah mengirim
 * cookie browser milik akun Google — persis yang dilakukan rawon (menu `!login`
 * di sana; di sini cookie shaken tangan sendiri lewat berkas).
 *
 * Kenapa disalin ke berkas terpisah: yt-dlp menulis balik berkas cookie setiap
 * kali cookie diperbarui. Kalau ia menulis langsung ke berkas milik pengguna,
 * login yang sudah dikoreksi bisa hilang kalau proses mati di tengah penulisan.
 * Karena itu yt-dlp selalu menerima salinan, dan berkas asli tidak pernah
 * disentuh.
 */

import { copyFileSync, existsSync } from 'node:fs';

/** Akhiran berkas salinan; sama dengan yang dipakai rawon. */
export const COOKIE_STAGING_SUFFIX = '.ytdlp-tmp';

/** Lokasi salinan untuk sebuah berkas cookie asli. */
export function stagedCookiePath(source: string): string {
  return `${source}${COOKIE_STAGING_SUFFIX}`;
}

export interface StageCookieDeps {
  /** Apakah berkas benar-benar ada; disuntik agar tes tidak menyentuh disk. */
  isFile?: (candidate: string) => boolean;
  /** Penyalinan; disuntik untuk tes. */
  copyFile?: (from: string, to: string) => void;
}

/**
 * Siapkan salinan cookie dan kembalikan jalur yang harus dipakai yt-dlp.
 *
 * Mengembalikan `null` kalau tidak ada cookie yang dipakai — pemanggil lalu
 * menjalankan yt-dlp tanpa `--cookies`, sama seperti sebelum cookie diaktifkan.
 */
export function stageCookieFile(
  source: string | null | undefined,
  deps: StageCookieDeps = {},
): string | null {
  const trimmed = source?.trim();
  if (!trimmed) return null;

  const isFile = deps.isFile ?? ((candidate: string) => existsSync(candidate));
  if (!isFile(trimmed)) return null;

  const staged = stagedCookiePath(trimmed);
  const copy = deps.copyFile ?? ((from: string, to: string) => copyFileSync(from, to));

  try {
    copy(trimmed, staged);
    return staged;
  } catch {
    // Penyalinan gagal: lebih baik pakai berkas aslinya daripada tidak memutar,
    // dengan catatan risikonya yt-dlp bisa menulis balik ke berkas itu.
    return trimmed;
  }
}

/** Argumen `--cookies` untuk yt-dlp; array kosong kalau tidak ada cookie. */
export function cookieArgs(stagedPath: string | null): string[] {
  return stagedPath ? ['--cookies', stagedPath] : [];
}
