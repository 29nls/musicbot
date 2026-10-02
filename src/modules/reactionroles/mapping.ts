import type { ReactionRoleOption, ReactionRolePanel } from './types.js';

/**
 * Bentuk baris tabel yang dibutuhkan pemetaan. Sengaja didefinisikan lokal
 * (bukan tipe Prisma) supaya bisa dites tanpa database.
 */
export interface ReactionRolePanelRow {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReactionRoleOptionRow {
  id: number;
  panelId: number;
  roleId: string;
  label: string | null;
  emoji: string | null;
  description: string | null;
  position: number;
}

export type ReactionRolePanelWithOptions = ReactionRolePanelRow & {
  options: ReactionRoleOptionRow[];
};

export function toOptionDomain(row: ReactionRoleOptionRow): ReactionRoleOption {
  return {
    id: row.id,
    panelId: row.panelId,
    roleId: row.roleId,
    label: row.label,
    emoji: row.emoji,
    description: row.description,
    position: row.position,
  };
}

export function toPanelDomain(row: ReactionRolePanelWithOptions): ReactionRolePanel {
  return {
    id: row.id,
    guildId: row.guildId,
    channelId: row.channelId,
    messageId: row.messageId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    options: [...row.options]
      .sort((a, b) => a.position - b.position || a.id - b.id)
      .map(toOptionDomain),
  };
}
