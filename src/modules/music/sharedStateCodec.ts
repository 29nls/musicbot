import { LOOP_MODES, type LoopMode } from './loop.js';
import type { TrackInfo } from './types.js';

/**
 * Serialisasi state musik per server untuk `KeyValueStore` (§9.4).
 *
 * Isi record ini adalah dua hal yang harus dibaca proses mana pun yang menangani
 * guild tersebut: antrean lagu yang belum diputar dan mode loop aktif. Keduanya
 * tidak boleh hidup di memori satu proses, karena itulah yang membuat guild yang
 * di-sharding bisa ditangani proses berbeda antara satu perintah dan perintah
 * berikutnya.
 *
 * Karena isinya harus berupa string, decoder harus **toleran**: yang dibaca bisa
 * saja ditulis versi kode sebelumnya, ditulis proses lain, atau rusak karena
 * alasan lain. Bedanya dengan codec session `/search` ada di arti "tidak
 * terbaca":
 *
 * - Session `/search` yang rusak dibuang seluruhnya, karena select menunya sudah
 *   tidak cocok dengan apa yang ditampilkan ke user.
 * - Antrean yang rusak **dibalikkan jadi antrean kosong**, karena itu keadaan
 *   yang selalu benar dan selalu bisa dipulihkan: user mengetik `/play` lagi.
 *   Membatalkan pemutaran yang sedang berjalan demi satu baris JSON yang salah
 *   baca adalah kerugian yang jauh lebih besar daripada mengulang satu lagu.
 */

/** Batas lagu yang diterima dari store. */
export const MAX_STORED_TRACKS = 1_000;

/** Bentuk record yang disimpan dan dibaca lintas proses. */
export interface SharedMusicRecord {
  /** Lagu yang belum diputar, urut. */
  tracks: TrackInfo[];
  /** Mode loop server ini. */
  loopMode: LoopMode;
  /** Kapan record ini terakhir ditulis (ms). */
  updatedAt: number;
  /**
   * Naik satu setiap tulis.
   *
   * Tidak dipakai untuk memutuskan apa pun — mutasi antrean masih read-modify-write
   * tanpa pembanding. Gunanya untuk diagnosa: kalau dua proses saling menimpa,
   * nomor versi menunjukkan urutan tulis yang benar-benar terjadi.
   */
  version: number;
}

/** Record kosong; keadaan yang selalu benar saat store tidak punya data. */
export function emptyRecord(): SharedMusicRecord {
  return { tracks: [], loopMode: 'off', updatedAt: 0, version: 0 };
}

export function encodeSharedMusicState(record: SharedMusicRecord): string {
  return JSON.stringify({
    tracks: record.tracks.map((track) => ({
      encoded: track.encoded,
      title: track.title,
      author: track.author,
      durationMs: track.durationMs,
      uri: track.uri,
      artworkUrl: track.artworkUrl,
      isStream: track.isStream,
      requesterId: track.requesterId,
    })),
    loopMode: record.loopMode,
    updatedAt: record.updatedAt,
    version: record.version,
  });
}

/**
 * Baca record dari store; selalu mengembalikan record yang bisa dipakai.
 *
 * Tidak pernah mengembalikan null dan tidak pernah melempar: key yang hilang,
 * JSON rusak, atau track dengan bentuk salah semuanya berakhir di state kosong
 * yang bisa ditulis ulang tanpa merusak apa pun.
 */
export function decodeSharedMusicState(raw: string | null): SharedMusicRecord {
  if (!raw) return emptyRecord();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyRecord();
  }

  if (typeof parsed !== 'object' || parsed === null) return emptyRecord();

  const item = parsed as Record<string, unknown>;
  const tracks = readTracks(item.tracks);

  return {
    tracks,
    loopMode: readLoopMode(item.loopMode),
    updatedAt: readNumber(item.updatedAt) ?? 0,
    version: readNumber(item.version) ?? 0,
  };
}

/**
 * Track yang bentuknya salah **dilewati**, bukan membatalkan seluruh record.
 *
 * Berbeda dari session `/search`: satu baris rusak di antara 50 lagu tidak
 * berarti semua antrean hilang, dan satu lagu yang salah bentuk tidak pernah
 * bisa diputar karena `encoded` kosong.
 */
function readTracks(value: unknown): TrackInfo[] {
  if (!Array.isArray(value)) return [];

  const tracks: TrackInfo[] = [];
  for (const entry of value) {
    const track = toTrack(entry);
    if (track) tracks.push(track);
    if (tracks.length >= MAX_STORED_TRACKS) break;
  }

  return tracks;
}

function toTrack(value: unknown): TrackInfo | null {
  if (typeof value !== 'object' || value === null) return null;

  const track = value as Record<string, unknown>;
  // `encoded` wajib ada: tanpa itu bot tidak punya apa pun untuk dikirim ke
  // Lavalink, jadi baris seperti ini bukan lagu yang bisa diputar.
  if (typeof track.encoded !== 'string' || track.encoded.length === 0) return null;
  if (typeof track.durationMs !== 'number' || !Number.isFinite(track.durationMs)) return null;

  return {
    encoded: track.encoded,
    title: typeof track.title === 'string' ? track.title : '',
    author: typeof track.author === 'string' ? track.author : '',
    durationMs: track.durationMs,
    uri: typeof track.uri === 'string' ? track.uri : null,
    artworkUrl: typeof track.artworkUrl === 'string' ? track.artworkUrl : null,
    isStream: track.isStream === true,
    requesterId: typeof track.requesterId === 'string' ? track.requesterId : '',
  };
}

function readLoopMode(value: unknown): LoopMode {
  return LOOP_MODES.includes(value as LoopMode) ? (value as LoopMode) : 'off';
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
