import type { PrismaClient } from '../../generated/prisma/client.js';
import { toPanelDomain, type ReactionRolePanelWithOptions } from './mapping.js';
import type { CreatePanelInput, PanelOptionLookup, ReactionRolePanel, RoleInput } from './types.js';

const PANEL_INCLUDE = { options: { orderBy: [{ position: 'asc' as const }, { id: 'asc' as const }] } };

/** Kontrak penyimpanan panel reaction role — bisa diganti fake di tes. */
export interface ReactionRoleRepository {
  create(input: CreatePanelInput): Promise<ReactionRolePanel>;
  list(guildId: string): Promise<ReactionRolePanel[]>;
  find(guildId: string, panelId: number): Promise<ReactionRolePanel | null>;
  addOptions(panelId: number, roles: readonly RoleInput[]): Promise<ReactionRolePanel | null>;
  removeOptions(panelId: number, roleIds: readonly string[]): Promise<ReactionRolePanel | null>;
  delete(guildId: string, panelId: number): Promise<ReactionRolePanel | null>;
  findOption(optionId: number): Promise<PanelOptionLookup | null>;
  attachMessage(panelId: number, messageId: string): Promise<void>;
  markClosed(guildId: string, panelId: number, now: Date): Promise<ReactionRolePanel | null>;
  findDueForExpiry(now: Date, limit: number): Promise<ReactionRolePanel[]>;
}

export class PrismaReactionRoleRepository implements ReactionRoleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreatePanelInput): Promise<ReactionRolePanel> {
    const row = await this.prisma.reactionRolePanel.create({
      data: {
        guildId: input.guildId,
        channelId: input.channelId,
        expiresAt: input.expiresAt,
        options: {
          create: input.roles.map((role, index) => ({
            roleId: role.roleId,
            label: role.label ?? null,
            emoji: role.emoji ?? null,
            description: role.description ?? null,
            position: index,
          })),
        },
      },
      include: PANEL_INCLUDE,
    });

    return toPanelDomain(row);
  }

  async list(guildId: string): Promise<ReactionRolePanel[]> {
    const rows = await this.prisma.reactionRolePanel.findMany({
      where: { guildId },
      include: PANEL_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    return rows.map(toPanelDomain);
  }

  async find(guildId: string, panelId: number): Promise<ReactionRolePanel | null> {
    const row = await this.prisma.reactionRolePanel.findFirst({
      where: { id: panelId, guildId },
      include: PANEL_INCLUDE,
    });

    return row ? toPanelDomain(row) : null;
  }

  /**
   * `skipDuplicates` aman di sini: opsi yang sudah ada dilewati, bukan error,
   * jadi dua admin menambahkan role yang sama tidak saling gagalkan.
   */
  async addOptions(
    panelId: number,
    roles: readonly RoleInput[],
  ): Promise<ReactionRolePanel | null> {
    const panel = await this.prisma.reactionRolePanel.findUnique({
      where: { id: panelId },
      select: { id: true },
    });
    if (!panel) return null;

    await this.prisma.reactionRoleOption.createMany({
      data: roles.map((role, index) => ({
        panelId,
        roleId: role.roleId,
        label: role.label ?? null,
        emoji: role.emoji ?? null,
        description: role.description ?? null,
        position: index,
      })),
      skipDuplicates: true,
    });

    return this.findById(panelId);
  }

  async removeOptions(
    panelId: number,
    roleIds: readonly string[],
  ): Promise<ReactionRolePanel | null> {
    const panel = await this.prisma.reactionRolePanel.findUnique({
      where: { id: panelId },
      select: { id: true },
    });
    if (!panel) return null;

    // `deleteMany` supaya role yang memang sudah tidak ada tidak menggagalkan.
    await this.prisma.reactionRoleOption.deleteMany({
      where: { panelId, roleId: { in: [...roleIds] } },
    });

    return this.findById(panelId);
  }

  async delete(guildId: string, panelId: number): Promise<ReactionRolePanel | null> {
    // `include` dulu supaya pemanggil masih bisa menghapus pesan panelnya.
    const row = await this.prisma.reactionRolePanel.findFirst({
      where: { id: panelId, guildId },
      include: PANEL_INCLUDE,
    });
    if (!row) return null;

    await this.prisma.reactionRolePanel.delete({ where: { id: panelId } });

    return toPanelDomain(row);
  }

  async findOption(optionId: number): Promise<PanelOptionLookup | null> {
    const row = await this.prisma.reactionRoleOption.findUnique({
      where: { id: optionId },
      include: { panel: { include: PANEL_INCLUDE } },
    });
    if (!row) return null;

    return {
      panel: toPanelDomain(row.panel),
      option: {
        id: row.id,
        panelId: row.panelId,
        roleId: row.roleId,
        label: row.label,
        emoji: row.emoji,
        description: row.description,
        position: row.position,
      },
    };
  }

  /** updateMany: pesan mungkin gagal terkirim sehingga panel tak punya messageId. */
  async attachMessage(panelId: number, messageId: string): Promise<void> {
    await this.prisma.reactionRolePanel.updateMany({
      where: { id: panelId },
      data: { messageId },
    });
  }

  /**
   * Tandai panel sudah dinonaktifkan.
   *
   * `closedAt: null` sebagai syarat: panel yang sudah tertutup oleh sweep atau
   * perintah `close` tidak perlu disentuh lagi, dan pengaman ini membuat dua
   * pemanggil yang berebut (job + perintah admin) aman.
   */
  async markClosed(
    guildId: string,
    panelId: number,
    now: Date,
  ): Promise<ReactionRolePanel | null> {
    const row = await this.prisma.reactionRolePanel.findFirst({
      where: { id: panelId, guildId },
      include: PANEL_INCLUDE,
    });
    if (!row || row.closedAt) return null;

    await this.prisma.reactionRolePanel.updateMany({
      where: { id: panelId, closedAt: null },
      data: { closedAt: now },
    });

    return toPanelDomain(row);
  }

  /**
   * Panel yang masa hidupnya sudah habis dan belum pernah dinonaktifkan.
   *
   * `closedAt: null` membuat hasil ini shrinking: panel yang sudah diurus
   * tidak akan muncul lagi di sapuan berikutnya, jadi tidak ada pekerjaan
   * berulang setiap 15 menit.
   */
  async findDueForExpiry(now: Date, limit: number): Promise<ReactionRolePanel[]> {
    const rows = await this.prisma.reactionRolePanel.findMany({
      where: { closedAt: null, expiresAt: { lte: now } },
      include: PANEL_INCLUDE,
      orderBy: { expiresAt: 'asc' },
      take: limit,
    });

    return rows.map(toPanelDomain);
  }

  private async findById(panelId: number): Promise<ReactionRolePanel | null> {
    const row = await this.prisma.reactionRolePanel.findUnique({
      where: { id: panelId },
      include: PANEL_INCLUDE,
    });

    return row ? toPanelDomain(row as ReactionRolePanelWithOptions) : null;
  }
}
