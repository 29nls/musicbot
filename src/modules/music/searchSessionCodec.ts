import type { TrackInfo } from './types.js';
import type { SearchSession } from './searchSession.js';

/**
 * Serialisasi session `/search` untuk `KeyValueStore` (§9.4).
 *
 * Session pencarian harus bisa dibaca proses lain: select menu yang dikirim di
 * satu guild bisa saja sampai ke shard berbeda (§5.3), jadi state-nya tidak
 * boleh hidup di memori satu proses.
 *
 * Karena isinya harus berupa string, decoder harus **toleran**: yang dibaca bisa saja
 * ditulis versi kode sebelumnya, proses lain, atau rusak karena alasan lain.
 * Aturan decoding yang dipakai di sini:
 *
 * - **JSON rusak berarti "tidak ada session"**, bukan error. Menu lama yang
 *   diklik harus mendapat penjelasan "sudah tidak berlaku", bukan kegagalan.
 * - **Hanya field yang dibutuhkan** ikut ditulis, dan hanya field itu yang
 *   dipercaya saat dibaca. Hasil decode masuk ke `enqueue()` Lavalink, jadi
 *   payload yang datang dari store tidak boleh diperlakukan sebagai data
 *   tepercaya begitu saja.
 */

/** Bentuk yang benar-benar ditulis ke store. */
interface StoredTrack {
  encoded: string;
  title: string;
  author: string;
  durationMs: number;
  uri: string | null;
  artworkUrl: string | null;
  isStream: boolean;
  requesterId: string;
}

export function encodeSearchSession(session: SearchSession): string {
  const payload = {
    token: session.token,
    guildId: session.guildId,
    requesterId: session.requesterId,
    query: session.query,
    createdAt: session.createdAt,
    tracks: session.tracks.map((track): StoredTrack => ({
      encoded: track.encoded,
      title: track.title,
      author: track.author,
      durationMs: track.durationMs,
      uri: track.uri,
      artworkUrl: track.artworkUrl,
      isStream: track.isStream,
      requesterId: track.requesterId,
    })),
  };

  return JSON.stringify(payload);
}

/**
 * Baca session dari store; `null` kalau tidak ada atau tidak bisa dipercaya.
 *
 * Satu track yang bentuknya salah membatalkan seluruh session (bukan dilewati):
 * hasil pencarian tanpa satu lagu berarti select menunya tidak lagi sesuai dengan
 * yang ditampilkan ke user, jadi lebih baik dijawab "tidak berlaku".
 */
export function decodeSearchSession(raw: string | null): SearchSession | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;

  const item = parsed as Record<string, unknown>;
  if (typeof item.token !== 'string' || item.token.length === 0) return null;
  if (typeof item.guildId !== 'string' || item.guildId.length === 0) return null;
  if (typeof item.requesterId !== 'string' || item.requesterId.length === 0) return null;
  if (typeof item.query !== 'string') return null;
  if (typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt)) return null;
  if (!Array.isArray(item.tracks) || item.tracks.length === 0) return null;

  const tracks: TrackInfo[] = [];
  for (const entry of item.tracks) {
    const track = toTrack(entry);
    if (!track) return null;
    tracks.push(track);
  }

  return {
    token: item.token,
    guildId: item.guildId,
    requesterId: item.requesterId,
    query: item.query,
    createdAt: item.createdAt,
    tracks,
  };
}

function toTrack(value: unknown): TrackInfo | null {
  if (typeof value !== 'object' || value === null) return null;

  const track = value as Record<string, unknown>;
  // `encoded` wajib ada: tanpa itu bot tidak punya apa pun untuk beamed ke
  // Lavalink, jadi select menu lama lebih baik dianggap tidak berlaku.
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
