import { DiscordjsErrorCodes } from 'discord.js';

/**
 * Terjemahkan kegagalan startup jadi petunjuk yang bisa langsung ditindak.
 *
 * **Kenapa modul ini ada, dan kenapa tidak di dalam `src/index.ts`.** Dua
 * kegagalan yang paling sering terjadi saat setup — token salah dan privileged
 * intent belum diaktifkan — muncul sebagai dua bentuk error yang berbeda:
 *
 * - Token salah dilempar sebagai `DiscordjsError` dengan `code` yang terisi, jadi
 *   bisa dicocokkan lewat `DiscordjsErrorCodes`.
 * - Intent ditolak dilempar sebagai `Error` **polos** oleh discord.js v14:
 *   `name` tetap `"Error"`, `code` tidak ada, hanya `message` yang berbunyi
 *   `"Used disallowed intents"`. Dicocokkan lewat `instanceof` atau `code`,
 *   cabang penolongnya tidak akan pernah menyala — persis yang terjadi:
 *   operator melihat `Error: Used disallowed intents` tanpa petunjuk.
 *
 * Karena itu pencocokan dilakukan dua kali: lewat `code` kalau ada, lalu lewat
 * kalimat pesannya kalau tidak. Ditempatkan di modul murni supaya bisa diuji
 * tanpa menyalakan klien Discord.
 */

/** Intent yang memang dipakai bot ini; disebut apa adanya supaya jelas. */
const REQUIRED_INTENTS = ['Server Members Intent', 'Message Content Intent'];

const INTENTS_GUIDANCE = [
  'Bot memakai privileged intent yang belum diaktifkan.',
  'Developer Portal → pilih aplikasi → Bot → Privileged Gateway Intents → aktifkan',
  `"${REQUIRED_INTENTS[0]}" dan "${REQUIRED_INTENTS[1]}".`,
  'Kalau portalnya belum bisa diubah, jalankan bot tanpa intent itu sementara:',
  'ubah `intents` di src/client.ts, tapi welcome, autorole, dan automod ikut mati.',
].join('\n');

const TOKEN_GUIDANCE =
  'Token Discord tidak valid. Periksa DISCORD_TOKEN di .env (Developer Portal → Bot → Reset Token).';

/** Pesan yang memuat kata-kata kunci, huruf besar-kecil tidak berpengaruh. */
const TOKEN_PATTERNS = [/invalid token/i, /token invalid/i];
const INTENT_PATTERNS = [/disallowed intents/i, /privileged intent/i];

/**
 * @returns kalimat yang bisa ditampilkan ke operator, bukan stack trace.
 */
export function describeStartupFailure(error: unknown): string {
  const coded = codedMessage(error);
  if (coded) return coded;

  const message = error instanceof Error ? error.message : '';
  if (INTENT_PATTERNS.some((pattern) => pattern.test(message))) return INTENTS_GUIDANCE;
  if (TOKEN_PATTERNS.some((pattern) => pattern.test(message))) return TOKEN_GUIDANCE;

  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** Jalur error yang membawa `code` (mis. `DiscordjsError` dari discord.js). */
function codedMessage(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;

  // Sengaja tidak memakai `instanceof`: kalau someday ada dua salinan
  // discord.js di tree, error dari salah satunya bukan instance dari yang lain,
  // dan petunjuk yang paling dibutuhkan justru hilang saat itu.
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') return undefined;

  if (code === DiscordjsErrorCodes.TokenInvalid) return TOKEN_GUIDANCE;
  if (code === DiscordjsErrorCodes.DisallowedIntents) return INTENTS_GUIDANCE;
  return undefined;
}