import { pickTracks } from '../music/selection.js';
import { toTrackInfo } from '../music/track.js';
import type { SearchOutcome, TrackInfo } from '../music/types.js';
import { MAX_PLAYLIST_NAME_LENGTH, MAX_PLAYLIST_TRACKS, type StoredTrack } from './types.js';

/**
 * Berapa lagu di-resolve ke Lavalink sekaligus.
 *
 * Playlist bisa berisi ratusan lagu; resolve semuanya sekaligus akan membanjiri
 * node dan memperlambat yang lain. Diproses per bagian dengan urutan terjaga
 * supaya antrean tetap sama seperti saat playlist disimpan.
 */
export const RESOLVE_CHUNK_SIZE = 5;

/** TrackInfo → bentuk yang disimpan di kolom JSON. */
export function toStoredTrack(track: TrackInfo): StoredTrack {
  return {
    title: track.title,
    author: track.author,
    durationMs: track.isStream ? 0 : track.durationMs,
    uri: track.uri,
    encoded: track.encoded,
  };
}

/**
 * Baca kolom JSON playlist menjadi daftar StoredTrack.
 *
 * **Sengaja toleran, bukan ketat.** Kolom JSON bisa berisi apa saja — diedit
 * manual, hasil versi bot yang lebih lama, atau baris rusak. Menolak seluruh
 * playlist karena satu entri tidak terbaca akan menghapus ratusan lagu
 * milik orang; membuang entri buruknya saja membuat playlist tetap berguna dan
 * yang hilang bisa dilaporkan sebagai "tidak bisa diputar".
 *
 * Satu-satunya syarat entri untuk diterima: punya judul string.
 */
export function parseStoredTracks(value: unknown): StoredTrack[] {
  if (!Array.isArray(value)) return [];

  const tracks: StoredTrack[] = [];

  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;

    const candidate = item as Record<string, unknown>;
    const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
    if (title.length === 0) continue;

    tracks.push({
      title,
      author: typeof candidate.author === 'string' ? candidate.author.trim() : '',
      // Durasi boleh hilang atau rusak di baris lama: 0 berarti "tidak
      // diketahui", bukan data yang layak dipercaya untuk dijumlahkan.
      durationMs:
        typeof candidate.durationMs === 'number' && Number.isFinite(candidate.durationMs)
          ? Math.max(Math.trunc(candidate.durationMs), 0)
          : 0,
      uri: typeof candidate.uri === 'string' && candidate.uri.length > 0 ? candidate.uri : null,
      encoded:
        typeof candidate.encoded === 'string' && candidate.encoded.length > 0
          ? candidate.encoded
          : null,
    });
  }

  return tracks;
}

/** Siapkan daftar StoredTrack untuk ditulis ke kolom JSON. */
export function serializeTracks(tracks: readonly StoredTrack[]): StoredTrack[] {
  return tracks
    .slice(0, MAX_PLAYLIST_TRACKS)
    .map((track) => ({
      title: track.title.slice(0, MAX_PLAYLIST_NAME_LENGTH * 5),
      author: track.author.slice(0, 200),
      durationMs: Math.max(Math.trunc(track.durationMs), 0),
      uri: track.uri,
      encoded: track.encoded,
    }));
}

/** Hasil pemuatan ulang playlist. */
export interface ResolvedPlaylist {
  tracks: TrackInfo[];
  /** Berapa entri yang tidak bisa diputar (sumber hilang atau ditolak Lavalink). */
  failed: number;
}

/**
 * Resolve satu entri untuk pemutar — bentuk fungsi yang dipakai perintah.
 */
export type TrackResolver = (uri: string) => Promise<SearchOutcome>;

/**
 * Ubah StoredTrack menjadi TrackInfo yang siap dimasukkan ke antrean.
 *
 * Yang menentukan di sini:
 * - **`uri` dicoba lebih dulu.** `encoded` Lavalink bisa basi (node restart,
 *   ganti password, upgrade versi), jadi andalinya di-resolve ulang. Playlist
 *   lama karena itu tetap bisa diputar tanpa disunting siapa pun.
 * - **`encoded` dipakai kalau `uri` tidak ada** — sumber terakhir, bukan pilihan
 *   utama: ia tidak pernah bisa diperiksa tanpa memanggil Lavalink.
 * - **Entri tanpa keduanya dihitung gagal**, bukan diputar sebagai lagu kosong.
 * - **Lagu yang ditolak Lavalink dihitung gagal**, dan jumlahnya dikembalikan.
 *   Diam-diam memutar 8 dari 10 lagu sambil melaporkan "berhasil" adalah cara
 *   halus membuat orang mengira lagunya hilang tanpa penjelasan.
 */
export async function resolveStoredTracks(
  entries: readonly StoredTrack[],
  resolve: TrackResolver,
  requesterId: string,
): Promise<ResolvedPlaylist> {
  const results = await mapInOrder(entries, RESOLVE_CHUNK_SIZE, async (entry) => {
    if (entry.uri) {
      const outcome = await resolve(entry.uri);
      // Satu lagu per entri — aturannya sama dengan `/play`, dan sengaja diambil
      // dari `selection.ts` supaya jumlah lagu hanya dijawab di satu tempat.
      const [raw] = pickTracks(outcome, 'single', entry.uri);
      return raw ? toTrackInfo(raw, requesterId) : null;
    }

    if (entry.encoded) {
      return {
        encoded: entry.encoded,
        title: entry.title,
        author: entry.author,
        durationMs: entry.durationMs,
        uri: null,
        artworkUrl: null,
        isStream: entry.durationMs <= 0,
        requesterId,
      } satisfies TrackInfo;
    }

    return null;
  });

  const tracks = results.filter((track): track is TrackInfo => track !== null);

  return { tracks, failed: entries.length - tracks.length };
}

/** `Promise.all` per potongan: paralel tapi urutan hasil tetap sama. */
async function mapInOrder<T, R>(
  items: readonly T[],
  chunkSize: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const size = Math.max(chunkSize, 1);

  for (let start = 0; start < items.length; start += size) {
    const chunk = items.slice(start, start + size);
    results.push(...(await Promise.all(chunk.map((item, offset) => fn(item, start + offset)))));
  }

  return results;
}