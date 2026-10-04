import { defaultTranslator, type MessageKey } from '../i18n/index.js';
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
    throw new PlaylistNameError('playlist.errNameEmpty');
  }

  if (name.length > MAX_PLAYLIST_NAME_LENGTH) {
    throw new PlaylistNameError(
      'playlist.errNameTooLong',
      { max: MAX_PLAYLIST_NAME_LENGTH, count: name.length },
    );
  }

  return name;
}

/**
 * Nama playlist tidak valid; pesannya aman langsung ditampilkan ke member.
 *
 * Menyimpan kunci katalog + parameter, bukan kalimat: pemanggil yang menyusun
 * embed terakhir baru tahu bahasa server. `message` diturunkan dari bahasa
 * bawaan supaya error yang terbaca di log tetap kalimat yang bisa dicari.
 */
export class PlaylistNameError extends Error {
  public override readonly name = 'PlaylistNameError';

  constructor(
    public readonly key: MessageKey,
    public readonly params?: Record<string, string | number>,
  ) {
    super(defaultTranslator(key, params));
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