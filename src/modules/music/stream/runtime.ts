/**
 * Menyusun runtime audio dari environment.
 *
 * Kenapa modul ini perlu: pemutar tidak boleh mencari biner, cookie, atau ffmpeg
 * sendiri-sendiri setiap kali ada `/play`. Semuanya diputuskan sekali di sini,
 * di satu tempat yang bisa diuji tanpa menjalankan apa pun, supaya pertanyaan
 * "kenapa tidak ada suara" selalu punya jawaban yang bisa ditunjuk barisnya.
 *
 * Yang dibaca dari environment:
 *   - `YTDLP_PATH`          lokasi biner yt-dlp (opsional)
 *   - `YTDLP_COOKIES_FILE`  berkas cookie format Netscape (opsional)
 *   - `FFMPEG_PATH`         lokasi biner ffmpeg (opsional)
 */

import { copyFileSync, existsSync } from 'node:fs';

import {
  binaryFileName,
  cacheBinaryPath,
  downloadYtDlpBinary,
  resolveYtDlpBinary,
  type DownloadDeps,
  type ResolvedBinary,
} from './binary.js';
import { stageCookieFile } from './cookies.js';

export interface StreamEnv {
  YTDLP_PATH?: string | undefined;
  YTDLP_COOKIES_FILE?: string | undefined;
  FFMPEG_PATH?: string | undefined;
}

export interface RuntimeDeps {
  /** Lokasi cache bot; biner hasil unduhan ditaruh di sini. */
  cacheDir: string;
  isFile?: (candidate: string) => boolean;
  copyFile?: (from: string, to: string) => void;
  which?: (name: string) => string | null;
}

export interface StreamRuntime {
  /** Biner yt-dlp yang dipakai; `source: 'missing'` berarti belum ada. */
  binary: ResolvedBinary | { source: 'missing' };
  /** Salinan cookie yang harus lewat ke yt-dlp; null kalau tidak ada cookie. */
  cookiePath: string | null;
  /** Berkas cookie asli, untuk pesan error yang menyebut sumbernya. */
  cookieSource: string | null;
  /** Biner ffmpeg; null berarti biarkan prism-media mencarinya sendiri. */
  ffmpegPath: string | null;
}

function defaults(deps: RuntimeDeps): Required<Pick<RuntimeDeps, 'isFile' | 'copyFile'>> & RuntimeDeps {
  return {
    ...deps,
    isFile: deps.isFile ?? ((candidate: string) => existsSync(candidate)),
    copyFile: deps.copyFile ?? ((from: string, to: string) => copyFileSync(from, to)),
  };
}

/**
 * Putuskan runtime dari environment, tanpa mengunduh apa pun.
 *
 * Tidak ada unduhan di sini: jika biner belum ada, hasilnya sengaja melaporkan
 * `missing` supaya pemanggil bisa memutuskan (biasanya mengunduh saat start).
 */
export function resolveStreamRuntime(env: StreamEnv, deps: RuntimeDeps): StreamRuntime {
  const resolved = defaults(deps);

  const binary = resolveYtDlpBinary({
    envPath: env.YTDLP_PATH,
    cacheDir: resolved.cacheDir,
    isFile: resolved.isFile,
    which: resolved.which,
  });

  const cookieSource = env.YTDLP_COOKIES_FILE?.trim() || null;

  return {
    binary,
    cookieSource,
    cookiePath: stageCookieFile(cookieSource, {
      isFile: resolved.isFile,
      copyFile: resolved.copyFile,
    }),
    ffmpegPath: env.FFMPEG_PATH?.trim() || null,
  };
}

export interface EnsureRuntimeDeps extends RuntimeDeps {
  /** Unduhan biner; disuntik agar tes tidak menyentuh jaringan. */
  download?: (cacheDir: string, deps?: DownloadDeps) => Promise<string>;
  /** Laporan singkat untuk log bot. */
  onLog?: (message: string) => void;
}

/**
 * Sama seperti `resolveStreamRuntime`, tapi mengunduh biner yt-dlp kalau memang
 * belum ada. Dipakai sekali saat bot start, bukan per lagu.
 */
export async function ensureStreamRuntime(
  env: StreamEnv,
  deps: EnsureRuntimeDeps,
): Promise<StreamRuntime> {
  const resolved = defaults(deps);
  const initial = resolveStreamRuntime(env, resolved);

  if (initial.binary.source !== 'missing') return initial;

  const download = deps.download ?? downloadYtDlpBinary;
  deps.onLog?.('yt-dlp belum ada; mengunduh biner resmi ke cache bot');

  try {
    const binaryPath = await download(resolved.cacheDir);
    deps.onLog?.(`yt-dlp terpasang di ${binaryPath}`);
  } catch (error) {
    // Kegagalan unduh bukan alasan bot mati; pemanggil pemutar akan melaporkan
    // "yt-dlp tidak ditemukan" dengan saran yang lebih berguna.
    deps.onLog?.(`Gagal mengunduh yt-dlp: ${error instanceof Error ? error.message : String(error)}`);
  }

  return resolveStreamRuntime(env, resolved);
}

/**
 * Pesan yang bisa ditunjukkan pengguna ketika biner benar-benar tidak ada.
 *
 * Disebutkan nama biner dan lokasi cache karena dua hal itu yang perlu dikerjakan
 * manusia; pesan "tidak ditemukan" tanpa arah membuat orang hanya mengulang
 * perintah yang sama.
 */
export function missingBinaryMessage(cacheDir: string): string {
  return [
    'yt-dlp tidak ditemukan di server ini.',
    `Pasang manual (${binaryFileName()}) lalu set YTDLP_PATH, atau biarkan bot mengunduh ke ${cacheBinaryPath(cacheDir)}.`,
  ].join(' ');
}
