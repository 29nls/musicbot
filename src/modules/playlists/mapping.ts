import { parseStoredTracks } from './tracks.js';
import type { Playlist } from './types.js';

/**
 * Bentuk baris tabel `playlist` yang dibutuhkan pemetaan. Didefinisikan lokal
 * (bukan tipe Prisma) supaya bisa dites tanpa database.
 */
export interface PlaylistRow {
  id: number;
  guildId: string;
  ownerId: string;
  name: string;
  tracks: unknown;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Baris database → domain.
 *
 * Kolom `tracks` dibaca lewat `parseStoredTracks` (toleran) supaya baris dengan
 * JSON rusak tidak membuat satu playlist menggagalkan seluruh daftar playlist —
 * playlist lain harus tetap tampil.
 */
export function toDomain(row: PlaylistRow): Playlist {
  return {
    id: row.id,
    guildId: row.guildId,
    ownerId: row.ownerId,
    name: row.name,
    tracks: parseStoredTracks(row.tracks),
    isPublic: row.isPublic,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}