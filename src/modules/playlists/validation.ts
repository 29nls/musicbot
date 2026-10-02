import { MAX_PLAYLIST_NAME_LENGTH } from './types.js';

/**
 * Bersihkan nama playlist.
 *
 * Spasi berulang diratakan supaya "lofi  beat" tetap tampil rapi di daftar, lalu
 * dipotong ke batas kolom. Menolak nama kosong atau terlalu panjang **di sini**,
 * sebelum baris tersimpan — bukan sesudahnya, supaya tidak ada playlist dengan
 * nama "  " yang harus dihapus manual member.
 *
 * Murni supaya aturannya bisa diuji tanpa Discord.
 */
export function parsePlaylistName(raw: string): string {
  const name = raw.replace(/\s+/g, ' ').trim();

  if (name.length === 0) {
    throw new PlaylistNameError('Nama playlist tidak boleh kosong.');
  }

  if (name.length > MAX_PLAYLIST_NAME_LENGTH) {
    throw new PlaylistNameError(
      `Nama playlist maksimal ${MAX_PLAYLIST_NAME_LENGTH} karakter ` +
        `(sekarang ${name.length}).`,
    );
  }

  return name;
}

/** Nama playlist tidak valid; pesannya aman langsung ditampilkan ke member. */
export class PlaylistNameError extends Error {
  public override readonly name = 'PlaylistNameError';

  constructor(message: string) {
    super(message);
  }
}

/**
 * Normalisasi nama untuk perbandingan.
 *
 * Postgres membedakan huruf besar-kecil, jadi tanpa ini satu member bisa punya
 * "Lofi" dan "lofi" sekaligus dan tidak tahu mana yang sedang diputar.
 */
export function nameKey(name: string): string {
  return name.toLocaleLowerCase('id');
}

/** Dua nama dianggap sama kalau berbeda hanya huruf besar-kecil. */
export function isSamePlaylistName(left: string, right: string): boolean {
  return nameKey(left) === nameKey(right);
}