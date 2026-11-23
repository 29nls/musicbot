import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { toDomain } from './mapping.js';
import { hasSameTrack, parseStoredTracks, serializeTracks } from './tracks.js';
import type { CreatePlaylistInput, Playlist, StoredTrack } from './types.js';

/**
 * Kontrak penyimpanan playlist — bisa diganti fake di tes.
 *
 * Pencarian nama selalu **tidak membedakan huruf besar-kecil**: nama playlist
 * adalah milik orang, dan dua baris "Lofi"/"lofi" hanya membuat orang tidak
 * tahu mana yang sedang diputar.
 *
 * Playlist personal memakai `scope = 'personal'` dan `guildId = '@personal'`.
 * Setiap operasi personal **wajib** membawa `ownerId`: kepemilikan ditegakkan
 * di query, bukan hanya di service atau UI.
 */
export interface PlaylistRepository {
  create(input: CreatePlaylistInput, now: Date): Promise<Playlist>;
  findById(playlistId: number): Promise<Playlist | null>;
  findByName(guildId: string, ownerId: string, name: string): Promise<Playlist | null>;
  listOwned(guildId: string, ownerId: string, take: number): Promise<Playlist[]>;
  /** Cari playlist publik milik siapa pun dengan nama itu (tanpa huruf besar-kecil). */
  findPublicByName(guildId: string, name: string): Promise<Playlist | null>;
  listPublic(guildId: string, take: number): Promise<Playlist[]>;
  /** Playlist personal milik satu user, lintas guild. */
  listPersonal(ownerId: string, take: number): Promise<Playlist[]>;
  findPersonalByName(ownerId: string, name: string): Promise<Playlist | null>;
  /** Tambah lagu di akhir playlist. */
  appendTracks(playlistId: number, tracks: readonly StoredTrack[]): Promise<Playlist | null>;
  /** Tambah lagu di akhir playlist personal, hanya kalau pemiliknya cocok. */
  appendPersonalTracks(
    playlistId: number,
    ownerId: string,
    tracks: readonly StoredTrack[],
  ): Promise<Playlist | null>;
  /** Hapus satu lagu berdasarkan posisi (0 = pertama). */
  removeTrackAt(playlistId: number, index: number): Promise<Playlist | null>;
  /** Hapus satu lagu personal, hanya kalau pemiliknya cocok. */
  removePersonalTrackAt(
    playlistId: number,
    ownerId: string,
    index: number,
  ): Promise<Playlist | null>;
  /** Pindahkan lagu personal secara atomik; posisi 0-based. */
  movePersonalTrackAt(
    playlistId: number,
    ownerId: string,
    fromIndex: number,
    toIndex: number,
  ): Promise<Playlist | null>;
  renamePersonal(playlistId: number, ownerId: string, name: string): Promise<Playlist | null>;
  setPublic(playlistId: number, isPublic: boolean): Promise<Playlist | null>;
  delete(playlistId: number): Promise<boolean>;
  deletePersonal(playlistId: number, ownerId: string): Promise<boolean>;
  /** Berapa playlist milik member ini di guild ini — dipakai inventaris privasi. */
  countByOwner(guildId: string, ownerId: string): Promise<number>;
  /** Berapa playlist personal milik member ini, lintas guild. */
  countPersonalByOwner(ownerId: string): Promise<number>;
  /**
   * Anonimkan pemilik playlist atas permintaan penghapusan data.
   *
   * Playlist **dipertahankan**, hanya pemiliknya yang diganti pseudonim: nama
   * playlist dan daftar lagunya bukan tentang orang, sedangkan `ownerId` yang
   * membuatnya bisa dilacak kembali.
   */
  anonymizeOwner(guildId: string, ownerId: string, pseudonym: string): Promise<number>;
  anonymizePersonalOwner(ownerId: string, pseudonym: string): Promise<number>;
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
        scope: input.scope ?? 'server',
        createdAt: now,
      },
    });

    return toDomain(row);
  }

  async findById(playlistId: number): Promise<Playlist | null> {
    const row = await this.prisma.playlist.findUnique({ where: { id: playlistId } });
    return row ? toDomain(row) : null;
  }

  async findByName(guildId: string, ownerId: string, name: string): Promise<Playlist | null> {
    const row = await this.prisma.playlist.findFirst({
      where: { guildId, ownerId, name: { equals: name, mode: 'insensitive' } },
    });

    return row ? toDomain(row) : null;
  }

  async listOwned(guildId: string, ownerId: string, take: number): Promise<Playlist[]> {
    const rows = await this.prisma.playlist.findMany({
      where: { guildId, ownerId, scope: 'server' },
      orderBy: { name: 'asc' },
      take,
    });

    return rows.map(toDomain);
  }

  async findPublicByName(guildId: string, name: string): Promise<Playlist | null> {
    const row = await this.prisma.playlist.findFirst({
      where: { guildId, scope: 'server', isPublic: true, name: { equals: name, mode: 'insensitive' } },
      orderBy: { updatedAt: 'desc' },
    });

    return row ? toDomain(row) : null;
  }

  async listPublic(guildId: string, take: number): Promise<Playlist[]> {
    const rows = await this.prisma.playlist.findMany({
      where: { guildId, scope: 'server', isPublic: true },
      orderBy: { updatedAt: 'desc' },
      take,
    });

    return rows.map(toDomain);
  }

  async listPersonal(ownerId: string, take: number): Promise<Playlist[]> {
    const rows = await this.prisma.playlist.findMany({
      where: { ownerId, scope: 'personal' },
      orderBy: { updatedAt: 'desc' },
      take,
    });

    return rows.map(toDomain);
  }

  async findPersonalByName(ownerId: string, name: string): Promise<Playlist | null> {
    const row = await this.prisma.playlist.findFirst({
      where: {
        ownerId,
        scope: 'personal',
        name: { equals: name, mode: 'insensitive' },
      },
    });

    return row ? toDomain(row) : null;
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
    return this.appendInTransaction(playlistId, tracks, { id: playlistId });
  }

  async appendPersonalTracks(
    playlistId: number,
    ownerId: string,
    tracks: readonly StoredTrack[],
  ): Promise<Playlist | null> {
    return this.appendInTransaction(playlistId, tracks, {
      id: playlistId,
      ownerId,
      scope: 'personal',
    });
  }

  /** Hapus satu lagu berdasarkan posisi (0 = pertama), juga dalam transaksi. */
  async removeTrackAt(playlistId: number, index: number): Promise<Playlist | null> {
    return this.removeInTransaction(playlistId, index, { id: playlistId });
  }

  async removePersonalTrackAt(
    playlistId: number,
    ownerId: string,
    index: number,
  ): Promise<Playlist | null> {
    return this.removeInTransaction(playlistId, index, {
      id: playlistId,
      ownerId,
      scope: 'personal',
    });
  }

  async movePersonalTrackAt(
    playlistId: number,
    ownerId: string,
    fromIndex: number,
    toIndex: number,
  ): Promise<Playlist | null> {
    return this.moveInTransaction(playlistId, fromIndex, toIndex, {
      id: playlistId,
      ownerId,
      scope: 'personal',
    });
  }

  async renamePersonal(
    playlistId: number,
    ownerId: string,
    name: string,
  ): Promise<Playlist | null> {
    const row = await this.prisma.$transaction(async (tx) => {
      // Kunci baris sebelum dibaca: rename dan append dari dua tab bisa tiba
      // bersamaan, dan tanpa kunci ini salah satunya menimpa perubahan yang lain.
      await lockPlaylist(tx, playlistId);

      const current = await tx.playlist.findFirst({
        where: { id: playlistId, ownerId, scope: 'personal' },
      });
      if (!current) return null;

      return tx.playlist.update({ where: { id: playlistId }, data: { name } });
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

  async deletePersonal(playlistId: number, ownerId: string): Promise<boolean> {
    const result = await this.prisma.playlist.deleteMany({
      where: { id: playlistId, ownerId, scope: 'personal' },
    });

    return result.count > 0;
  }

  async countByOwner(guildId: string, ownerId: string): Promise<number> {
    return this.prisma.playlist.count({ where: { guildId, ownerId } });
  }

  async countPersonalByOwner(ownerId: string): Promise<number> {
    return this.prisma.playlist.count({ where: { ownerId, scope: 'personal' } });
  }

  async anonymizeOwner(guildId: string, ownerId: string, pseudonym: string): Promise<number> {
    const result = await this.prisma.playlist.updateMany({
      where: { guildId, ownerId },
      data: { ownerId: pseudonym },
    });

    return result.count;
  }

  async anonymizePersonalOwner(ownerId: string, pseudonym: string): Promise<number> {
    const result = await this.prisma.playlist.updateMany({
      where: { ownerId, scope: 'personal' },
      data: { ownerId: pseudonym },
    });

    return result.count;
  }

  private async appendInTransaction(
    playlistId: number,
    tracks: readonly StoredTrack[],
    where: Prisma.PlaylistWhereInput,
  ): Promise<Playlist | null> {
    const row = await this.prisma.$transaction(async (tx) => {
      await lockPlaylist(tx, playlistId);
      const current = await tx.playlist.findFirst({ where });
      if (!current) return null;

      const existing = parseStoredTracks(current.tracks);
      const fresh = tracks.filter((track) => !hasSameTrack(existing, track));
      if (fresh.length === 0) return current;

      const merged = [...existing, ...serializeTracks(fresh)];

      return tx.playlist.update({
        where: { id: playlistId },
        data: { tracks: merged as unknown as Prisma.InputJsonValue },
      });
    });

    return row ? toDomain(row) : null;
  }

  private async moveInTransaction(
    playlistId: number,
    fromIndex: number,
    toIndex: number,
    where: Prisma.PlaylistWhereInput,
  ): Promise<Playlist | null> {
    const row = await this.prisma.$transaction(async (tx) => {
      await lockPlaylist(tx, playlistId);
      const current = await tx.playlist.findFirst({ where });
      if (!current) return null;

      const tracks = parseStoredTracks(current.tracks);
      if (!isTrackIndex(fromIndex, tracks.length) || !isTrackIndex(toIndex, tracks.length)) {
        return null;
      }
      if (fromIndex === toIndex) return current;

      const [moved] = tracks.splice(fromIndex, 1);
      if (!moved) return null;
      tracks.splice(toIndex, 0, moved);

      return tx.playlist.update({
        where: { id: playlistId },
        data: { tracks: serializeTracks(tracks) as unknown as Prisma.InputJsonValue },
      });
    });

    return row ? toDomain(row) : null;
  }

  private async removeInTransaction(
    playlistId: number,
    index: number,
    where: Prisma.PlaylistWhereInput,
  ): Promise<Playlist | null> {
    const row = await this.prisma.$transaction(async (tx) => {
      await lockPlaylist(tx, playlistId);
      const current = await tx.playlist.findFirst({ where });
      if (!current) return null;

      const parsed = parseStoredTracks(current.tracks);
      const remaining = parsed.filter((_, i) => i !== index);
      if (remaining.length === parsed.length) return null;

      return tx.playlist.update({
        where: { id: playlistId },
        data: { tracks: remaining as unknown as Prisma.InputJsonValue },
      });
    });

    return row ? toDomain(row) : null;
  }
}

/**
 * Kunci baris playlist selama transaksi.
 *
 * Read-modify-write JSON tanpa kunci ini bisa kehilangan lagu saat dua tab
 * menekan Simpan hampir bersamaan: keduanya membaca daftar yang sama, lalu
 * penulis terakhir menimpa tambahan yang lain. `FOR UPDATE` membuat penulis
 * kedua menunggu dan membaca hasil penulis pertama.
 */
async function lockPlaylist(tx: Prisma.TransactionClient, playlistId: number): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "playlist" WHERE "id" = ${playlistId} FOR UPDATE`;
}

function isTrackIndex(index: number, count: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < count;
}
