/**
 * Anonimasi data member atas permintaan penghapusan (PRD Bab 12).
 *
 * Murni — pseudonim & penanda teksnya dihitung tanpa database, supaya aturan
 * "apa yang dibuang dan apa yang tersisa" bisa diuji tanpa efek samping.
 */

import { createHash } from 'node:crypto';

/**
 * Prefix pseudonim.
 *
 * Sengaja **bukan** snowflake: ID Discord 18 digit, jadi kalau identitasnya
 * diganti dengan angka yang bentuknya sama, ada bagian dari sistem (embed
 * lama yang sudah tersalin, pesan log yang sudah diedit tangan) yang bisa
 * salah_artinya masih menunjuk orang sungguhan. Awalan non-numerik membuat
 * pola itu mustahil.
 */
const PSEUDONYM_PREFIX = 'anon';

/** Panjang sidik hash yang dipakai; cukup untuk membedakan, bukan untuk aman. */
const HASH_LENGTH = 10;

/** Panjang maksimum kolom `target_id`/`user_id`/`opener_id` (VarChar 20). */
export const PSEUDONYM_MAX_LENGTH = 20;

/**
 * Pseudonim stabil untuk satu member di satu server.
 *
 * Stabil itu disengaja: kalau tidak, permintaan penghapusan kedua akan membuat
 * identitas baru untuk orang yang sama dan baris yang sudah dianonimkan tidak
 * pernah bisa ditemukan lagi — user akan melihat "tidak ada data" padahal
 * datanya masih ada dalam bentuk yang tidak lagi terhubung padanya.
 *
 * Sifatnya satu arah dan tidak bisa dibalik: pemetaannya dihancurkan saat
 * `targetId` ditimpa, jadi setelah permintaan berjalan tidak ada lagi yang
 * bisa mengaitkan pseudonim itu kembali ke orangnya — bot maupun siapa pun.
 */
export function pseudonymFor(guildId: string, userId: string): string {
  const digest = createHash('sha256').update(`${guildId}:${userId}`).digest('hex');

  return `${PSEUDONYM_PREFIX}:${digest.slice(0, HASH_LENGTH)}`.slice(0, PSEUDONYM_MAX_LENGTH);
}

/**
 * Penanda yang menggantikan alasan kasus / topik tiket.
 *
 * Penanda, bukan string kosong: moderator yang membuka kasus satu tahun kemudian
 * harus bisa membedakan "memang tidak ada alasan" dari "ada alasannya tapi
 * dihapus atas permintaan". Tanpa itu, setiap kasus yang dianonimkan akan dibaca
 * sebagai moderator yang beracting tanpa bukti.
 */
export const REASON_ANONYMIZED_MARKER = '(alasan dihapus atas permintaan pengguna)';

/** Penanda yang menggantikan topik tiket. */
export const SUBJECT_ANONYMIZED_MARKER = '(topik dihapus atas permintaan pengguna)';

/** Apa yang terjadi pada tiap kelompok data — dipakai embed & teks perintah. */
export interface AnonymizeOutcome {
  /** Pseudonim yang dipakai; ditampilkan supaya bisa diverifikasi afterward. */
  pseudonym: string;
  /** Kasus moderasi (termasuk catatan internal) yang identitasnya dilepas. */
  cases: number;
  /** Baris peringatan yang ikut dilepas. */
  warnings: number;
  /** Tiket yang identitasnya dilepas. */
  tickets: number;
  /** Transkrip percakapan yang **dihapus** — tidak bisa dianonimkan. */
  transcripts: number;
  /** Entri log yang dihapus seluruhnya. */
  logEntries: number;
  /** Playlist yang pemiliknya dilepas; isi lagunya tetap ada. */
  playlists: number;
  /** Perintah custom yang pembuatnya dilepas; isi balasannya tetap ada. */
  customCommands: number;
}

export function emptyAnonymizeOutcome(pseudonym: string): AnonymizeOutcome {
  return {
    pseudonym,
    cases: 0,
    warnings: 0,
    tickets: 0,
    transcripts: 0,
    logEntries: 0,
    playlists: 0,
    customCommands: 0,
  };
}
