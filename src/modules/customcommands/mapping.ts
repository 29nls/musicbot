import type { CustomCommand } from './types.js';

/**
 * Bentuk baris tabel `custom_command` yang dibutuhkan pemetaan.
 * Sengaja didefinisikan lokal (bukan mengimpor tipe Prisma) supaya file ini
 * bisa dites tanpa database dan tidak terikat versi generator Prisma.
 */
export interface CustomCommandRow {
  id: number;
  guildId: string;
  name: string;
  response: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Baris DB → domain. Nama selalu dinormalkan supaya perbandingan konsisten. */
export function toDomain(row: CustomCommandRow): CustomCommand {
  return {
    id: row.id,
    guildId: row.guildId,
    name: row.name.toLocaleLowerCase('id'),
    response: row.response,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}