/**
 * Custom command (Fase 2, PRD §5.2): teks balasan buatan admin yang dipanggil
 * member dengan mengetik pemicunya di channel teks.
 *
 * Bentuk domainnya terpisah dari baris database supaya seluruh aturan nama,
 * pemicu, dan render bisa diuji tanpa database maupun Discord.
 */

/** Awalan pemicu: member mengetik `!nama` untuk memanggil perintahnya. */
export const TRIGGER_PREFIX = '!';

/**
 * Batas nama pemicu (juga panjang kolom `name`).
 * Cukup untuk `rules-and-minutes` tanpa membuat orang mengetik nama yang
 * mustahil diketik orang lain.
 */
export const MAX_NAME_LENGTH = 32;

/**
 * Batas isi balasan. Discord menerima 2.000 karakter per pesan, jadi angka ini
 * disisakan ruang supaya pesan tetap bisa ditambah keterangan internal tanpa
 * gagal terkirim.
 */
export const MAX_RESPONSE_LENGTH = 1_900;

/** Berapa perintah yang ditampilkan di `/customcommand list`. */
export const CUSTOM_COMMAND_LIST_LIMIT = 25;

/** Placeholder yang bisa dipakai di dalam balasan. */
export const PLACEHOLDER_TOKENS = [
  '{pengguna}',
  '{nama}',
  '{server}',
  '{channel}',
  '{args}',
] as const;

/**
 * Jeda antar pemicu untuk satu member.
 *
 * Tanpa ini, satu orang bisa membuat bot membalas puluhan pesan dengan
 * mengetik pemicu yang sama berulang — dan di server yang punya perintah
 * balasan panjang, itu jadi garis spam yang isinya bukan orang.
 */
export const TRIGGER_COOLDOWN_SECONDS = 5;

/** Umur cache daftar perintah per server (ms). */
export const GUILD_CACHE_TTL_MS = 60_000;

/** Berapa server yang boleh menyimpan cache perintah pada satu proses. */
export const GUILD_CACHE_LIMIT = 100;

/** Satu perintah custom seperti yang dilihat bot. */
export interface CustomCommand {
  id: number;
  guildId: string;
  /** Nama pemicu tanpa `!`, selalu huruf kecil. */
  name: string;
  response: string;
  /** Admin yang membuatnya; pseudonim setelah `/data-delete`. */
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCustomCommandInput {
  guildId: string;
  name: string;
  response: string;
  createdBy: string;
}

/** Hasil menyimpan perintah: baru dibuat, atau menimpa yang lama. */
export type SaveCustomCommandResult =
  | { kind: 'created'; command: CustomCommand }
  | { kind: 'replaced'; command: CustomCommand };

/** Hasil mengubah balasan perintah yang sudah ada. */
export type EditCustomCommandResult =
  | { kind: 'updated'; command: CustomCommand }
  | { kind: 'not-found' };

/** Hasil menghapus perintah. */
export type DeleteCustomCommandResult =
  | { kind: 'deleted'; command: CustomCommand }
  | { kind: 'not-found' };