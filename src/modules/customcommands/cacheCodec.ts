import type { CustomCommand } from './types.js';
import { nameKey } from './validation.js';

/**
 * Serialisasi cache daftar perintah custom.
 *
 * Cache-nya sekarang hidup di `KeyValueStore` (Redis atau memori), jadi isinya
 * harus berupa string — dan harus **toleran**: yang dibaca bisa saja ditulis
 * versi kode sebelumnya, oleh proses lain, atau rusak karena alasan lain.
 *
 * Aturan decoding yang dipakai di sini:
 *
 * - **JSON rusak berarti "cache tidak ada"**, bukan error. Cache cuma
 *   penghematan satu query; satu baris rusak tidak boleh membuat semua
 *   `!perintah` di server itu diam.
 * - **Entri yang bentuknya salah dilewati**, bukan menggagalkan seluruh daftar.
 * - **Hanya field yang dibutuhkan** ikut disimpan, supaya cache tidak ikut
 *   menyimpan data yang tidak pernah dipakai.
 */

/** Bentuk yang disimpan di store: hanya field yang dibutuhkan saat lookup. */
export interface CachedCommand {
  id: number;
  guildId: string;
  name: string;
  response: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export function encodeCommandCache(commands: readonly CustomCommand[]): string {
  const payload: CachedCommand[] = commands.map((command) => ({
    id: command.id,
    guildId: command.guildId,
    name: command.name,
    response: command.response,
    createdBy: command.createdBy,
    createdAt: command.createdAt.toISOString(),
    updatedAt: command.updatedAt.toISOString(),
  }));

  return JSON.stringify(payload);
}

/**
 * Baca cache; selalu mengembalikan daftar (kosong kalau tidak ada / rusak).
 *
 * `CustomCommand` punya dua field `Date`, jadi harus dikonversi kembali:
 * `JSON.parse` hanya menghasilkan string, dan date yang kembali sebagai string
 * tidak bisa dipakai sebagai `Date` tanpa dikonversi.
 */
export function decodeCommandCache(raw: string | null): CustomCommand[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const commands: CustomCommand[] = [];
  for (const item of parsed) {
    const command = toCommand(item);
    if (command) commands.push(command);
  }

  return commands;
}

/** Ubah satu entri cache menjadi domain; null kalau bentuknya tidak sesuai. */
function toCommand(value: unknown): CustomCommand | null {
  if (typeof value !== 'object' || value === null) return null;

  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'number' || !Number.isFinite(item.id)) return null;
  if (typeof item.name !== 'string' || nameKey(item.name).length === 0) return null;
  if (typeof item.response !== 'string') return null;

  const createdAt = new Date(typeof item.createdAt === 'string' ? item.createdAt : '');
  const updatedAt = new Date(typeof item.updatedAt === 'string' ? item.updatedAt : '');
  if (Number.isNaN(createdAt.getTime()) || Number.isNaN(updatedAt.getTime())) return null;

  return {
    id: item.id,
    guildId: typeof item.guildId === 'string' ? item.guildId : '',
    name: item.name,
    response: item.response,
    createdBy: typeof item.createdBy === 'string' ? item.createdBy : '',
    createdAt,
    updatedAt,
  };
}