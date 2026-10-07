import { isUrl } from './search.js';
import type { RawTrack } from './types.js';

/**
 * Aturan tunggal "berapa lagu yang layak dipakai" dari satu hasil pencarian —
 * sekaligus **satu-satunya tempat daftar lagunya bisa dibaca**.
 *
 * Sebelum modul ini, keputusan itu ditulis ulang di tiap pemanggil dan
 * bunyinya berbeda-beda — dan perbedaannya bukan detail kosmetik: `slice(0, 1)`
 * yang lupa ditulis membuat `/play` memutar puluhan lagu berturut-turut,
 * sementara aturan yang sama di `/playlist add` justru menghapus isi playlist
 * yang sengaja ditempel orang. Yang salah bukan salah satu pemanggilnya,
 * melainkan bahwa ada lima tempat yang masing-masing menjawab pertanyaan yang
 * sama. Aturannya sekarang satu, dan tiap perubahan berlaku untuk semuanya.
 *
 * **Kenapa daftar lagunya disembunyikan, bukan cuma "dilarang dibaca".**
 * Aturan yang hanya dijaga kesepakatan akan bocor lewat dua pintu yang bukan
 * kesalahan siapa pun: `as any` menghapus tipenya, dan tipe yang menyempit
 * (`Extract<SearchOutcome, { kind: 'tracks' }>`) membuat daftar lagunya jadi
 * properti biasa lagi. Karena itu payload-nya disimpan di balik kunci Symbol
 * yang **tidak diekspor**: di luar modul ini tidak ada ekspresi yang bisa
 * menulisnya, jadi `outcome.tracks` bukan "dilarang" melainkan **tidak ada**.
 * Menghapus tipe pun tidak mengembalikannya — `(outcome as any).tracks` bernilai
 * `undefined` di runtime, jadi jalur itu gagal terlihat, bukan diam-diam
 * memutar lagu yang tidak diminta.
 *
 * Yang tersisa sebagai jalan pintas adalah refleksi (`Object.values(outcome)`
 * mengembalikan daftar lagunya). Itu dijaga statis oleh
 * `tests/trackSelectionAst.test.ts` dengan cara yang sama seperti sebelumnya:
 * lewat tipe argumennya, bukan lewat tulisan.
 */

/** Berapa hasil yang ditawarkan ke user (PRD §6.1: "Cari 5 hasil"). */
export const SEARCH_RESULT_LIMIT = 5;

/**
 * Kunci payload daftar lagu — sengaja **tidak diekspor**.
 *
 * Satu simbol per proses, dan hanya modul ini yang tahu namanya.
 */
const TRACK_LIST = Symbol('SearchOutcome.tracks');

/** Hasil pencarian ke Lavalink. Daftar lagunya hanya bisa dibaca dari modul ini. */
export type SearchOutcome =
  | { kind: 'tracks'; readonly [TRACK_LIST]: readonly RawTrack[]; readonly playlistName?: string }
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
  | { kind: 'unavailable' };

/**
 * Hasil pencarian yang berisi lagu.
 *
 * Satu-satunya cara menyusun cabang `tracks`: pemanggil tidak bisa merakit
 * bentuknya sendiri, jadi tidak ada hasil pencarian yang lahir di luar kosakata
 * modul ini. `playlistName` opsional karena hasil `LoadType.PLAYLIST` membawanya
 * dan hasil `LoadType.SEARCH` tidak.
 */
export function foundTracks(
  tracks: readonly RawTrack[],
  playlistName?: string,
): SearchOutcome {
  if (playlistName === undefined) return { kind: 'tracks', [TRACK_LIST]: tracks };

  return { kind: 'tracks', [TRACK_LIST]: tracks, playlistName };
}

/** Untuk apa hasil pencarian itu dipakai — inilah yang menentukan jumlahnya. */
export type TrackPickPurpose =
  /** `/play` (US-01): tepat satu lagu, hasil terbaik, apa pun bentuk query-nya. */
  | 'single'
  /** `/search`: sampai `SEARCH_RESULT_LIMIT` pilihan untuk select menu. */
  | 'choices'
  /**
   * `/playlist add`: kata kunci menyimpan satu lagu terbaik, URL playlist
   * menyimpan seluruh isinya. Menyimpan playlist penuh memang tujuan perintah
   * itu (README), dan itulah bedanya dengan `/play` yang cuma mengambil lagu
   * pertamanya.
   */
  | 'save'
  /**
   * Kolam kandidat untuk mencocokkan metadata Spotify: seluruh hasil
   * dikembalikan utuh, karena yang memilih di sana adalah pencocokan metadata
   * (dan hasil akhirnya tetap satu lagu), bukan aturan jumlah lagu.
   */
  | 'candidates';

/**
 * Ambil lagu yang layak dipakai dari hasil `resolve()`.
 *
 * Hasil selain daftar track (`empty`, `error`, `unavailable`) menjadi daftar
 * kosong: pemanggil yang sudah menangani pesan kegagalannya sendiri tidak perlu
 * menebak-nebak lagi, dan tidak ada halaman kosong yang lolos ke embed.
 *
 * Salinan yang dikembalikan selalu array baru, jadi tidak ada pemanggil yang
 * bisa menyunting daftar di dalam hasil pencarian.
 */
export function pickTracks(
  outcome: SearchOutcome,
  purpose: TrackPickPurpose,
  query: string,
): RawTrack[] {
  if (outcome.kind !== 'tracks') return [];

  const tracks = outcome[TRACK_LIST];

  switch (purpose) {
    case 'single':
      return tracks.slice(0, 1);
    case 'choices':
      return tracks.slice(0, SEARCH_RESULT_LIMIT);
    case 'save':
      return isUrl(query) ? [...tracks] : tracks.slice(0, 1);
    case 'candidates':
      return [...tracks];
  }
}
