/**
 * Penemuan biner yt-dlp.
 *
 * Kenapa bot menyimpan biner sendiri: masalah awal yang membuat lagu tidak bisa
 * diputar adalah plugin YouTube Lavalink tidak punya satu pun klien yang lolos
 * pemeriksaan YouTube, sementara yt-dlp — dijalankan sebagai proses terpisah —
 * berhasil mengunduh audio. Jadi di jalur ini yang bicara dengan YouTube adalah
 * program yt-dlp, bukan plugin apa pun.
 *
 * Urutan pencarian, dari yang paling eksplisit:
 *   1. `YTDLP_PATH` — kalau diisi, itulah yang dipakai, tanpa fallback diam-diam,
 *      supaya lokasi biner yang rusak ketahuan dan bukan diam-diam diganti biner lain.
 *   2. Biner hasil unduhan sendiri di `cache/scripts/`.
 *   3. `yt-dlp` yang ada di PATH sistem.
 *
 * Pemisahan disengaja: bagian yang memutuskan (murni) dipisah dari bagian yang
 * menyentuh disk dan jaringan, supaya urutan pencarian bisa diuji tanpa keduanya.
 */

import { accessSync, chmodSync, constants, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Asal biner yang dipakai, supaya log bisa menjelaskan kenapa tidak diunduh. */
export type BinarySource = 'env' | 'cache' | 'path' | 'missing';

export interface ResolvedBinary {
  /** Jalur yang bisa dieksekusi. */
  path: string;
  source: Exclude<BinarySource, 'missing'>;
}

/** Nama berkas biner untuk platform berjalan. */
export function binaryFileName(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return 'yt-dlp.exe';
  if (platform === 'darwin') return 'yt-dlp_macos';
  return 'yt-dlp';
}

/** Mode berkas: Windows tidak memakai bit eksekusi, Unix memakai. */
function binaryFileMode(platform: NodeJS.Platform = process.platform): number {
  return platform === 'win32' ? 0o666 : 0o755;
}

/** Lokasi biner hasil unduhan sendiri. */
export function cacheBinaryPath(
  cacheDir: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return join(cacheDir, 'scripts', binaryFileName(platform));
}

/** Endpoint GitHub untuk mencari rilis yt-dlp terbaru. */
export const LATEST_RELEASE_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases?per_page=1';

export interface BinaryProbe {
  /** Isi `YTDLP_PATH`; string kosong berarti "tidak diisi". */
  envPath?: string | undefined;
  /** Lokasi cache bot. */
  cacheDir: string;
  /** Adanya berkas — disuntik agar tes tidak menyentuh disk. */
  isFile: (candidate: string) => boolean;
  /** Pencarian di PATH; null kalau tidak ketemu. */
  which?: (name: string) => string | null;
  platform?: NodeJS.Platform;
}

/**
 * Putuskan biner mana yang dipakai, tanpa menjalankan apa pun.
 *
 * Mengembalikan `{ source: 'missing' }` kalau tidak ada yang bisa dipakai;
 * keputusan mengunduh tetap di pemanggil supaya modul ini tetap murni.
 */
export function resolveYtDlpBinary(
  probe: BinaryProbe,
): ResolvedBinary | { source: 'missing' } {
  const platform = probe.platform ?? process.platform;

  const fromEnv = probe.envPath?.trim();
  if (fromEnv) {
    // Env adalah perintah eksplisit: kalau biner di sana rusak, itu harus terlihat.
    return { path: fromEnv, source: 'env' };
  }

  const cached = cacheBinaryPath(probe.cacheDir, platform);
  if (probe.isFile(cached)) return { path: cached, source: 'cache' };

  const found = probe.which?.(binaryFileName(platform)) ?? null;
  if (found) return { path: found, source: 'path' };

  return { source: 'missing' };
}

/** Beri bit eksekusi bila Unix dan belum punya. Aman dipanggil berkali-kali. */
export function ensureExecutable(
  binaryPath: string,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === 'win32') return;

  try {
    // Yank sudah bisa dieksekusi, tidak ada yang perlu diubah.
    accessSync(binaryPath, constants.X_OK);
    return;
  } catch {
    // Bukan executable (atau tidak ada) — lanjut ubah izin aksesnya.
  }

  try {
    chmodSync(binaryPath, binaryFileMode(platform));
  } catch {
    // Gagal chmod bukan alasan menggagalkan start; pemanggil mencatatnya di log.
  }
}

/** Bentuk satu aset rilis yt-dlp dari jawaban GitHub. */
interface ReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

interface GithubRelease {
  assets?: ReleaseAsset[];
}

/** URL unduhan biner untuk platform berjalan; null kalau rilis tidak punya. */
export function pickReleaseAssetUrl(
  releases: unknown,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const list = Array.isArray(releases) ? releases : [];
  const wanted = binaryFileName(platform);

  for (const release of list as GithubRelease[]) {
    for (const asset of release.assets ?? []) {
      if (asset.name === wanted && typeof asset.browser_download_url === 'string') {
        return asset.browser_download_url;
      }
    }
  }

  return null;
}

export interface DownloadDeps {
  /** Ambil JSON; bawaan `fetch` global Node. */
  fetchJson?: (url: string) => Promise<unknown>;
  /** Unduh biner; bawaan `fetch` global Node. */
  fetchBinary?: (url: string) => Promise<Uint8Array>;
  /** Tulis berkas — disuntik untuk tes. */
  writeFile?: (target: string, data: Uint8Array, mode: number) => void;
  mkdir?: (dir: string, options: { recursive: true }) => void;
  platform?: NodeJS.Platform;
}

/** Bawaan: JSON lewat `fetch` bawaan Node. */
async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`GitHub API ${response.status} untuk ${url}`);

  return (await response.json()) as unknown;
}

/** Bawaan: biner lewat `fetch` bawaan Node. */
async function defaultFetchBinary(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unduhan biner gagal: HTTP ${response.status}`);

  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Unduh biner yt-dlp terbaru ke cache bot.
 *
 * URL diambil dari GitHub Releases, bukan dari nama berkas yang ditebak, jadi
 * yang terpasang selalu rilis yang benar-benar diterbitkan upstream.
 */
export async function downloadYtDlpBinary(cacheDir: string, deps: DownloadDeps = {}): Promise<string> {
  const platform = deps.platform ?? process.platform;
  const fetchJson = deps.fetchJson ?? defaultFetchJson;
  const fetchBinary = deps.fetchBinary ?? defaultFetchBinary;
  const write = deps.writeFile ?? ((target, data, mode) => writeFileSync(target, data, { mode }));
  const mkdir = deps.mkdir ?? ((dir: string): void => {
    mkdirSync(dir, { recursive: true });
  });

  const releases = await fetchJson(LATEST_RELEASE_API);
  const assetUrl = pickReleaseAssetUrl(releases, platform);
  if (!assetUrl) {
    throw new Error(`Rilis yt-dlp terbaru tidak punya aset untuk ${binaryFileName(platform)}`);
  }

  mkdir(join(cacheDir, 'scripts'), { recursive: true });
  const data = await fetchBinary(assetUrl);

  const target = cacheBinaryPath(cacheDir, platform);
  write(target, data, binaryFileMode(platform));
  ensureExecutable(target, platform);

  return target;
}
