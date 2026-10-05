/**
 * Pipeline audio langsung: yt-dlp → ffmpeg → opus untuk Discord.
 *
 * Ini adalah pengganti Lavalink. Yang berubah bukan hanya tempat ffmpeg
 * dijalankan, tapi siapa yang bicara dengan YouTube: tidak ada plugin YouTube
 * lagi, jadi tidak ada lagi daftar klien yang bisa semuanya ditolak.
 *
 * Bentuk pipeline-nya mengikuti rawon (github.com/stegripe/rawon) dengan satu
 * perbedaan yang dipakai: keluaran yt-dlp (webm/m4a, apa pun yang dipilih
 * YouTube) dialirkan ke ffmpeg, hasilnya PCM, lalu di-encode jadi paket opus
 * 20 ms oleh encoder di Node. Untuk pindah posisi, stream ditulis ke berkas
 * sementara lebih dulu — pipe tidak bisa di-seek.
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import type { FilterMode } from '../filters.js';
import { StreamError, toStreamError } from './errors.js';
import { ffmpegArgs, OPUS_FRAME_SIZE } from './ffmpegArgs.js';
import { buildStreamArgs } from './ytDlp.js';

/**
 * prism-media hanya menyediakan CommonJS, jadi di dalam modul ESM ini import
 * bernama tidak terbaca Node (`FFmpeg` tidak muncul di daftar ekspor).
 * `createRequire` memuat modulnya apa adanya sambil menjaga tipe tetap dari
 * berkas deklarasinya.
 */
const requireCjs = createRequire(import.meta.url);
const { FFmpeg, opus: prismOpus } = requireCjs('prism-media') as typeof import('prism-media');

/** 20 ms pada 48 kHz = 960 sampel per kanal, ukuran frame opus yang diminta Discord. */
export { OPUS_FRAME_SIZE };

/** Aliran opus 20 ms siap dikirim ke voice gateway. */
export type OpusStream = InstanceType<typeof prismOpus.Encoder>;

/** Berapa ms menunggu paket pertama sebelum dianggap gagal. */
export const DEFAULT_FIRST_PACKET_TIMEOUT_MS = 20_000;

/** Batas menunggu unduhan penuh saat pindah posisi. */
export const SEEK_DOWNLOAD_TIMEOUT_MS = 60_000;

/** yt-dlp dijalankan tanpa stdin: stdout-nya audio, stderr-nya diagnostik. */
type YtDlpProcess = ChildProcessByStdio<null, Readable, Readable>;

export interface DirectStreamOptions {
  /** Jalur biner yt-dlp. */
  binaryPath: string;
  /** URL video yang akan diputar. */
  url: string;
  isLive?: boolean;
  cookiePath?: string | null;
  extractorArgs?: string | null;
  filterMode?: FilterMode;
  seekSeconds?: number;
  /** Biner ffmpeg; null berarti cari sendiri (ffmpeg-static, PATH, avconv). */
  ffmpegPath?: string | null;
  firstPacketTimeoutMs?: number;
  /** Dipanggil kalau stream berhenti karena galat setelah mulai mengalir. */
  onError?: (error: StreamError) => void;
}

export interface DirectStreamHandle {
  /** Aliran opus 20 ms siap diberikan ke voice player. */
  stream: OpusStream;
  /** Proses yt-dlp; disimpan supaya bisa dibunuh saat lagu berganti. */
  proc: YtDlpProcess;
  /** Hentikan yt-dlp, ffmpeg, dan encoder. Aman dipanggil berkali-kali. */
  stop: () => void;
}

/** "Premature close" adalah galat wajar saat audio di-stop, bukan kegagalan. */
function isPrematureClose(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Premature close') ||
    (error as { code?: string } | null | undefined)?.code === 'ERR_STREAM_PREMATURE_CLOSE'
  );
}

/**
 * Buka stream audio untuk satu lagu.
 *
 * Resolusi baru terjadi setelah paket opus pertama benar-benar tersedia. Kalau
 * yt-dlp atau ffmpeg mati lebih dulu, galat diklasifikasikan supaya pemanggil
 * tahu apakah perlu mencoba lagi, memperbarui cookie, atau melewati lagu.
 */
export async function createDirectStream(options: DirectStreamOptions): Promise<DirectStreamHandle> {
  const {
    binaryPath,
    url,
    isLive = false,
    cookiePath = null,
    extractorArgs = null,
    filterMode = 'off',
    seekSeconds = 0,
    ffmpegPath = null,
    firstPacketTimeoutMs = DEFAULT_FIRST_PACKET_TIMEOUT_MS,
    onError,
  } = options;

  if (ffmpegPath) process.env.FFMPEG_PATH = ffmpegPath;

  const proc = spawn(binaryPath, buildStreamArgs(url, { isLive, cookiePath, extractorArgs }), {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stderr = '';
  let ffmpegStderr = '';
  let tempPath: string | null = null;
  let stopped = false;

  proc.stderr?.on('data', (chunk: Buffer) => {
    // Dibatasi supaya galat panjang tidak memakan memori pada stream yang lama.
    stderr = `${stderr}${chunk.toString()}`.slice(-8_000);
  });

  const stop = (): void => {
    if (stopped) return;
    stopped = true;

    if (!proc.killed) proc.kill('SIGKILL');
    if (tempPath) void unlink(tempPath).catch(() => undefined);
  };

  let inputPath: string | null = null;
  let source: Readable;

  if (seekSeconds > 0) {
    // Seek akurat butuh berkas utuh, jadi stream diunduh dulu ke disk.
    try {
      tempPath = await bufferToFile(proc, SEEK_DOWNLOAD_TIMEOUT_MS, () => stderr);
    } catch (error) {
      stop();
      throw error;
    }
    inputPath = tempPath;
    source = createReadStream(tempPath);
  } else {
    if (!proc.stdout) {
      stop();
      throw new StreamError('unknown', 'yt-dlp tidak memberi stdout', url);
    }
    // Penting: stdout langsung disambungkan ke ffmpeg tanpa menunggu byte
    // pertama. Bekas "tunggu data dulu" membuat stream mengalir ke listener yang
    // membuangnya, sehingga header m4a/webm hilang dan ffmpeg gagal diam-diam.
    source = proc.stdout;
  }

  // ffmpeg dibangun setelah sumbernya diketahui: dengan `-i -` dia membaca pipe,
  // dengan `-i <berkas>` dia membaca disk lalu bisa `-ss` akurat.
  const ffmpeg = new FFmpeg({ args: ffmpegArgs({ filterMode, seekSeconds, inputPath }) });

  // stderr ffmpeg sering jadi satu-satunya petunjuk (mis. berkas tidak dibaca),
  // jadi dikumpulkan dan ikut dilaporkan. prism-media tidak mendeklarasikan
  // `process` di tipenya, jadi dibaca langsung.
  const ffmpegStderrStream = (ffmpeg as unknown as { process?: { stderr?: Readable } }).process?.stderr;
  ffmpegStderrStream?.on('data', (chunk: Buffer) => {
    ffmpegStderr = `${ffmpegStderr}${chunk.toString()}`.slice(-4_000);
  });

  const encoder = new prismOpus.Encoder({
    rate: 48_000,
    channels: 2,
    frameSize: OPUS_FRAME_SIZE,
  });

  const reportFailure = (message: string): void => {
    if (stopped) return;
    onError?.(toStreamError(message, url));
    stop();
  };

  ffmpeg.on('error', (error: unknown) => {
    if (isPrematureClose(error) || stopped) return;
    reportFailure(ffmpegStderr.trim() || (error instanceof Error ? error.message : String(error)));
  });

  encoder.on('error', (error: unknown) => {
    if (isPrematureClose(error) || stopped) return;
    reportFailure(error instanceof Error ? error.message : String(error));
  });

  proc.once('error', (error: Error) => reportFailure(error.message));

  source.pipe(ffmpeg).pipe(encoder);

  try {
    await waitForFirstPacket(encoder, proc, () => stderr || ffmpegStderr, firstPacketTimeoutMs);
  } catch (error) {
    stop();
    throw error;
  }

  return { stream: encoder, proc, stop };
}

/**
 * Tunggu paket opus pertama.
 *
 * Paket dihitung dari sisi output, bukan dari byte yt-dlp, karena yang penting
 * benar-benar adalah audio siap kirim. Listener memakai `readable` supaya stream
 * tidak dialirkan ke pembuang: data tetap tersimpan sampai pemanggil membacanya.
 */
function waitForFirstPacket(
  encoder: OpusStream,
  proc: YtDlpProcess,
  detail: () => string,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      clearTimeout(timer);
      encoder.removeListener('readable', onReadable);
      encoder.removeListener('end', onEnd);
      proc.removeListener('close', onClose);
      proc.removeListener('error', onClose);
    };

    const succeed = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const fail = (error: StreamError): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onReadable = (): void => succeed();
    const onEnd = (): void =>
      fail(
        toStreamError(
          detail() || 'yt-dlp selesai tanpa menghasilkan audio yang bisa diputar',
        ),
      );
    const onClose = (code?: number | null): void =>
      fail(
        toStreamError(
          detail() || `yt-dlp berhenti lebih dulu (kode ${code ?? 'tidak diketahui'})`,
        ),
      );

    const timer = setTimeout(
      () => fail(new StreamError('transient', `Tidak ada paket audio dalam ${timeoutMs} ms`)),
      timeoutMs,
    );

    encoder.once('readable', onReadable);
    encoder.once('end', onEnd);
    proc.once('close', onClose);
    proc.once('error', onClose);
  });
}

/** Unduh stream ke berkas sementara dan tunggu sampai selesai. */
function bufferToFile(
  proc: YtDlpProcess,
  timeoutMs: number,
  stderr: () => string,
): Promise<string> {
  const stdout = proc.stdout;
  if (!stdout) {
    return Promise.reject(new StreamError('unknown', 'yt-dlp tidak memberi stdout'));
  }

  const target = join(
    tmpdir(),
    `harmony-seek-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
  );
  const sink = createWriteStream(target);

  return new Promise<string>((resolve, reject) => {
    const fail = (error: Error): void => {
      clearTimeout(timer);
      sink.destroy();
      void unlink(target).catch(() => undefined);
      reject(toStreamError(stderr() || error.message, target));
    };

    const timer = setTimeout(
      () => fail(new Error('Unduhan untuk pindah posisi terlalu lama')),
      timeoutMs,
    );

    stdout.once('error', fail);
    sink.once('error', fail);
    sink.once('finish', () => {
      clearTimeout(timer);
      resolve(target);
    });

    proc.once('error', fail);
    proc.once('close', (code: number | null) => {
      if (code !== 0) {
        fail(new Error(`yt-dlp berhenti lebih dulu (kode ${code ?? 'tidak diketahui'})`));
      }
    });

    stdout.pipe(sink);
  });
}
