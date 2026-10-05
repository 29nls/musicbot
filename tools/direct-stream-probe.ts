/**
 * Bukti runtime untuk jalur audio langsung (tanpa Lavalink).
 *
 * Skrip ini menjalankan pipeline sungguhan — yt-dlp mengunduh audio, ffmpeg
 * mengubahnya jadi opus, bot menghitung paket yang keluar — lalu mencetak apa
 * yang benar-benar terjadi. Tujuannya bukan "tidak error", melainkan angka yang
 * bisa dibandingkan: jumlah byte dari YouTube, jumlah paket opus, ukuran paket
 * terbesar, dan apakah paket itu muat di batas Discord.
 *
 * Jalankan: npm run probe:direct -- <url> [jumlah-paket]
 */

import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { resolveYtDlpBinary } from '../src/modules/music/stream/binary.js';
import { createDirectStream } from '../src/modules/music/stream/opusStream.js';

/** Batas ukuran satu paket opus yang diterima Discord voice. */
const DISCORD_MAX_PACKET_BYTES = 1_275;

function readDotEnvValue(key: string): string {
  try {
    loadEnvFile('.env');
  } catch {
    // .env tidak ada; wajar di container.
  }
  return (process.env[key] ?? '').trim();
}

function which(binaryName: string): string | null {
  const entries = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':');
  const suffixes = process.platform === 'win32' ? ['.exe', ''] : [''];

  for (const entry of entries) {
    if (!entry) continue;
    for (const suffix of suffixes) {
      const candidate = join(entry, `${binaryName}${suffix}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const [url = 'https://www.youtube.com/watch?v=wsEkktRGZ18', packetLimitRaw = '50'] = process.argv.slice(2);
  const packetLimit = Number.parseInt(packetLimitRaw, 10);
  const resolved = resolveYtDlpBinary({
    envPath: process.env.YTDLP_PATH ?? readDotEnvValue('YTDLP_PATH'),
    cacheDir: join(process.cwd(), 'cache'),
    isFile: existsSync,
    which,
  });

  if (resolved.source === 'missing') {
    console.error('yt-dlp tidak ditemukan. Isi YTDLP_PATH atau pasang yt-dlp di PATH.');
    process.exitCode = 1;
    return;
  }

  console.log(`yt-dlp      : ${resolved.path} (asal: ${resolved.source})`);
  console.log(`ffmpeg      : ${process.env.FFMPEG_PATH ?? 'ffmpeg (dari PATH)'}`);
  console.log(`video       : ${url}`);
  console.log(`butuh paket : ${packetLimit}`);
  console.log('');

  const startedAt = Date.now();
  let packets = 0;
  let totalBytes = 0;
  let maxPacket = 0;

  const handle = await createDirectStream({
    binaryPath: resolved.path,
    url,
    firstPacketTimeoutMs: 30_000,
    cookiePath: process.env.YTDLP_COOKIES_FILE ?? readDotEnvValue('YTDLP_COOKIES_FILE') ?? null,
    onError: (error) => {
      console.error(`galat saat streaming: ${error.kind} — ${error.message}`);
    },
  });

  await new Promise<void>((resolve) => {
    handle.stream.on('data', (chunk: Buffer) => {
      packets += 1;
      totalBytes += chunk.length;
      maxPacket = Math.max(maxPacket, chunk.length);

      if (packets >= packetLimit) resolve();
    });

    handle.stream.once('end', () => resolve());
    handle.stream.once('close', () => resolve());

    setTimeout(() => resolve(), 60_000).unref();
  });

  handle.stop();
  const elapsedMs = Date.now() - startedAt;

  console.log(`paket opus  : ${packets}`);
  console.log(`total byte  : ${totalBytes}`);
  console.log(`paket max   : ${maxPacket} byte (batas Discord ${DISCORD_MAX_PACKET_BYTES})`);
  console.log(`waktu       : ${elapsedMs} ms`);

  if (packets === 0) {
    console.error('\nHASIL: GAGAL — tidak ada satu pun paket opus yang sampai.');
    process.exitCode = 1;
    return;
  }

  if (maxPacket > DISCORD_MAX_PACKET_BYTES) {
    console.error(
      `\nHASIL: PERLUHATIAN — paket ${maxPacket} byte melebihi batas Discord, audio akan terputus.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `\nHASIL: OK — ${packets} paket opus, terbesar ${maxPacket} byte, muat di voice gateway.`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`probe gagal: ${message}`);
  process.exitCode = 1;
});
