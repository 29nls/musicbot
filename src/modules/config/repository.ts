import type { PrismaClient } from '../../generated/prisma/client.js';
import { toDomain, toPrismaData } from './mapping.js';
import type { GuildConfig } from './types.js';

/** Kontrak penyimpanan konfigurasi — implementasi lain (mis. in-memory) bisa dipakai untuk tes. */
export interface GuildConfigRepository {
  find(guildId: string): Promise<GuildConfig | null>;
  /** Simpan seluruh konfigurasi (insert atau update). */
  upsert(config: GuildConfig): Promise<GuildConfig>;
  remove(guildId: string): Promise<void>;
}

export class PrismaGuildConfigRepository implements GuildConfigRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async find(guildId: string): Promise<GuildConfig | null> {
    const row = await this.prisma.guildConfig.findUnique({ where: { guildId } });
    return row ? toDomain(row) : null;
  }

  async upsert(config: GuildConfig): Promise<GuildConfig> {
    const data = toPrismaData(config);

    const row = await this.prisma.guildConfig.upsert({
      where: { guildId: config.guildId },
      create: { guildId: config.guildId, ...data },
      update: data,
    });

    return toDomain(row);
  }

  /** deleteMany (bukan delete) supaya tidak error kalau barisnya memang tidak ada. */
  async remove(guildId: string): Promise<void> {
    await this.prisma.guildConfig.deleteMany({ where: { guildId } });
  }
}
