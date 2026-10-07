import { isUrl } from './search.js';
import type { RawTrack, SearchOutcome } from './types.js';

/**
 * Aturan tunggal "berapa lagu yang layak dipakai" dari satu hasil pencarian.
 *
 * Sebelum modul ini, keputusan itu ditulis ulang di tiap pemanggil dan
 * bunyinya berbeda-beda — dan perbedaannya bukan detail kosmetik: `slice(0, 1)`
 * yang lupa ditulis membuat `/play` memutar puluhan lagu berturut-turut,
 * sementara aturan yang sama di `/playlist add` justru menghapus isi playlist
 * yang sengaja ditempel orang. Yang salah bukan salah satu pemanggilnya,
 * melainkan bahwa ada empat tempat yang masing-masing menjawab pertanyaan yang
 * sama. Sekarang jawabannya satu, dan tiap perubahan berlaku untuk semuanya
 * sekaligus.
 */

/** Berapa hasil yang ditawarkan ke user (PRD §6.1: "Cari 5 hasil"). */
export const SEARCH_RESULT_LIMIT = 5;

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
  | 'save';

/**
 * Ambil lagu yang layak dipakai dari hasil `resolve()`.
 *
 * Hasil selain daftar track (`empty`, `error`, `unavailable`) menjadi daftar
 * kosong: pemanggil yang sudah menangani pesan kegagalannya sendiri tidak perlu
 * menebak-nebak lagi, dan tidak ada halaman kosong yang lolos ke embed.
 */
export function pickTracks(
  outcome: SearchOutcome,
  purpose: TrackPickPurpose,
  query: string,
): RawTrack[] {
  if (outcome.kind !== 'tracks') return [];

  switch (purpose) {
    case 'single':
      return outcome.tracks.slice(0, 1);
    case 'choices':
      return outcome.tracks.slice(0, SEARCH_RESULT_LIMIT);
    case 'save':
      return isUrl(query) ? outcome.tracks : outcome.tracks.slice(0, 1);
  }
}
