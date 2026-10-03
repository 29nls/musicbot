import { MAX_NAME_LENGTH, MAX_RESPONSE_LENGTH, TRIGGER_PREFIX } from './types.js';

/**
 * Validasi nama pemicu & isi balasan custom command.
 *
 * Murni: aturannya diperiksa sebelum baris tersimpan, supaya tidak ada
 * perintah dengan nama kosong atau nama yang mustahil dipanggil orang lain yang
 * harus dihapus manual oleh admin.
 */

/**
 * Nama yang valid: diawali huruf, lalu boleh huruf, angka, strip, dan garis bawah.
 *
 * Huruf pertama wajib: `!123` lebih sering terbaca sebagai nomor daripada
 * perintah, dan nama seperti itu juga langsung mengaktifkan satu baris database
 * yang tidak pernah dipakai member.
 */
const NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;

/** Nama pemicu tidak valid; pesannya aman langsung ditampilkan ke admin. */
export class CustomCommandValidationError extends Error {
  public override readonly name = 'CustomCommandValidationError';

  constructor(message: string) {
    super(message);
  }
}

export interface ParseNameOptions {
  /** Awalan yang boleh ikut diketik admin, mis. `!ping`. Default: `!`. */
  prefix?: string;
  /** Nama lain yang tidak boleh dipakai (mis. perintah slash yang aktif). */
  reserved?: readonly string[];
}

/**
 * Bersihkan nama pemicu dari yang diketik admin.
 *
 * Admin boleh mengetik `ping` maupun `!ping` — keduanya bermaksud sama, dan
 * menolak salah satunya hanya membuat mereka mengulang dengan bentuk lain.
 * Huruf besar dikecilkan karena pemicu dibaca apa adanya, tanpa melihat huruf
 * besar-kecil.
 */
export function parseTriggerName(raw: string, options: ParseNameOptions = {}): string {
  const prefix = options.prefix ?? TRIGGER_PREFIX;
  let name = raw.trim().toLocaleLowerCase('id');

  if (prefix && name.startsWith(prefix)) name = name.slice(prefix.length).trim();

  if (name.length === 0) {
    throw new CustomCommandValidationError('Nama perintah tidak boleh kosong.');
  }

  if (name.length > MAX_NAME_LENGTH) {
    throw new CustomCommandValidationError(
      `Nama perintah maksimal ${MAX_NAME_LENGTH} karakter (sekarang ${name.length}).`,
    );
  }

  if (!NAME_PATTERN.test(name)) {
    throw new CustomCommandValidationError(
      'Nama perintah harus diawali huruf, lalu hanya boleh huruf, angka, strip (-), dan garis bawah (_).',
    );
  }

  const reserved = (options.reserved ?? []).map((item) => item.toLocaleLowerCase('id'));
  if (reserved.includes(name)) {
    throw new CustomCommandValidationError(
      `\`${prefix}${name}\` tidak boleh dipakai: nama itu dipakai perintah Harmony yang lain. ` +
        'Pilih nama lain supaya tidak ambigu.',
    );
  }

  return name;
}

/**
 * Bersihkan isi balasan.
 *
 * Baris baru di dalam balasan dipertahankan — pesan/ruleset memang ditulis
 * berbaris — tapi spasi beruntun diratakan supaya pesan yang ditempel dari
 * dokumen tidak terlihat seperti hasil autocorrect.
 */
export function parseResponse(raw: string): string {
  const response = raw.replace(/\r\n?/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();

  if (response.length === 0) {
    throw new CustomCommandValidationError('Isi balasan tidak boleh kosong.');
  }

  if (response.length > MAX_RESPONSE_LENGTH) {
    throw new CustomCommandValidationError(
      `Isi balasan maksimal ${MAX_RESPONSE_LENGTH} karakter (sekarang ${response.length}).`,
    );
  }

  return response;
}

/** Normalisasi nama untuk perbandingan (sama dengan yang dipakai trigger). */
export function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase('id');
}

/** Dua nama dianggap sama kalau berbeda hanya huruf besar-kecil. */
export function isSameName(left: string, right: string): boolean {
  return nameKey(left) === nameKey(right);
}