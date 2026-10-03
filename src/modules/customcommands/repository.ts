import type { PrismaClient } from '../../generated/prisma/client.js';
import { toDomain } from './mapping.js';
import type { CreateCustomCommandInput, CustomCommand } from './types.js';

/**
 * Kontrak penyimpanan custom command — bisa diganti fake di tes.
 *
 * Pencarian nama selalu **tidak membedakan huruf besar-kecil**: nama pemicu
 * adalah milik server, jadi `!Ping` dan `!ping` yang tersimpan dua baris hanya
 * membuat admin tidak tahu yang mana yang dipakai member.
 */
export interface CustomCommandRepository {
  create(input: CreateCustomCommandInput, now: Date): Promise<CustomCommand>;
  findByName(guildId: string, name: string): Promise<CustomCommand | null>;
  list(guildId: string, take: number): Promise<CustomCommand[]>;
  /** Ganti isi balasan; null kalau nama itu tidak ada. */
  updateResponse(id: number, response: string, now: Date): Promise<CustomCommand | null>;
  /** Hapus per nama; mengembalikan baris yang terhapus supaya bisa ditampilkan. */
  deleteByName(guildId: string, name: string): Promise<CustomCommand | null>;
  /** Berapa perintah yang dibuat admin ini di server ini — inventaris privasi. */
  countByCreator(guildId: string, createdBy: string): Promise<number>;
  /**
   * Anonimkan pembuat perintah atas permintaan penghapusan data.
   *
   * Isi balasan **dipertahankan** — teks balasan bukan tentang orang, dan
   * menghapusnya akan mematikan perintah yang masih dipakai server. Yang
   * dilepas hanya `createdBy`, supaya baris ini tidak lagi bisa ditelusuri
   * kembali ke admin yang membuatnya.
   */
  anonymizeCreator(guildId: string, createdBy: string, pseudonym: string): Promise<number>;
}

export class PrismaCustomCommandRepository implements CustomCommandRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateCustomCommandInput, now: Date): Promise<CustomCommand> {
    const row = await this.prisma.customCommand.create({
      data: {
        guildId: input.guildId,
        name: input.name,
        response: input.response,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
      },
    });

    return toDomain(row);
  }

  async findByName(guildId: string, name: string): Promise<CustomCommand | null> {
    const row = await this.prisma.customCommand.findFirst({
      where: { guildId, name: { equals: name, mode: 'insensitive' } },
    });

    return row ? toDomain(row) : null;
  }

  async list(guildId: string, take: number): Promise<CustomCommand[]> {
    const rows = await this.prisma.customCommand.findMany({
      where: { guildId },
      orderBy: { name: 'asc' },
      take,
    });

    return rows.map(toDomain);
  }

  async updateResponse(id: number, response: string, now: Date): Promise<CustomCommand | null> {
    try {
      const row = await this.prisma.customCommand.update({
        where: { id },
        data: { response, updatedAt: now },
      });

      return toDomain(row);
    } catch (error) {
      // Baris hilang di antara pembacaan dan penulisan (admin lain menghapus
      // perintah yang sama). Itu hasil yang wajar, bukan kegagalan sistem.
      if (isMissingRow(error)) return null;
      throw error;
    }
  }

  async deleteByName(guildId: string, name: string): Promise<CustomCommand | null> {
    const existing = await this.findByName(guildId, name);
    if (!existing) return null;

    try {
      const row = await this.prisma.customCommand.delete({ where: { id: existing.id } });
      return toDomain(row);
    } catch (error) {
      if (isMissingRow(error)) return null;
      throw error;
    }
  }

  async countByCreator(guildId: string, createdBy: string): Promise<number> {
    return this.prisma.customCommand.count({ where: { guildId, createdBy } });
  }

  async anonymizeCreator(guildId: string, createdBy: string, pseudonym: string): Promise<number> {
    const result = await this.prisma.customCommand.updateMany({
      where: { guildId, createdBy },
      data: { createdBy: pseudonym },
    });

    return result.count;
  }
}

function isMissingRow(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2025'
  );
}