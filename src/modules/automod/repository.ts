import type { PrismaClient } from '../../generated/prisma/client.js';
import { toDomain } from './mapping.js';
import type { AutomodRule } from './types.js';

/** Kontrak penyimpanan rule automod — bisa diganti fake di tes. */
export interface AutomodRepository {
  /** Hanya baris yang tersimpan; rule yang belum ada dilengkapi default oleh service. */
  list(guildId: string): Promise<AutomodRule[]>;
  save(guildId: string, rule: AutomodRule): Promise<void>;
}

export class PrismaAutomodRepository implements AutomodRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(guildId: string): Promise<AutomodRule[]> {
    const rows = await this.prisma.automodRule.findMany({ where: { guildId } });
    const rules: AutomodRule[] = [];

    for (const row of rows) {
      const rule = toDomain({
        guildId: row.guildId,
        type: row.type,
        enabled: row.enabled,
        threshold: row.threshold,
        actions: row.actions,
        whitelist: row.whitelist,
      });

      if (rule) rules.push(rule);
    }

    return rules;
  }

  async save(guildId: string, rule: AutomodRule): Promise<void> {
    const data = {
      enabled: rule.enabled,
      threshold: rule.threshold,
      actions: [...rule.actions],
      whitelist: { ...rule.whitelist },
    };

    await this.prisma.automodRule.upsert({
      where: { guildId_type: { guildId, type: rule.type } },
      create: { guildId, type: rule.type, ...data },
      update: data,
    });
  }
}
