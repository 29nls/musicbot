/**
 * Klasifikasi kegagalan saat mengambil audio (yt-dlp + ffmpeg).
 *
 * Kenapa file ini ada: kegagalan streaming bukan satu jenis. "Sign in to confirm
 * you're not a bot" berarti YouTube menolak identitas kita dan tidak akan hilang
 * dengan mencoba lagi, sedangkan "HTTP Error 429" atau koneksi yang putus akan
 * hilang bila diulang. Kalau keduanya diperlakukan sama, bot diam-diam melewati
 * lima percobaan untuk lagu yang memang mustahil diputar, atau sebaliknya
 * menyerah pada gangguan sesaat.
 *
 * Pola kalimat dan urutan pengecekannya mengikuti yt-dlp yang dipakai rawon
 * (github.com/stegripe/rawon, src/utils/yt-dlp/index.js) supaya galat yang sudah
 * dikenali di sana ikut dikenali di sini.
 */

/** Jenis kegagalan, dibedakan karena cara menanganinya berbeda. */
export type StreamFailureKind =
  /** YouTube meminta login — perlu cookie, mencoba lagi tidak menolong. */
  | 'bot-detection'
  /** Konten umur terbatas — tidak bisa diputar tanpa login. */
  | 'age-restricted'
  /** Tautan media langsung sudah kedaluwarsa (401/403/404/410 dari CDN). */
  | 'expired-media'
  /** Gangguan sesaat: rate limit, timeout, koneksi putus. Boleh diulang. */
  | 'transient'
  /** Video tidak ada, privat, atau dihapus. */
  | 'unavailable'
  /** Tidak terklasifikasi. */
  | 'unknown';

/** Galat streaming yang sudah diklasifikasi, lengkap dengan jenisnya. */
export class StreamError extends Error {
  public override readonly name = 'StreamError';

  public constructor(
    public readonly kind: StreamFailureKind,
    message: string,
    public readonly url?: string,
  ) {
    super(message);
  }

  /** Galat yang layak dicoba ulang dengan jeda. */
  public get retryable(): boolean {
    return this.kind === 'transient' || this.kind === 'expired-media';
  }

  /** Galat yang hanya bisa hilang kalau cookie diperbarui. */
  public get needsCookies(): boolean {
    return this.kind === 'bot-detection';
  }
}

/**
 * Deteksi "YouTube mengira kita bot".
 *
 * Pengecekan "age-restricted" sengaja dilakukan lebih dulu dan mengembalikan
 * false: video umur terbatas juga memunculkan kalimat "Sign in to confirm", jadi
 * tanpa urutan ini video tersebut salah dikategorikan sebagai deteksi bot dan
 * bot akan blames cookie padahal masalahnya lain.
 */
export function isBotDetectionError(message: string): boolean {
  const lower = message.toLowerCase();
  if (lower.includes('age-restricted')) return false;

  return (
    lower.includes("sign in to confirm you're not a bot") ||
    lower.includes('sign in to confirm') ||
    lower.includes('please sign in') ||
    lower.includes('http error 429') ||
    lower.includes('error 429') ||
    lower.includes('too many requests') ||
    (lower.includes('this video is unavailable') && lower.includes('429')) ||
    lower.includes('login required')
  );
}

/**
 * Deteksi rate limit (HTTP 429).
 *
 * Ini sengaja dipisahkan dari deteksi bot: pesan 429 memuat kalimat yang sama
 * dengan "Sign in to confirm you're not a bot", tapi penyebabnya berbeda — server
 * sedang menahan permintaan, bukan salah understandi identitas. Rawon menghitung
 * 429 sebagai deteksi bot; di sini 429 masuk kategori gangguan sesaat karena
 * saran yang benar adalah menunggu lalu mencoba lagi, bukan meminta pengguna
 * memperbarui cookie yang sebenarnya tidak salah.
 */
export function isRateLimitedError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('http error 429') ||
    lower.includes('error 429') ||
    lower.includes('too many requests') ||
    lower.includes('rate-limit') ||
    lower.includes('rate limit')
  );
}

/** Deteksi konten umur terbatas. */
export function isAgeRestrictedError(message: string): boolean {
  const lower = message.toLowerCase();
  if (lower.includes('age restricted content')) return true;

  return (
    lower.includes('age-restricted') &&
    (lower.includes('sign in') || lower.includes('confirm'))
  );
}

/**
 * Gangguan yang akan hilang bila dicoba lagi.
 *
 * Daftar ini disusun dari kalimat yang benar-benar keluar dari yt-dlp, bukan
 * tebakan: pola yang terlalu longgar akan menelan video yang memang tidak bisa
 * diputar (mis. "video tidak ditemukan") dan membanjiri log dengan percobaan
 * ulang yang sia-sia.
 */
const TRANSIENT_PATTERNS = [
  'http error 429',
  'error 429',
  'too many requests',
  'unable to download webpage',
  'connection reset',
  'econnreset',
  'etimedout',
  'esockettimedout',
  'eai_again',
  'timed out',
  'temporary failure in name resolution',
  'getaddrinfo',
  'network is unreachable',
  'read error',
  'incomplete read',
  'peer closed connection',
  'service unavailable',
] as const;

/** True kalau pesan galat masuk kategori gangguan sesaat. */
export function isTransientError(message: string): boolean {
  const lower = message.toLowerCase();
  return TRANSIENT_PATTERNS.some((pattern) => lower.includes(pattern));
}

/** Pola "HTTP Error 403", "http 403", atau "HTTP Error 403: Forbidden". */
const HTTP_STATUS_PATTERN = /http(?:\s+error)?\s+(\d{3})/iu;

/** Status code dari pesan galat, atau null kalau tidak ada. */
export function parseHttpStatusCode(message: string): number | null {
  const match = HTTP_STATUS_PATTERN.exec(message);
  if (!match) return null;

  const code = Number.parseInt(match[1] as string, 10);
  return Number.isNaN(code) ? null : code;
}

/** Status yang artinya tautan media sudah tidak berlaku lagi. */
const EXPIRED_STATUS_CODES = new Set([401, 403, 404, 410]);

/** Ekstensi yang menandai URL media langsung, bukan halaman video. */
const DIRECT_MEDIA_PATTERN = /\.(mp4|m4a|webm|mp3|opus|wav|flac)(?:\?|$)/iu;

/** Pola "tidak bisa diputar" yang tidak akan berubah kalau diulang. */
const UNAVAILABLE_PATTERNS = [
  'video unavailable',
  'this video is private',
  'private video',
  'video has been removed',
  'removed by the uploader',
  'account associated with this video has been terminated',
  'members-only',
  'join this channel',
  'requested video is not available',
  'unsupported url',
  'no video formats found',
] as const;

/** Klasifikasikan pesan galat menjadi satu jenis kegagalan. */
export function classifyStreamFailure(message: string): StreamFailureKind {
  // Urutan penting: video umur terbatas dan rate limit sama-sama memuat
  // kalimat "Sign in to confirm", jadi keduanya diperiksa lebih dulu.
  if (isAgeRestrictedError(message)) return 'age-restricted';
  if (isRateLimitedError(message)) return 'transient';
  if (isBotDetectionError(message)) return 'bot-detection';

  const status = parseHttpStatusCode(message);
  if (status !== null && EXPIRED_STATUS_CODES.has(status) && DIRECT_MEDIA_PATTERN.test(message)) {
    return 'expired-media';
  }

  const lower = message.toLowerCase();
  if (isTransientError(message)) return 'transient';
  if (UNAVAILABLE_PATTERNS.some((pattern) => lower.includes(pattern))) return 'unavailable';

  return 'unknown';
}

/** Bangun `StreamError` dari pesan mentah yt-dlp atau ffmpeg. */
export function toStreamError(message: string, url?: string): StreamError {
  const kind = classifyStreamFailure(message);
  const clean = message.trim();

  return new StreamError(
    kind,
    clean.length > 0 ? clean : 'Gagal mengambil audio tanpa keterangan',
    url,
  );
}
