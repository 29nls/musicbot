/**
 * Argumen ffmpeg untuk pipeline opus.
 *
 * Discord hanya menerima audio 48 kHz stereo, jadi keluaran apa pun dari yt-dlp
 * (webm, m4a, mp3, apa pun yang dipilih YouTube) harus dilewatkan ffmpeg dulu.
 *
 * Satu perbedaan penting dari rawon (github.com/stegripe/rawon,
 * src/utils/functions/ffmpegArgs.ts): rawon meminta ffmpeg langsung mengeluarkan
 * opus, lalu mengirim apa adanya ke voice gateway. Diperiksa di mesin ini,
 * paket rata-rata keluar 11.686 byte dan yang terbesar 13.748 byte, sedangkan
 * Discord membuang apa pun di atas 1.275 byte per paket — jadi audio tidak akan
 * sampai. Karena itu ffmpeg di sini berhenti di PCM, dan paket opus 20 ms dibuat
 * oleh encoder opus Node dengan batas ukuran yang pasti benar.
 *
 * Catatan lain: `-ss` diletakkan SESUDAH `-i` supaya pindah posisi akurat untuk
 * berkas hasil unduh; kalau sebelum `-i`, ffmpeg melompat kasar dan lagu bisa
 * mulai dari frame yang salah.
 */

import type { FilterMode } from '../filters.js';

/** Filter ffmpeg untuk setiap mode yang dikenal bot. */
export const FFMPEG_FILTER_ARGS: Record<Exclude<FilterMode, 'off'>, string> = {
  bassboost: 'bass=g=7.5',
  nightcore: 'aresample=48000,asetrate=48000*1.25',
  vaporwave: 'aresample=48000,asetrate=48000*0.8',
  '8d': 'apulsator=hz=0.08',
};

/** Argumen tetap yang selalu ada: PCM 48 kHz stereo, tanpa video. */
export const FFMPEG_OUTPUT_ARGS = [
  '-vn',
  '-ar',
  '48000',
  '-ac',
  '2',
  '-f',
  's16le',
  '-acodec',
  'pcm_s16le',
] as const;

/** Level log ffmpeg; 0 = diam, karena errornya sudah dibaca sendiri. */
const LOG_LEVEL_ARGS = ['-loglevel', '0'] as const;

/**
 * 20 ms pada 48 kHz = 960 sampel per kanal.
 *
 * Ini yang diminta voice gateway Discord: satu paket per 20 ms. Encoder opus di
 * modul stream memakai angka ini, jadi dideklarasikan di sini agar bisa diuji
 * tanpa memuat pustaka audio apa pun.
 */
export const OPUS_FRAME_SIZE = 960;

export interface FfmpegArgsOptions {
  /** Mode filter yang aktif; `off` berarti suara normal. */
  filterMode?: FilterMode;
  /** Posisi awal dalam detik. */
  seekSeconds?: number;
  /** Berkas lokal; kalau kosong, input dibaca dari stdin. */
  inputPath?: string | null;
}

/**
 * Susun argumen ffmpeg lengkap.
 *
 * Fungsi murni supaya bisa diuji tanpa menjalankan ffmpeg — kesalahan di sini
 * (filter terbalik, `-ss` salah tempat) baru ketahuan setelah ada yang memutar
 * lagu, jadi nilainya harus bisa dibuktikan lebih dulu.
 */
export function ffmpegArgs(options: FfmpegArgsOptions = {}): string[] {
  const { filterMode = 'off', seekSeconds = 0, inputPath = null } = options;

  const audioFilter =
    filterMode !== 'off' ? FFMPEG_FILTER_ARGS[filterMode as Exclude<FilterMode, 'off'>] : null;

  const inputArgs: string[] = [];
  if (inputPath) {
    inputArgs.push('-i', inputPath);
    if (seekSeconds > 0) inputArgs.push('-ss', String(seekSeconds));
  } else {
    inputArgs.push('-i', '-');
  }

  return [
    ...LOG_LEVEL_ARGS,
    ...inputArgs,
    ...FFMPEG_OUTPUT_ARGS,
    ...(audioFilter ? ['-af', audioFilter] : []),
  ];
}
