import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { toDomain } from './mapping.js';
import { parseStoredTracks, serializeTracks } from './tracks.js';
import type { CreatePlaylistInput, Playlist, StoredTrack } from './types.js';

/**
 * Kontrak penyimpanan playlist — bisa diganti fake di tes.
 *
 * Pencarian nama selalu **tidak membedakan huruf besar-kecil**: nama playlist
 * adalah milik orang, dan dua baris "Lofi"/"lofi" hanya membuat orang tidak
 * tahu mana yang sedang diputar.
 */
export interface PlaylistRepository {
  create(input: CreatePlaylistInput, now: Date): Promise<Playlist>;
  findByName(guildId: string, ownerId: string, name: string): Promise<Playlist | null>;
  listOwned(guildId: string, ownerId: string, take: number): Promise<Playlist[]>;
  /** Cari playlist publik milik siapa pun dengan nama itu (tanpa huruf besar-kecil). */
  findPublicByName(guildId: string, name: string): Promise<Playlist | null>;
  listPublic(guildId: string, take: number): Promise<Playlist[]>;
  /** Tambah lagu di akhir playlist. */
  appendTracks(playlistId: number, tracks: readonly StoredTrack[]): Promise<Playlist | null>;
  /** Hapus satu lagu berdasarkan posisi (1 = pertama). */
  removeTrackAt(playlistId: number, index: number): Promise<Playlist | null>;
  setPublic(playlistId: number, isPublic: boolean): Promise<Playlist | null>;
  delete(playlistId: number): Promise<boolean>;
  /** Berapa playlist milik member ini — dipakai inventaris privasi. */
  countByOwner(guildId: string, ownerId: string): Promise<number>;
  /**
   * Anonimkan pemilik playlist atas permintaan penghapusan data.
   *
   * Playlist **dipertahankan**, hanya pemiliknya yang diganti pseudonim: nama
   * playlist dan daftar lagunya bukan tentang orang, sedangkan `ownerId` yang
   * membuatnya bisa dilacak kembali. Nama playlist milik satu orang sudah
   * unik per pemilik, jadi mengganti pemiliknya tidak pernah menabrak baris lain.
   */
  anonymizeOwner(guildId: string, ownerId: string, pseudonym: string): Promise<number>;
}

export class PrismaPlaylistRepository implements PlaylistRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreatePlaylistInput, now: Date): Promise<Playlist> {
    const row = await this.prisma.playlist.create({
      data: {
        guildId: input.guildId,
        ownerId: input.ownerId,
        name: input.name,
        tracks: [],
        isPublic: false,
        createdAt: now,
      },
    });

    return toDomain(row);
  }

  async findByName(guildId: string, ownerId: string, name: string): Promise<Playlist | null> {
    const row = await this.prisma.playlist.findFirst({
      where: { guildId, ownerId, name: { equals: name, mode: 'insensitive' } },
    });

    return row ? toDomain(row) : null;
  }

  async listOwned(guildId: string, ownerId: string, take: number): Promise<Playlist[]> {
    const rows = await this.prisma.playlist.findMany({
      where: { guildId, ownerId },
      orderBy: { name: 'asc' },
      take,
    });

    return rows.map(toDomain);
  }

  async findPublicByName(guildId: string, name: string): Promise<Playlist | null> {
    const row = await this.prisma.playlist.findFirst({
      where: { guildId, isPublic: true, name: { equals: name, mode: 'insensitive' } },
      orderBy: { updatedAt: 'desc' },
    });

    return row ? toDomain(row) : null;
  }

  async listPublic(guildId: string, take: number): Promise<Playlist[]> {
    const rows = await this.prisma.playlist.findMany({
      where: { guildId, isPublic: true },
      orderBy: { updatedAt: 'desc' },
      take,
    });

    return rows.map(toDomain);
  }

  /**
   * Tambah lagu di akhir playlist, dengan baca-modifis-tulis di satu transaksi.
   *
   * Tanpa transaksi, dua `/playlist add` yang datang bersamaan membaca baris
   * yang sama lalu menimpanya: satu lagu hilang tanpa pernah ada pesannya. Dan
   * baris yang sudah hilang di antara dua operasi menghasilkan "not found", bukan
   * lagu yang tersimpan separuh tanpa jejak.
   */
  async appendTracks(playlistId: number, tracks: readonly StoredTrack[]): Promise<Playlist | null> {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await tx.playlist.findUnique({ where: { id: playlistId } });
      if (!current) return null;

      const merged = [...parseStoredTracks(current.tracks), ...serializeTracks(tracks)];

      return tx.playlist.update({
        where: { id: playlistId },
        data: { tracks: merged as unknown as Prisma.InputJsonValue },
      });
    });

    return row ? toDomain(row) : null;
  }

  /** Hapus satu lagu berdasarkan posisi (1 = pertama), juga dalam transaksi. */
  async removeTrackAt(playlistId: number, index: number): Promise<Playlist | null> {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await tx.playlist.findUnique({ where: { id: playlistId } });
      if (!current) return null;

      const remaining = parseStoredTracks(current.tracks).filter((_, i) => i !== index);
      if (remaining.length === parseStoredTracks(current.tracks).length) return null;

      return tx.playlist.update({
        where: { id: playlistId },
        data: { tracks: remaining as unknown as Prisma.InputJsonValue },
      });
    });

    return row ? toDomain(row) : null;
  }

  async setPublic(playlistId: number, isPublic: boolean): Promise<Playlist | null> {
    const row = await this.prisma.playlist
      .update({ where: { id: playlistId }, data: { isPublic } })
      .catch(() => null);

    return row ? toDomain(row) : null;
  }

  async delete(playlistId: number): Promise<boolean> {
    const result = await this.prisma.playlist.deleteMany({ where: { id: playlistId } });

    return result.count > 0;
  }

  async countByOwner(guildId: string, ownerId: string): Promise<number> {
    return this.prisma.playlist.count({ where: { guildId, ownerId } });
  }

  async anonymizeOwner(guildId: string, ownerId: string, pseudonym: string): Promise<number> {
    const result = await this.prisma.playlist.updateMany({
      where: { guildId, ownerId },
      data: { ownerId: pseudonym },
    });

    return result.count;
  }
}