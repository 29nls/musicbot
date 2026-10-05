/**
 * Pembentuk argumen yt-dlp dan pembacaan metadata.
 *
 * Semua fungsi di sini murni: diberi argumen atau JSON dari yt-dlp, tanpa
 * menjalankan proses apa pun. Alasannya sama seperti modul lain di folder
 * `stream/`: galat paling mahal di jalur audio baru terlihat setelah ada yang
 * memanggil `/play`, jadi bentuk argumen harus bisa dibuktikan lebih dulu.
 *
 * Urutan flag mengikuti rawon (github.com/stegripe/rawon,
 * src/utils/handlers/YTDLUtil.ts) supaya perilakunya sama dengan bot yang
 * sudah terbukti bisa menembus pemeriksaan bot YouTube.
 */

/** Format untuk lagu biasa. */
export const STREAM_FORMAT = 'bestaudio/best';

/** Format untuk siaran langsung. */
export const LIVE_FORMAT = 'best[acodec!=none]/bestaudio/best';

/** Input yt-dlp untuk mencari lewat YouTube. */
export function searchInput(query: string, limit = 5): string {
  return `ytsearch${Math.max(1, Math.trunc(limit))}:${query}`;
}

export interface StreamArgOptions {
  /** Siaran langsung: format berbeda dan mulai dari awal, bukan tepi live. */
  isLive?: boolean;
  /** Jalur salinan cookie; null berarti tanpa cookie. */
  cookiePath?: string | null;
  /** Nilai untuk `--extractor-args`. */
  extractorArgs?: string | null;
}

/**
 * Argumen streaming audio ke stdout (`-o -`).
 *
 * `-f bestaudio/best` dipakai supaya ffmpeg menerima format apa pun yang
 * dipilih YouTube; tanpa itu ada video yang gagal karena berkas webm
 * tidak punya track audio terpisah.
 */
export function buildStreamArgs(url: string, options: StreamArgOptions = {}): string[] {
  const { isLive = false, cookiePath = null, extractorArgs = null } = options;

  const args = [
    '--no-config',
    // YouTube sekarang menolak ekstraksi tanpa runtime JavaScript; Node yang
    // menjalankan bot ini juga yang dipakai yt-dlp (sama seperti rawon).
    '--js-runtimes',
    'node',
    '-o',
    '-',
    '--quiet',
    '--no-warnings',
    '-f',
    isLive ? LIVE_FORMAT : STREAM_FORMAT,
  ];

  if (isLive) args.push('--no-live-from-start');
  if (cookiePath) args.push('--cookies', cookiePath);
  if (extractorArgs) args.push('--extractor-args', extractorArgs);

  args.push(url);
  return args;
}

/** Argumen metadata JSON satu entri (`-J`). */
export function buildMetadataArgs(input: string, options: StreamArgOptions = {}): string[] {
  const { cookiePath = null, extractorArgs = null } = options;

  const args = ['--no-config', '--js-runtimes', 'node', '-J', '--no-playlist'];
  if (cookiePath) args.push('--cookies', cookiePath);
  if (extractorArgs) args.push('--extractor-args', extractorArgs);

  args.push(input);
  return args;
}

/** Bentuk JSON hasil yt-dlp yang dibutuhkan bot. */
export interface YtDlpEntry {
  id: string;
  title: string;
  uploader: string;
  /** Durasi ms; 0 untuk siaran langsung. */
  durationMs: number;
  url: string;
  thumbnail: string | null;
  isLive: boolean;
  isVideo: boolean;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Ubah satu entri JSON yt-dlp ke bentuk internal bot. */
export function toYtDlpEntry(raw: unknown): YtDlpEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const item = raw as Record<string, unknown>;

  const id = asString(item.id);
  const url = asString(item.webpage_url) ?? asString(item.original_url) ?? asString(item.url);
  if (!id || !url) return null;

  const isLive = asNumber(item.live_status) === 1 || item.is_live === true;
  const isVideo = item.vcodec !== 'none';

  // Siaran langsung tidak punya durasi; 0 membuat UI menulis LIVE.
  const durationSeconds = isLive ? 0 : asNumber(item.duration);

  return {
    id,
    title: asString(item.title) ?? id,
    uploader: asString(item.uploader) ?? asString(item.channel) ?? 'Tidak diketahui',
    durationMs: Math.max(0, Math.round(durationSeconds * 1000)),
    url,
    thumbnail: asString(item.thumbnail),
    isLive,
    isVideo,
  };
}

/**
 * Ambil daftar entri dari JSON `ytsearchN:` atau `-J`.
 *
 * Playlist memuat entri di `entries`, video tunggal tidak. Keduanya harus
 * diterima karena `/play <tautan>` memakai bentuk kedua.
 */
export function parseEntries(payload: unknown): YtDlpEntry[] {
  if (Array.isArray(payload)) {
    return payload.map(toYtDlpEntry).filter((entry): entry is YtDlpEntry => entry !== null);
  }

  if (typeof payload !== 'object' || payload === null) return [];

  const container = payload as Record<string, unknown>;
  if (Array.isArray(container.entries)) return parseEntries(container.entries);

  const single = toYtDlpEntry(payload);
  return single ? [single] : [];
}
